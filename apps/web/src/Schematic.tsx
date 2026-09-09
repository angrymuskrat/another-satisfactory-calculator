import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Factory, GitFork, Maximize2, Minus, Plus, X, Zap } from 'lucide-react';
import type { Catalog } from '../../../packages/domain/types';
import type { ConstructionModel } from '../../../packages/domain/construction';
import { buildSchematic, SCHEMATIC_PAGE_SIZE, type SchematicDestinations, type SchematicEdge, type SchematicMode, type SchematicModel, type SchematicNode } from '../../../packages/domain/schematic';
import { format, ItemIcon, unit } from './controls';
import { useSchematicNavigation } from './useSchematicNavigation';
import { layoutSchematic, routeSchematicEdges } from './schematicLayout';
import './schematic.css';

const number = (n: number) => n !== 0 && Math.abs(n) < .001 ? n.toExponential(3) : format(n, 3);
const kindLabels: Record<SchematicNode['kind'], string> = { building: 'ОБОРУДОВАНИЕ', source: 'ВНЕШНЯЯ ПОСТАВКА', product: 'ГОТОВЫЙ ПРОДУКТ', export: 'ПОТРЕБИТЕЛЬ', split: 'УСЛОВНЫЙ БЛОК', merge: 'УСЛОВНЫЙ БЛОК', continuation: 'ДРУГАЯ СТРАНИЦА' };
function SchematicCanvas({ catalog, graph, changePage, focusOnMount }: { catalog: Catalog; graph: SchematicModel; changePage: (page: number) => void; focusOnMount: boolean }) {
  const [selected, setSelected] = useState<string | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const { zoom, zoomTo, dragging, bindings } = useSchematicNavigation(viewport);
  const canvas = useRef<HTMLDivElement>(null), buttons = useRef(new Map<string, HTMLButtonElement>());
  const positioned = useRef(false);
  const [layout, setLayout] = useState(() => layoutSchematic(graph, {}));
  const routes = useMemo(() => routeSchematicEdges(graph, layout), [graph, layout]);
  const marker = useId().replaceAll(':', ''), detailId = useId();
  useEffect(() => { if (focusOnMount) canvas.current?.closest<HTMLElement>('.schematic-viewport')?.focus(); }, [focusOnMount]);
  const item = (id?: string) => catalog.items.find(i => i.id === id);
  const active = graph.nodes.find(n => n.id === selected);
  const incident = graph.edges.filter(e => e.from === selected || e.to === selected);
  const neighbors = new Set(incident.flatMap(e => [e.from, e.to]));
  const select = (id: string, focus = false) => {
    setSelected(id);
    if (focus) { buttons.current.get(id)?.focus({ preventScroll: true }); buttons.current.get(id)?.scrollIntoView({ block: 'nearest', inline: 'center' }); }
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
      const next = layoutSchematic(graph, sizes);
      setLayout(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
      if (!positioned.current) {
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
  }, [graph, zoom]);
  const edgeText = (edge: SchematicEdge) => edge.kind === 'control' ? 'Связь скважины' : `${item(edge.itemId)?.name ?? edge.itemId}: ${number(edge.rate)} ${unit(item(edge.itemId))}${edge.share !== undefined ? ` · ${number(edge.share * 100)}%` : ''}`;
  const visibleEdge = (edge: SchematicEdge) => {
    const route = routes[edge.id];
    if (!route) return null;
    const { d, label: position } = route;
    const highlighted = !selected || edge.from === selected || edge.to === selected;
    const label = edge.kind === 'control' ? 'Скважина' : `${number(edge.rate)} ${unit(item(edge.itemId))}${edge.share !== undefined ? ` · ${number(edge.share * 100)}%` : ''}`;
    return <g key={edge.id} data-rate={edge.rate} data-item-id={edge.itemId} className={`${edge.kind} ${item(edge.itemId)?.fluid ? 'fluid' : ''} ${highlighted ? '' : 'dim'}`}>
      <path d={d} markerEnd={`url(#${marker})`}><title>{edgeText(edge)}</title></path>
      <text x={position.x} y={position.y} textAnchor="middle"><tspan x={position.x}>{edge.kind === 'flow' ? item(edge.itemId)?.name ?? edge.itemId : ''}</tspan><tspan x={position.x} dy="16">{label}{edge.parallel > 1 ? ` · ×${edge.parallel}` : ''}</tspan></text>
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
    </div><span><i className="schematic-legend-dot" /> Здания <i className="schematic-legend-dot fluid" /> Жидкости <span className="schematic-legend-line">┄</span> Связь скважины</span></div>
    <div className={`schematic-viewport${dragging ? ' is-dragging' : ''}`} ref={viewport} {...bindings} tabIndex={0} role="group" aria-label="Полотно схемы, прокрутка стрелками" aria-description="Перетаскивайте мышью для перемещения. Колесо изменяет масштаб вокруг указателя.">
      <div className="schematic-scaled" style={{ width: layout.width * zoom, height: layout.height * zoom }}>
        <div className="schematic-canvas" ref={canvas} style={{ transform: `scale(${zoom})`, width: layout.width, height: layout.height }}>
          <svg className="schematic-edges" width={layout.width} height={layout.height} aria-hidden="true"><defs><marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#aab5bd" /></marker></defs>{graph.edges.map(visibleEdge)}</svg>
            {graph.nodes.map(node => {
              const junction = node.kind === 'merge' || node.kind === 'split';
              const differentClocks = new Set(node.configurations.map(g => g.clock)).size > 1;
              const differentDuties = new Set(node.configurations.map(g => g.activeDuty)).size > 1;
              const duty = node.count ? node.configurations.reduce((s, g) => s + g.count * g.activeDuty, 0) / node.count : null;
              return <article key={node.id} data-node-id={node.id} data-kind={node.kind} data-building-id={node.buildingId} data-count={node.count}
                style={{ left: layout.rects[node.id]?.x ?? 90, top: layout.rects[node.id]?.y ?? 90 }}
                className={`schematic-node ${junction ? 'junction' : ''} ${item(node.itemId)?.fluid ? 'fluid' : ''} ${selected === node.id ? 'selected' : selected && !neighbors.has(node.id) ? 'muted-node' : ''}`}>
                <button type="button" ref={el => { if (el) buttons.current.set(node.id, el); else buttons.current.delete(node.id); }} className="schematic-node-button" aria-pressed={selected === node.id} aria-controls={detailId} onClick={() => select(node.id)}>
                  <span className="schematic-kind">{kindLabels[node.kind]}</span><span className="schematic-node-title">{junction ? <GitFork size={22} /> : node.count ? <Factory size={22} /> : <ItemIcon item={item(node.itemId)} size={28} />}<strong>{node.label}</strong>{node.count > 0 && <b>×{node.count}</b>}</span>
                  {node.configurations.length > 0 && <span className="schematic-recipe">{node.configurations.length === 1 ? node.configurations[0].name : `${node.configurations.length} конфигурации · раскрыть состав`}</span>}
                </button>
                {node.count > 0 && <div className="schematic-settings"><span>{differentClocks ? 'Средняя частота' : 'Частота'} <strong>{number(node.clock!)}%</strong></span><span>{differentDuties ? 'Средняя доля работы' : 'Работа'} <strong>{number(duty! * 100)}%</strong> времени</span>{(differentClocks || differentDuties) && <small>Настройки различаются · см. состав</small>}{node.existing > 0 && <small>Уже есть {node.existing} · добавить {node.count - node.existing}</small>}</div>}
                {junction ? <p className="schematic-junction-rate">{number(node.inputs[0].rate)} <small>{unit(item(node.itemId))}</small><span>Игрок настраивает блок</span></p> : <>{flows(node, 'inputs')}{flows(node, 'outputs')}</>}
                {(node.count > 0 || node.kind === 'source') && <div className="schematic-power"><Zap size={15} />{node.averagePower === null ? <span>Энергия поставки неизвестна</span> : <><strong>{number(node.averagePower)} МВт</strong><span>средняя · пик {number(node.peakPower!)} МВт</span></>}</div>}
                {node.kind === 'continuation' && <button type="button" className="secondary-button schematic-page-link" onClick={() => changePage(node.page!)}>К этим зданиям · стр. {node.page! + 1}<ArrowRight size={15} /></button>}
              </article>;
            })}
        </div>
      </div>
    </div>
    <p className="hint schematic-hint">Зажмите левую или среднюю кнопку мыши и тяните полотно. Колесо меняет масштаб вокруг указателя. Щелчок по узлу показывает рецепты и соединения; стрелки обозначают средние потоки.</p>
    <div id={detailId} className="schematic-details">
      {active ? <><div className="section-heading"><h3>{active.label}{active.count > 0 && ` ×${active.count}`}</h3><button type="button" className="text-button" onClick={() => setSelected(null)}>Снять выделение</button></div>
        {active.configurations.length > 0 && <div className="schematic-configurations">{active.configurations.map(g => <div key={g.id}><strong>{g.name} · {g.count} зданий</strong>{g.recipeId && <span>Рецепт: {catalog.recipes.find(r => r.id === g.recipeId)?.name ?? g.recipeId}</span>}<span>Частота {number(g.clock)}% · работа {number(g.activeDuty * 100)}% времени · Somersloops на машину: {g.somersloops ?? 0}</span><span>Активная машина: {number(g.activePower)} МВт · средняя группы: {number(g.averagePower)} МВт · пик: {number(g.peakPower)} МВт</span>{g.powerEstimated && <span>Мощность оценочная по каталогу.</span>}</div>)}</div>}
        <h4>Соединения выбранного узла</h4><ul className="schematic-connections">{incident.map(e => {
          const other = graph.nodes.find(n => n.id === (e.from === active.id ? e.to : e.from))!;
          return <li key={e.id}><button type="button" onClick={() => select(other.id, true)}><span>{e.from === active.id ? '→ Куда: ' : '← Откуда: '}{other.label}</span><strong>{edgeText(e)}</strong>{e.kind === 'flow' && <small>Не менее {e.parallel} {item(e.itemId)?.fluid ? 'параллельных труб' : 'параллельных лент'} по среднему потоку</small>}</button></li>;
        })}</ul>{!incident.length && <p>Предметные соединения не используются.</p>}</> : <p className="hint">Нажмите на заголовок здания или распределительного блока. Здесь появятся точные настройки и переходы к соседним узлам.</p>}
    </div>
  </>;
}

export function Schematic({ catalog, model, destinations, mode }: { catalog: Catalog; model: ConstructionModel; destinations: SchematicDestinations; mode: SchematicMode }) {
  const [page, setPage] = useState(0), [expanded, setExpanded] = useState(false);
  const [focusCanvas, setFocusCanvas] = useState(false);
  const [canvasOnly, setCanvasOnly] = useState(false);
  const onlyButton = useRef<HTMLButtonElement>(null), restoreButton = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null), expandButton = useRef<HTMLButtonElement>(null);
  const computed = useMemo(() => {
    try { return { graph: buildSchematic(catalog, model, destinations, mode, page), error: '' }; }
    catch (e) { return { graph: null, error: e instanceof Error ? e.message : 'Не удалось построить схему.' }; }
  }, [catalog, model, destinations, mode, page]);
  useEffect(() => { if (expanded) dialog.current?.showModal(); }, [expanded]);
  useLayoutEffect(() => {
    if (!dialog.current?.open) return;
    dialog.current.scrollTop = 0;
    (canvasOnly ? restoreButton : onlyButton).current?.focus({ preventScroll: true });
  }, [canvasOnly]);
  const graph = computed.graph;
  if (!graph) return <section className="panel" role="alert"><h3>Схема не прошла перепроверку</h3><p>{computed.error}</p><p>Исходная инструкция остаётся доступна.</p></section>;
  const content = (full: boolean) => <>
    <div className="schematic-heading"><div><span className="eyebrow">ОТ РЕСУРСА ДО ПРОДУКТА</span><h3>Схема строительства</h3><p>{mode === 'types' ? 'Один узел — одинаковые здания с одним рецептом' : 'Один узел — одно физическое здание'} · всего {graph.machineCount} зданий</p></div>
      {full ? <div className="schematic-full-actions"><button type="button" className="secondary-button" ref={onlyButton} onClick={() => setCanvasOnly(true)}>Только схема</button><button type="button" className="secondary-button" onClick={() => dialog.current?.close()}><X size={17} />Закрыть схему</button></div> : <button type="button" className="secondary-button" ref={expandButton} onClick={() => setExpanded(true)}><Maximize2 size={17} />На весь экран</button>}
    </div>
    {mode === 'machines' && graph.pages > 1 && <nav className="schematic-pagination" aria-label="Страницы зданий"><button type="button" className="secondary-button" disabled={graph.page === 0} onClick={() => { setFocusCanvas(false); setPage(graph.page - 1); }}>Назад</button><span>Страница {graph.page + 1} из {graph.pages} · здания {graph.page * SCHEMATIC_PAGE_SIZE + 1}–{Math.min(graph.machineCount, (graph.page + 1) * SCHEMATIC_PAGE_SIZE)}<small>Остальные здания показаны переходами с полными потоками.</small></span><button type="button" className="secondary-button" disabled={graph.page + 1 === graph.pages} onClick={() => { setFocusCanvas(false); setPage(graph.page + 1); }}>Далее</button></nav>}
    <SchematicCanvas key={`${mode}:${graph.page}`} catalog={catalog} graph={graph} focusOnMount={focusCanvas} changePage={next => { setFocusCanvas(true); setPage(next); }} />
    <details className="schematic-notes"><summary>Как читать схему{graph.cycles.length > 0 ? ` · циклов: ${graph.cycles.length}` : ''}</summary><p>Частота — настройка машины; работа — доля активного времени. Средняя частота разных конфигураций справочная: настройки каждой смотрите в составе узла. МВт суммируются по исходным конфигурациям.</p><p>{mode === 'types' ? 'Разделитель и соединитель здесь условные. Линия может означать несколько параллельных лент или труб; их количество подписано на ребре.' : `Связи идут напрямую между машинами. Каждая линия передаёт не более ${number(model.transport.belt.rate)} шт/мин или ${number(model.transport.pipe.rate)} м³/мин. Большие потоки показаны отдельными параллельными линиями; проценты — доля общего потока предмета.`} Точная разводка, физические порты и размещение распределителей не рассчитаны.</p><p>Средняя мощность учитывает работу, пик — одновременную нагрузку физических машин. Простои standby, синхронизация и запуск не моделируются. Неизвестная энергия импорта остаётся вне расчёта.</p>{graph.cycles.map(c => <div className="alert warning" key={c.recipeIds.join('|')}><div><strong>Совместный контур: {c.names.join(' → ')}</strong><p>Возвратные потоки сохраняются. Обеспечьте начальное заполнение, приоритет возврата и отвод побочных продуктов. Стартовый запас и время запуска не рассчитаны.</p>{c.internalFlows.map(f => <p key={f.itemId}>{catalog.items.find(i => i.id === f.itemId)?.name ?? f.itemId}: внутри произведено {number(f.produced)}, потреблено {number(f.consumed)} {unit(catalog.items.find(i => i.id === f.itemId))}.</p>)}</div></div>)}<p>Разные рецепты показаны отдельными узлами. Возвратные связи обходят производственные ветви сверху.</p></details>
    {graph.warnings.length > 0 && <details className="schematic-notes"><summary>Численные остатки потоков ({graph.warnings.length})</summary>{graph.warnings.map(w => <p key={w}>{w}</p>)}</details>}
  </>;
  return <><section className="panel schematic-panel" role="region" aria-label="Схема строительства">{content(false)}</section><dialog className={`schematic-dialog${canvasOnly ? ' schematic-only' : ''}`} aria-label="Схема строительства" ref={dialog} onCancel={event => { event.preventDefault(); if (canvasOnly) setCanvasOnly(false); else dialog.current?.close(); }} onClose={() => { setCanvasOnly(false); setExpanded(false); expandButton.current?.focus(); }}>{expanded && <>{content(true)}<button type="button" className="secondary-button schematic-restore" hidden={!canvasOnly} ref={restoreButton} title="Показать панели (Escape)" onClick={() => setCanvasOnly(false)}>Показать панели</button></>}</dialog></>;
}
