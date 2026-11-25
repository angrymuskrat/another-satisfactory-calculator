import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Factory, GitFork, Maximize2, Minus, Plus, X, Zap } from 'lucide-react';
import type { Catalog } from '../../../packages/domain/types';
import type { ConstructionModel } from '../../../packages/domain/construction';
import { buildSchematic, filterSchematicFlows, SCHEMATIC_MIN_FLOW_SHARE, SCHEMATIC_PAGE_SIZE, type MachineSpan, type SchematicDestinations, type SchematicEdge, type SchematicMode, type SchematicModel, type SchematicNode } from '../../../packages/domain/schematic';
import { builtCount, constructionDependencies, type BuiltRanges, type MissingSupply } from '../../../packages/domain/constructionProgress';
import { format, ItemIcon, unit } from './controls';
import { useSchematicNavigation } from './useSchematicNavigation';
import { layoutSchematic, placeFlowLabels, placeSchematicNodes, routeSchematicEdges, type Point } from './schematicLayout';
import { MoveNode, useSchematicPositions } from './SchematicPosition';
import './schematic.css';

const number = (n: number) => n !== 0 && Math.abs(n) < .001 ? n.toExponential(3) : format(n, 3);
const kindLabels: Record<SchematicNode['kind'], string> = { building: 'ОБОРУДОВАНИЕ', source: 'ВНЕШНЯЯ ПОСТАВКА', product: 'ГОТОВЫЙ ПРОДУКТ', export: 'ПОТРЕБИТЕЛЬ', split: 'УСЛОВНЫЙ БЛОК', merge: 'УСЛОВНЫЙ БЛОК', continuation: 'ДРУГАЯ СТРАНИЦА' };
type Destination = Pick<MissingSupply, 'id' | 'index' | 'page'>;
type Tracking = { built: BuiltRanges; mark: (parts: MachineSpan[], checked: boolean) => void };
const represents = (n: SchematicNode, target: Destination) => n.kind !== 'continuation' && n.parts?.some(p => p.id === target.id && p.first <= target.index && target.index < p.first + p.count);
function SchematicCanvas({ catalog, graph, mode, changePage, focusOnMount, target, fitHeight, built, mark, dependencies, manual, transport, residueItemIds, closeForResidue }: Tracking & {
  catalog: Catalog; graph: SchematicModel; mode: SchematicMode; changePage: (page: number, target?: Destination) => void;
  focusOnMount: boolean; target?: Destination; fitHeight: boolean; dependencies: ReturnType<typeof constructionDependencies>;
  manual: ReturnType<typeof useSchematicPositions>; transport: ConstructionModel['transport'];
  residueItemIds?: readonly string[]; closeForResidue: (id: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null), [readyOnly, setReadyOnly] = useState(false);
  const [preview, setPreview] = useState<{ id: string; point: Point } | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const { zoom, zoomTo, dragging, bindings } = useSchematicNavigation(viewport);
  const canvas = useRef<HTMLDivElement>(null), buttons = useRef(new Map<string, HTMLButtonElement>());
  const positioned = useRef(false);
  const [automatic, setLayout] = useState(() => layoutSchematic(graph, {}));
  const layout = useMemo(() => placeSchematicNodes(automatic, preview ? { ...manual.positions, [preview.id]: preview.point } : manual.positions), [automatic, manual.positions, preview]);
  const measured = useRef<{ graph: SchematicModel; mode: SchematicMode; sizes: string; layout: typeof layout } | null>(null);
  const routes = useMemo(() => routeSchematicEdges(graph, layout), [graph, layout]);
  const marker = useId().replaceAll(':', ''), detailId = useId();
  useEffect(() => {
    if (!focusOnMount) return;
    const id = target && graph.nodes.find(n => represents(n, target))?.id;
    if (id) {
      const frame = requestAnimationFrame(() => select(id, true));
      return () => cancelAnimationFrame(frame);
    }
    viewport.current?.focus();
  }, [focusOnMount, target, graph]);
  const items = useMemo(() => new Map(catalog.items.map(i => [i.id, i])), [catalog]);
  const item = (id?: string) => id ? items.get(id) : undefined;
  const active = graph.nodes.find(n => n.id === selected);
  const byId = useMemo(() => new Map(graph.nodes.map(n => [n.id, n])), [graph]);
  const progress = useMemo(() => new Map(graph.nodes.filter(n => n.parts?.length).map(n => [n.id, dependencies(n.parts!, built)])), [graph, built, dependencies]);
  const incident = graph.edges.filter(e => e.from === selected || e.to === selected);
  const neighbors = new Set(incident.flatMap(e => [e.from, e.to]));
  const select = (id: string, focus = false) => {
    setSelected(id);
    setSelectedEdge(null);
    if (focus) { buttons.current.get(id)?.focus({ preventScroll: true }); buttons.current.get(id)?.scrollIntoView({ block: 'nearest', inline: 'center' }); }
  };
  const goTo = (destination: Destination) => {
    const node = graph.nodes.find(n => represents(n, destination));
    if (node) select(node.id, true);
    else changePage(destination.page, destination);
  };
  useLayoutEffect(() => {
    const element = canvas.current;
    if (!element) return;
    let initialFrame = 0;
    const measure = () => {
      // Скрытая вкладка не меняет геометрию схемы и не сбрасывает панорамирование.
      if (!element.getClientRects().length) return;
      const sizes: Record<string, { width: number; height: number }> = {};
      for (const card of element.querySelectorAll<HTMLElement>('[data-node-id]')) {
        sizes[card.dataset.nodeId!] = { width: card.offsetWidth, height: card.offsetHeight };
      }
      const sizeKey = JSON.stringify(sizes);
      const cached = measured.current;
      const next = cached?.graph === graph && cached.mode === mode && cached.sizes === sizeKey
        ? cached.layout : layoutSchematic(graph, sizes, mode);
      measured.current = { graph, mode, sizes: sizeKey, layout: next };
      setLayout(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
      if (!positioned.current && !target) {
        cancelAnimationFrame(initialFrame);
        initialFrame = requestAnimationFrame(() => {
          const first = Object.values(next.rects).sort((a, b) => a.x - b.x || a.y - b.y)[0];
          if (first && viewport.current) viewport.current.scrollTop = Math.max(0, first.y * zoom - 65);
          positioned.current = true;
        });
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    for (const card of element.querySelectorAll('[data-node-id]')) observer.observe(card);
    return () => { observer.disconnect(); cancelAnimationFrame(initialFrame); };
  }, [graph, mode, zoom, target]);
  const edgeText = (edge: SchematicEdge) => edge.kind === 'control' ? 'Связь скважины' : `${item(edge.itemId)?.name ?? edge.itemId}: ${number(edge.rate)} ${unit(item(edge.itemId))}${edge.share !== undefined ? ` · ${number(edge.share * 100)}%` : ''}`;
  const capacity = (e: SchematicEdge) => item(e.itemId)?.fluid ? transport.pipe : transport.belt;
  const selectedLink = graph.edges.find(e => e.id === selectedEdge);
  const residueLinks = residueItemIds?.filter(id => item(id)?.fluid && (selectedLink
    ? selectedLink.itemId === id : active?.outputs.some(f => f.itemId === id && f.rate > 0)));
  const isReturn = (e: SchematicEdge) => e.kind === 'flow' && byId.get(e.to)!.stage <= byId.get(e.from)!.stage
    && graph.cycles.some(c => c.internalFlows.some(f => f.itemId === e.itemId) && byId.get(e.to)!.configurations.some(g => c.recipeIds.includes(g.id)));
  const edgeLabels = useMemo(() => new Map(graph.edges.map(edge => {
    const returned = isReturn(edge), icon = item(edge.itemId)?.icon;
    const title = `${returned ? '↶ Возврат · ' : ''}${edge.kind === 'control' ? 'Связь скважины' : item(edge.itemId)?.name ?? edge.itemId}`;
    const rate = edge.kind === 'control' ? '' : `${number(edge.rate)} ${unit(item(edge.itemId))}${edge.share !== undefined ? ` · ${number(edge.share * 100)}%` : ''}${edge.parallel > 1 ? ` · ×${edge.parallel}` : ''}`;
    return [edge.id, { title, rate, icon, returned }];
  })), [graph, items, byId]);
  const highlight = (e: SchematicEdge) => selectedEdge ? e.id === selectedEdge : !selected || e.from === selected || e.to === selected;
  const locations = useMemo(() => {
    const candidates = graph.edges.filter(e => highlight(e) && routes[e.id]);
    const full = zoom > .59 || selected ? candidates.map(e => {
      const { title, rate, icon } = edgeLabels.get(e.id)!;
      return { id: e.id, at: routes[e.id].label, width: Math.max(title.length * 8 + (icon ? 22 : 0), rate.length * 8) + 12, height: rate ? 38 : 22 };
    }) : [];
    const compact = candidates.map(e => ({ id: e.id, at: routes[e.id].label, width: 32, height: 24, compact: true }));
    return placeFlowLabels(layout, [...full, ...compact]);
  }, [graph, layout, routes, edgeLabels, zoom, selected, selectedEdge]);
  const visibleEdge = (edge: SchematicEdge) => {
    const route = routes[edge.id];
    if (!route) return null;
    const { d } = route, position = locations.get(edge.id), highlighted = highlight(edge);
    const { title, rate, icon, returned } = edgeLabels.get(edge.id)!;
    return <g key={edge.id} data-rate={edge.rate} data-item-id={edge.itemId} className={`${edge.kind} ${item(edge.itemId)?.fluid ? 'fluid' : ''} ${returned ? 'return-flow' : ''} ${highlighted ? '' : 'dim'} ${selectedEdge === edge.id ? 'picked' : ''}`}>
      <path d={d} markerEnd={`url(#${marker})`} onClick={() => { select(edge.from); setSelectedEdge(edge.id); }}><title>{byId.get(edge.from)!.label} → {byId.get(edge.to)!.label} · {edgeText(edge)}</title></path>
      {position && <>
        {route.label.y !== position.y && <line className="schematic-label-leader" x1={route.label.x} y1={route.label.y + 23} x2={position.x} y2={position.y} />}
        {icon && <image href={icon} x={position.x - (position.compact ? 9 : title.length * 3.7 + 16)} y={position.y - 14} width="18" height="18" />}
        {(!position.compact || !icon) && <text x={position.x} y={position.y} textAnchor="middle"><tspan x={position.x + (!position.compact && icon ? 9 : 0)}>{position.compact ? title.slice(0, 1) : title}</tspan>
          {!position.compact && rate && <tspan x={position.x} dy="16">{rate}</tspan>}</text>}
      </>}
    </g>;
  };
  const flows = (node: SchematicNode, direction: 'inputs' | 'outputs') => <div className="schematic-flows"><span>{direction === 'inputs' ? 'ВХОД' : 'ВЫХОД'}</span>
    {node[direction].length ? node[direction].map(f => <div key={f.itemId}><ItemIcon item={item(f.itemId)} size={20} /><span>{item(f.itemId)?.name ?? f.itemId}</span><strong>{number(f.rate)}<small>{unit(item(f.itemId))}</small></strong></div>) : <small>{node.configurations.some(g => g.kind === 'sink') && direction === 'outputs' ? 'Утилизация предметов' : 'Нет предметного потока'}</small>}
  </div>;
  return <>
    <div className="schematic-controls"><div className="schematic-zoom" role="group" aria-label="Масштаб схемы">
      <button type="button" className="icon-button" aria-label="Уменьшить масштаб" disabled={zoom <= .25} onClick={() => zoomTo(zoom - .1)}><Minus size={17} /></button>
      <button type="button" className="secondary-button" aria-label="Масштаб 100 процентов" onClick={() => zoomTo(1)}>{Math.round(zoom * 100)}%</button>
      <button type="button" className="icon-button" aria-label="Увеличить масштаб" disabled={zoom >= 1.5} onClick={() => zoomTo(zoom + .1)}><Plus size={17} /></button>
      <button type="button" className="secondary-button" onClick={() => { const element = viewport.current; if (element) zoomTo(Math.min(1, element.clientWidth / layout.width, element.clientHeight / layout.height)); }}>Уместить</button>
    </div><label><input type="checkbox" checked={readyOnly} onChange={e => setReadyOnly(e.target.checked)} /> Можно строить дальше</label>
    <button type="button" className="secondary-button" disabled={!Object.keys(manual.positions).length} onClick={() => manual.save()}>Вернуть автораскладку</button></div>
    {manual.error && <p className="hint" role="alert">{manual.error}</p>}
    {readyOnly && <div className="schematic-ready-list" aria-label="Готовые блоки">{[...progress].filter(([, p]) => p.ready).map(([id, p]) => <button type="button" className="text-button" key={id} onClick={() => goTo(p.firstReady!)}>{byId.get(id)!.label} · {p.ready}</button>)}{![...progress.values()].some(p => p.ready) && 'Все блоки отмечены.'}</div>}
    <div className="schematic-stage"><div className={`schematic-viewport${dragging ? ' is-dragging' : ''}`} ref={viewport} {...bindings} style={fitHeight ? { maxHeight: layout.height + 24 } : undefined} tabIndex={0} role="group" aria-label="Полотно схемы, прокрутка стрелками" aria-description="Перетаскивайте мышью для перемещения. Колесо изменяет масштаб вокруг указателя.">
      <div className="schematic-scaled" style={{ width: layout.width * zoom, height: layout.height * zoom }}>
        <div className="schematic-canvas" data-layout={mode === 'machines' ? 'short-links' : 'branches'} ref={canvas} style={{ transform: `scale(${zoom})`, width: layout.width, height: layout.height }}>
          <svg className="schematic-edges" width={layout.width} height={layout.height} aria-hidden="true"><defs><marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#aab5bd" /></marker></defs>{graph.edges.map(visibleEdge)}</svg>
            {graph.nodes.map(node => {
              const junction = node.kind === 'merge' || node.kind === 'split';
              const differentClocks = new Set(node.configurations.map(g => g.clock)).size > 1;
              const differentDuties = new Set(node.configurations.map(g => g.activeDuty)).size > 1;
              const duty = node.count ? node.configurations.reduce((s, g) => s + g.count * g.activeDuty, 0) / node.count : null;
              const status = progress.get(node.id), parts = node.parts ?? [], total = parts.reduce((sum, p) => sum + p.count, 0), done = builtCount(built, parts);
              return <article key={node.id} data-node-id={node.id} data-kind={node.kind} data-building-id={node.buildingId} data-count={node.count}
                style={{ left: layout.rects[node.id]?.x ?? 90, top: layout.rects[node.id]?.y ?? 90 }}
                data-progress={status && (done === total ? 'built' : status.ready ? 'ready' : 'waiting')}
                className={`schematic-node ${junction ? 'junction' : ''} ${item(node.itemId)?.fluid ? 'fluid' : ''} ${selected === node.id ? 'selected' : (selected && !neighbors.has(node.id) || readyOnly && !status?.ready) ? 'muted-node' : ''}`}>
                <button type="button" ref={el => { if (el) buttons.current.set(node.id, el); else buttons.current.delete(node.id); }} className="schematic-node-button" aria-pressed={selected === node.id} aria-controls={detailId} onClick={() => select(node.id)}>
                  <span className="schematic-kind">{node.routingDepth !== undefined ? (node.kind === 'split' ? 'КОНВЕЙЕРНЫЙ РАЗДЕЛИТЕЛЬ' : 'КОНВЕЙЕРНЫЙ СОЕДИНИТЕЛЬ') : kindLabels[node.kind]}</span><span className="schematic-node-title">{junction ? <GitFork size={22} /> : node.count ? <Factory size={22} /> : <ItemIcon item={item(node.itemId)} size={28} />}<strong>{node.label}</strong>{node.count > 0 && <b>×{node.count}</b>}</span>
                  {node.configurations.length > 0 && <span className="schematic-recipe">{node.configurations.length === 1 ? node.configurations[0].name : `${node.configurations.length} конфигурации · раскрыть состав`}</span>}
                </button>
                <MoveNode name={node.label} position={layout.rects[node.id] ?? { x: 90, y: 90 }} zoom={zoom}
                  preview={point => setPreview(point ? { id: node.id, point } : null)} save={p => manual.save(node.id, p)} />
                {status && <div className="schematic-progress">
                  <label><input type="checkbox" aria-label={`${node.kind === 'source' ? 'Поставка готова' : 'Построено'}: ${node.label}`} checked={done === total}
                    ref={el => { if (el) el.indeterminate = done > 0 && done < total; }} onChange={e => mark(parts, e.target.checked)} />
                    {node.kind === 'source' ? 'Поставка готова' : 'Построено'} · {done} из {total}</label>
                  {done < total && (status.ready > 0 || !status.missing.length) && <small>{status.ready ? (status.together ? '↻ Строить вместе' : '→ Можно строить дальше') : 'Ждёт поставку'}{status.ready > 0 && total > 1 && ` · ${status.ready} из ${total}`}</small>}
                  {status.missing.length > 0 && <button className="text-button" type="button" onClick={() => goTo(status.missing[0])}>Ждёт поставку · {item(status.missing[0].itemId)?.name ?? 'Подключение'} ({status.missing[0].label})</button>}
                </div>}
                {node.configurations.length > 0 && <div className="schematic-settings"><span>{differentClocks ? 'Средняя частота' : 'Частота'} <strong>{number(node.clock!)}%</strong></span><span>{differentDuties ? 'Средняя доля работы' : 'Работа'} <strong>{number(duty! * 100)}%</strong> времени</span>{(differentClocks || differentDuties) && <small>Настройки различаются · см. состав</small>}{node.existing > 0 && <small>Уже есть {node.existing} · добавить {node.count - node.existing}</small>}</div>}
                {junction ? <p className="schematic-junction-rate">{number(node.inputs[0].rate)} <small>{unit(item(node.itemId))}</small><span>{node.routingDepth !== undefined ? `Проверенные порты · глубина ${node.routingDepth}` : 'Игрок настраивает блок'}</span></p> : <>{flows(node, 'inputs')}{flows(node, 'outputs')}</>}
                {node.configurations.some(g => g.generatedPower !== undefined) && <p>Выработка: {number(node.configurations.reduce((n, g) => n + (g.generatedPower ?? 0), 0))} МВт</p>}{(node.configurations.length > 0 || node.kind === 'source') && <div className="schematic-power"><Zap size={15} />{node.averagePower === null ? <span>Энергия поставки неизвестна</span> : <><strong>{number(node.averagePower)} МВт</strong><span>средняя · пик {number(node.peakPower!)} МВт</span></>}</div>}
                {node.kind === 'continuation' && <button type="button" className="secondary-button schematic-page-link" onClick={() => changePage(node.page!)}>К этим зданиям · стр. {node.page! + 1}<ArrowRight size={15} /></button>}
              </article>;
            })}
        </div>
      </div>
    </div>
    <p className="hint schematic-hint">Тяните фон для перемещения полотна. Колесо меняет масштаб. Карточку можно передвинуть за ручку или стрелками на ручке. Выберите стрелку, чтобы увидеть маршрут и пропускную способность. {graph.physicalRouting ? 'Все физические конвейерные связи показаны, включая малые ветви. Порог малых потоков применяется только к трубам.' : <>Связи меньше {number(SCHEMATIC_MIN_FLOW_SHARE * 100)}% общего потока предмета скрыты.</>} Очерёдность стройки учитывает и малые поставки. Материалы в инвентаре, подключение питания и стартовое заполнение контура проверяет игрок.</p>
    <div id={detailId} className="schematic-details">
      {active ? <><div className="section-heading"><h3>{active.label}{active.count > 0 && ` ×${active.count}`}</h3><button type="button" className="text-button" onClick={() => { setSelected(null); setSelectedEdge(null); }}>Снять выделение</button></div>
        {residueLinks?.map(id => <p key={id}><a href={'#residue-' + encodeURIComponent(id)} onClick={() => closeForResidue(id)}>Подобрать переработку — {item(id)?.name}</a></p>)}
        {!!progress.get(active.id)?.missing.length && <div className="schematic-blockers"><h4>Нужны поставщики</h4>{progress.get(active.id)!.missing.map(m =>
          <button type="button" className="text-button" key={JSON.stringify([m.id, m.index, m.itemId])} onClick={() => goTo(m)}>{item(m.itemId)?.name ?? 'Связь скважины'} ← {m.label}{mode === 'machines' && m.page !== graph.page ? ` · стр. ${m.page + 1}` : ''}</button>)}</div>}
        {active.configurations.length > 0 && <div className="schematic-configurations">{active.configurations.map(g => <div key={g.id}><strong>{g.name} · зданий {g.count}</strong>{g.recipeId && <span>Рецепт: {catalog.recipes.find(r => r.id === g.recipeId)?.name ?? g.recipeId}</span>}<span>Частота {number(g.clock)}% · работа {number(g.activeDuty * 100)}% времени · Somersloops на машину: {g.somersloops ?? 0}</span><span>Активная машина: {number(g.activePower)} МВт · средняя группы: {number(g.averagePower)} МВт · пик: {number(g.peakPower)} МВт</span>{g.powerEstimated && <span>Мощность оценочная по каталогу.</span>}</div>)}</div>}
        <h4>Соединения выбранного узла</h4>
        {!!incident.length && <label>Выбрать линию <select value={selectedEdge ?? ''} onChange={e => setSelectedEdge(e.target.value || null)}><option value="">Все соединения</option>{incident.map(e =>
          <option key={e.id} value={e.id}>{byId.get(e.from)!.label} → {byId.get(e.to)!.label} · {edgeText(e)}</option>)}</select></label>}
        {selectedLink && <p role="status">{byId.get(selectedLink.from)!.label} → {byId.get(selectedLink.to)!.label} · {isReturn(selectedLink) && '↶ Возврат · '}{edgeText(selectedLink)}
          {selectedLink.kind === 'flow' && ` · ${capacity(selectedLink).name}, ${selectedLink.parallel} × ${number(capacity(selectedLink).rate)} ${unit(item(selectedLink.itemId))}`}</p>}
        <ul className="schematic-connections">{incident.map(e => {
          const other = graph.nodes.find(n => n.id === (e.from === active.id ? e.to : e.from))!;
          return <li key={e.id}><button type="button" onClick={() => select(other.id, true)}><span>{e.from === active.id ? '→ Куда: ' : '← Откуда: '}{other.label}</span><strong>{edgeText(e)}</strong>{e.kind === 'flow' && <small>{e.physicalRouting ? 'Одна физическая лента проверенной схемы' : <>Не менее {e.parallel} {item(e.itemId)?.fluid ? 'параллельных труб' : 'параллельных лент'} по среднему потоку</>}</small>}</button></li>;
        })}</ul>{!incident.length && <p>Предметные соединения не используются.</p>}</> : null}
    </div>
  </div>
  </>;
}

export function Schematic({ catalog, model, destinations, mode, scope, built, mark, residueItemIds }: Tracking & { catalog: Catalog; model: ConstructionModel; destinations: SchematicDestinations; mode: SchematicMode; scope: string; residueItemIds?: readonly string[] }) {
  const [page, setPage] = useState(0), [expanded, setExpanded] = useState(false);
  const [focusCanvas, setFocusCanvas] = useState(false);
  const [target, setTarget] = useState<Destination>();
  const manual = useSchematicPositions(scope, mode, model.fingerprint);
  const [canvasOnly, setCanvasOnly] = useState(false);
  const onlyButton = useRef<HTMLButtonElement>(null), restoreButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null), expandButton = useRef<HTMLButtonElement>(null);
  const residueTarget = useRef<string | null>(null);
  const tracking = useMemo(() => {
    try { return { dependencies: constructionDependencies(buildSchematic(catalog, model, destinations, 'configurations'), SCHEMATIC_PAGE_SIZE), error: '' }; }
    catch (e) { return { error: e instanceof Error ? e.message : 'Не удалось проверить зависимости.' }; }
  }, [catalog, model, destinations]);
  const computed = useMemo(() => {
    try { return { graph: filterSchematicFlows(buildSchematic(catalog, model, destinations, mode, page)), error: '' }; }
    catch (e) { return { graph: null, error: e instanceof Error ? e.message : 'Не удалось построить схему.' }; }
  }, [catalog, model, destinations, mode, page]);
  useEffect(() => { if (expanded) dialog.current?.showModal(); }, [expanded]);
  useLayoutEffect(() => {
    if (!dialog.current?.open) return;
    dialog.current.scrollTop = 0;
    (canvasOnly ? restoreButton : onlyButton).current?.focus({ preventScroll: true });
  }, [canvasOnly]);
  const graph = computed.graph;
  const dependencies = tracking.dependencies;
  if (!graph || !dependencies) return <section className="panel" role="alert"><h3>Схема не прошла перепроверку</h3><p>{computed.error || tracking.error}</p><p>Исходная инструкция остаётся доступна.</p></section>;
  const content = (full: boolean) => <>
    <div className="schematic-heading"><div><span className="eyebrow">ОТ РЕСУРСА ДО ПРОДУКТА</span><h3>Схема строительства</h3><p>{mode === 'types' ? 'Один узел — одинаковые здания с одним рецептом' : 'Один узел — одно физическое здание'} · всего {graph.machineCount} зданий{graph.physicalRouting && ` · ${graph.nodes.filter(node => node.routingDepth !== undefined).length} устройств логистики`}</p></div>
      {full ? <div className="schematic-full-actions"><button type="button" className="secondary-button" ref={onlyButton} onClick={() => setCanvasOnly(true)}>Только схема</button><button type="button" className="secondary-button" onClick={() => dialog.current?.close()}><X size={17} />Закрыть схему</button></div> : <button type="button" className="secondary-button" ref={expandButton} onClick={() => setExpanded(true)}><Maximize2 size={17} />На весь экран</button>}
    </div>
    {mode === 'machines' && graph.pages > 1 && <nav className="schematic-pagination" aria-label="Страницы зданий"><button type="button" className="secondary-button" disabled={graph.page === 0} onClick={() => { setFocusCanvas(false); setPage(graph.page - 1); }}>Назад</button><span>Страница {graph.page + 1} из {graph.pages} · здания {graph.page * SCHEMATIC_PAGE_SIZE + 1}–{Math.min(graph.machineCount, (graph.page + 1) * SCHEMATIC_PAGE_SIZE)}<small>Остальные здания показаны переходами с полными потоками.</small></span><button type="button" className="secondary-button" disabled={graph.page + 1 === graph.pages} onClick={() => { setFocusCanvas(false); setPage(graph.page + 1); }}>Далее</button></nav>}
    <SchematicCanvas key={`${mode}:${graph.page}`} catalog={catalog} graph={graph} mode={mode} focusOnMount={focusCanvas && expanded === full} target={focusCanvas ? target : undefined} fitHeight={!full}
      manual={manual} built={built} mark={mark} dependencies={dependencies} transport={model.transport} residueItemIds={residueItemIds}
      closeForResidue={id => { if (full) { residueTarget.current = id; dialog.current?.close(); } }}
      changePage={(next, target) => { setTarget(target); setFocusCanvas(true); setPage(next); }} />
    <details className="schematic-notes"><summary>Как читать схему{graph.cycles.length > 0 ? ` · циклов: ${graph.cycles.length}` : ''}</summary><p>Частота — настройка машины; работа — доля активного времени. Средняя частота разных конфигураций справочная: настройки каждой смотрите в составе узла. МВт суммируются по исходным конфигурациям.</p><p>{graph.physicalRouting ? 'Конвейерные разделители и соединители показаны по проверенному результату: каждый узел — одно устройство, каждое ребро — одна физическая лента. Одинаковые здания в групповом виде и здания других страниц сохраняют все физические связи. Трубы остаются представлением средних потоков; равное деление к ним не применяется. Геометрическое размещение в игровом мире не рассчитано.' : <>{mode === 'types' ? 'Разделитель и соединитель здесь условные. Линия может означать несколько параллельных лент или труб; их количество подписано на ребре.' : `Связи идут напрямую между машинами. Каждая линия передаёт не более ${number(model.transport.belt.rate)} шт/мин или ${number(model.transport.pipe.rate)} м³/мин. Большие потоки показаны отдельными параллельными линиями; проценты — доля общего потока предмета.`} Точная разводка, физические порты и размещение распределителей не рассчитаны.</>}</p><p>Средняя мощность учитывает работу, пик — одновременную нагрузку физических машин. Простои standby, синхронизация и запуск не моделируются. Неизвестная энергия импорта остаётся вне расчёта.</p>{graph.cycles.map(c => <div className="alert warning" key={c.recipeIds.join('|')}><div><strong>Совместный контур: {c.names.join(' → ')}</strong><p>Возвратные потоки сохраняются. Обеспечьте начальное заполнение, приоритет возврата и отвод побочных продуктов. Стартовый запас и время запуска не рассчитаны.</p>{c.internalFlows.map(f => <p key={f.itemId}>{catalog.items.find(i => i.id === f.itemId)?.name ?? f.itemId}: внутри произведено {number(f.produced)}, потреблено {number(f.consumed)} {unit(catalog.items.find(i => i.id === f.itemId))}.</p>)}</div></div>)}<p>Разные рецепты показаны отдельными узлами. Возвратные связи обходят производственные ветви сверху.</p></details>
    {graph.warnings.length > 0 && <details className="schematic-notes"><summary>Численные остатки потоков ({graph.warnings.length})</summary>{graph.warnings.map(w => <p key={w}>{w}</p>)}</details>}
  </>;
  return <><section className="panel schematic-panel" role="region" aria-label="Схема строительства">{content(false)}</section><dialog className={`schematic-dialog${canvasOnly ? ' schematic-only' : ''}`} aria-label="Схема строительства" ref={dialog} onCancel={event => { event.preventDefault(); if (canvasOnly) setCanvasOnly(false); else dialog.current?.close(); }} onClose={() => {
    setCanvasOnly(false); setExpanded(false);
    const id = residueTarget.current;
    residueTarget.current = null;
    if (id) document.getElementById('residue-' + id)?.focus();
    else expandButton.current?.focus();
  }}>{expanded && <>{content(true)}<button type="button" className="secondary-button schematic-restore" hidden={!canvasOnly} ref={restoreButton} title="Показать панели (Escape)" onClick={() => setCanvasOnly(false)}>Показать панели</button></>}</dialog></>;
}
