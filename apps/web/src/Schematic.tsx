import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Maximize2, Minus, Plus, Search, X } from 'lucide-react';
import type { Catalog } from '../../../packages/domain/types';
import type { ConstructionModel } from '../../../packages/domain/construction';
import { buildSchematic, filterSchematicFlows, SCHEMATIC_MIN_FLOW_SHARE, type MachineSpan, type SchematicDestinations, type SchematicEdge, type SchematicMode, type SchematicModel, type SchematicNode } from '../../../packages/domain/schematic';
import { constructionDependencies, type BuiltRanges } from '../../../packages/domain/constructionProgress';
import { unit } from './controls';
import { useSchematicNavigation, type ZoomScroll } from './useSchematicNavigation';
import { placeFlowLabels, placeSchematicNodes, routeSchematicEdges, toCloseCoordinates, zoomAnchor, type Point } from './schematicLayout';
import type { MediumLayout } from './schematicElk';
import { useSchematicLayout } from './useSchematicLayout';
import { itemColor, itemLineWidth } from './schematicColors';
import { BuildMark, number, SchematicNodeCard, type Destination } from './SchematicNodeCard';
import { MoveNode, useSchematicPositions } from './SchematicPosition';
import { SchematicMinimap } from './SchematicMinimap';
import { findNodes } from './schematicSearch';
import './schematic.css';

type Tracking = { built: BuiltRanges; mark: (parts: MachineSpan[], count: number) => void };
type Level = 'medium' | 'close';
type CanvasProps = Tracking & {
  catalog: Catalog; graph: SchematicModel; dependencies: ReturnType<typeof constructionDependencies>;
  manual: ReturnType<typeof useSchematicPositions>; transport: ConstructionModel['transport'];
  residueItemIds?: readonly string[]; closeForResidue: (id: string) => void; actions: ReactNode;
  nextId?: string; focus?: string | null; onFocused?: () => void;
};
const levelOf = (zoom: number): Level => zoom > .999 ? 'close' : 'medium';
// Below this on-screen size the card title is unreadable, so the card keeps only its product and count.
const NODE_TITLE_PX = 13, READABLE_PX = 9;
const represents = (n: SchematicNode, target: Destination) => n.parts?.some(p => p.id === target.id && p.first <= target.index && target.index < p.first + p.count);
type Size = { width: number; height: number };
const fits = (room: Size, layout: Size) => Math.min(room.width / layout.width, room.height / layout.height);
// One pixel of slack keeps a fitted canvas from rounding into scrollbars.
const roomOf = (e: HTMLElement): Size => ({ width: e.offsetWidth - 2 * e.clientLeft - 1, height: e.offsetHeight - 2 * e.clientTop - 1 });

function SchematicCanvas(props: CanvasProps) {
  const state = useSchematicLayout(props.graph);
  if (state.status === 'pending') return <><div className="schematic-controls">{props.actions}</div><p className="hint schematic-layout-state" role="status">Раскладываю схему…</p></>;
  if (state.status === 'error') return <><div className="schematic-controls">{props.actions}</div><p className="hint schematic-layout-state" role="alert">Не удалось разложить схему.</p></>;
  return <SchematicView {...props} layouts={state.layout} />;
}

function SchematicView({ catalog, graph, built, mark, dependencies, manual, transport, residueItemIds, closeForResidue, actions, layouts, nextId, focus, onFocused }: CanvasProps & {
  layouts: { medium: MediumLayout; close: MediumLayout };
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null), [readyOnly, setReadyOnly] = useState(false);
  // Manual positions, including the drag preview, are kept in medium coordinates.
  const [preview, setPreview] = useState<{ id: string; point: Point } | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const positions = useMemo(() => preview ? { ...manual.positions, [preview.id]: preview.point } : manual.positions, [manual.positions, preview]);
  const placed = useMemo(() => ({
    medium: placeSchematicNodes(layouts.medium, positions),
    close: placeSchematicNodes(layouts.close, Object.fromEntries(Object.entries(positions).map(([id, p]) => [id, toCloseCoordinates(p, layouts.medium, layouts.close)]))),
  }), [layouts, positions]);
  const anchor = useRef({ placed, selected });
  anchor.current = { placed, selected };
  // Crossing 100% swaps the layout: keep the selected node, or the one nearest to the pointer, in place.
  const rescroll = useCallback<ZoomScroll>(({ from, to, pointer, scroll }) => {
    if (levelOf(from) === levelOf(to)) return null;
    const { placed: both, selected: chosen } = anchor.current, before = both[levelOf(from)];
    const x = (scroll.scrollLeft + pointer.x) / from, y = (scroll.scrollTop + pointer.y) / from;
    let id = chosen && before.rects[chosen] ? chosen : '', best = Infinity;
    if (!id) for (const [key, r] of Object.entries(before.rects)) {
      const distance = Math.hypot(Math.max(r.x - x, 0, x - r.x - r.width), Math.max(r.y - y, 0, y - r.y - r.height));
      if (distance < best) { best = distance; id = key; }
    }
    return zoomAnchor(before, both[levelOf(to)], id, pointer, from, to, scroll);
  }, []);
  // Measured without scrollbars, so reaching the fit does not move the limit.
  const [room, setRoom] = useState<Size | null>(null);
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const read = () => {
      const next = roomOf(element);
      if (next.width > 0 && next.height > 0) setRoom(r => r?.width === next.width && r.height === next.height ? r : next);
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const minZoom = Math.max(.1, room ? Math.min(.9, fits(room, placed.medium)) : .1);
  const { zoom, zoomTo, dragging, bindings } = useSchematicNavigation(viewport, rescroll, minZoom);
  const level = levelOf(zoom), layout = placed[level];
  const simple = level === 'medium' && NODE_TITLE_PX * zoom < READABLE_PX;
  const [query, setQuery] = useState(''), [hit, setHit] = useState(-1);
  const order = useMemo(() => Object.entries(layout.rects).sort(([, a], [, b]) => a.x - b.x || a.y - b.y).map(([id]) => id), [layout]);
  const matches = useMemo(() => findNodes(graph, catalog, query, order), [graph, catalog, query, order]);
  const toMedium = (p: Point): Point => level === 'medium' || !layouts.close.width || !layouts.close.height ? p
    : { x: p.x * layouts.medium.width / layouts.close.width, y: p.y * layouts.medium.height / layouts.close.height };
  const moved = useMemo(() => new Set(Object.keys(positions).filter(id => layout.rects[id])), [positions, layout]);
  const fallback = useMemo(() => moved.size ? routeSchematicEdges(graph, layout, moved) : {}, [graph, layout, moved]);
  const lines = useMemo(() => {
    const result = new Map<string, Point[]>();
    for (const e of graph.edges) {
      const own = layouts[level].bends[e.id];
      const points = !moved.has(e.from) && !moved.has(e.to) && own?.length >= 2 ? own : fallback[e.id]?.points;
      if (points) result.set(e.id, points);
    }
    return result;
  }, [graph, layouts, level, moved, fallback]);
  const marker = useId().replaceAll(':', ''), detailId = useId();
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
  };
  const edgeText = (edge: SchematicEdge) => edge.kind === 'control' ? 'Связь скважины' : `${item(edge.itemId)?.name ?? edge.itemId}: ${number(edge.rate)} ${unit(item(edge.itemId))}${edge.share !== undefined ? ` · ${number(edge.share * 100)}%` : ''}`;
  const capacity = (e: SchematicEdge) => item(e.itemId)?.fluid ? transport.pipe : transport.belt;
  const selectedLink = graph.edges.find(e => e.id === selectedEdge);
  const residueLinks = residueItemIds?.filter(id => item(id)?.fluid && (selectedLink
    ? selectedLink.itemId === id : active?.outputs.some(f => f.itemId === id && f.rate > 0)));
  const isReturn = (e: SchematicEdge) => e.kind === 'flow' && byId.get(e.to)!.stage <= byId.get(e.from)!.stage
    && graph.cycles.some(c => c.internalFlows.some(f => f.itemId === e.itemId) && byId.get(e.to)!.configurations.some(g => c.recipeIds.includes(g.id)));
  const highlight = (e: SchematicEdge) => selectedEdge ? e.id === selectedEdge : !selected || e.from === selected || e.to === selected;
  const labelText = (e: SchematicEdge) => `${number(e.rate)}${e.parallel > 1 ? ` ×${e.parallel}` : ''}`;
  const labels = useMemo(() => placeFlowLabels(layout, graph.edges.filter(e => !simple && e.kind === 'flow' && highlight(e) && lines.has(e.id)).map(e => {
    const end = lines.get(e.id)!.at(-1)!, width = (item(e.itemId)?.icon ? 20 : 4) + labelText(e).length * 7 + 4;
    // 40 px in front of the consumer's port; wider labels move left so they stay off the card.
    return { id: e.id, at: { x: end.x - Math.max(40, width / 2 + 4), y: end.y }, width, height: 20 };
  })), [graph, layout, lines, items, selected, selectedEdge, simple]);
  const visibleEdge = (edge: SchematicEdge) => {
    const points = lines.get(edge.id);
    if (!points) return null;
    const fluid = !!item(edge.itemId)?.fluid, icon = item(edge.itemId)?.icon, label = labels.get(edge.id);
    const back = layout.rects[edge.to].x < layout.rects[edge.from].x;
    const style = edge.kind === 'flow' && edge.itemId ? { '--edge-color': itemColor(edge.itemId, fluid), '--edge-width': `${itemLineWidth(fluid)}px` } as CSSProperties : undefined;
    const left = label && label.x - ((icon ? 20 : 4) + labelText(edge).length * 7 + 4) / 2;
    return <g key={edge.id} data-rate={edge.rate} data-item-id={edge.itemId} style={style}
      className={`${edge.kind} ${fluid ? 'fluid' : ''} ${back ? 'back' : ''} ${highlight(edge) ? '' : 'dim'} ${selectedEdge === edge.id ? 'picked' : ''}`}>
      <path d={points.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ')} markerEnd={`url(#${marker})`} onClick={() => { select(edge.from); setSelectedEdge(edge.id); }}><title>{byId.get(edge.from)!.label} → {byId.get(edge.to)!.label} · {edgeText(edge)}</title></path>
      {label && left !== undefined && <>
        {icon && <image href={icon} x={left + 2} y={label.y - 13} width="16" height="16" />}
        <text x={left + (icon ? 20 : 4)} y={label.y}>{labelText(edge)}</text>
      </>}
    </g>;
  };
  const fit = () => {
    const element = viewport.current;
    if (!element) return;
    const space = roomOf(element);
    zoomTo(fits(space, placed.close) >= 1 ? 1 : Math.min(.9, fits(space, placed.medium)));
  };
  const centre = (id: string) => {
    const element = viewport.current, r = layout.rects[id];
    if (element && r) element.scrollTo({ left: (r.x + r.width / 2) * zoom - element.clientWidth / 2, top: (r.y + r.height / 2) * zoom - element.clientHeight / 2 });
  };
  const clearSearch = () => { setQuery(''); setHit(-1); };
  const holds = (n: SchematicNode, id?: string | null) => !!id && !!n.parts?.some(p => p.id === id);
  useEffect(() => {
    const node = graph.nodes.find(n => holds(n, focus));
    if (!node) return;
    select(node.id, true); centre(node.id); onFocused?.();
  }, [focus]);
  const help = <>Тяните фон для перемещения полотна. Колесо меняет масштаб. Карточку можно передвинуть за ручку или стрелками на ручке. Выберите стрелку, чтобы увидеть маршрут и пропускную способность. Мини-карта в левом нижнем углу перемещает полотно щелчком и перетаскиванием; Enter в поиске переходит к следующему совпадению. {graph.physicalRouting ? 'Все физические конвейерные связи показаны, включая малые ветви. Порог малых потоков применяется только к трубам.' : <>Связи меньше {number(SCHEMATIC_MIN_FLOW_SHARE * 100)}% общего потока предмета скрыты.</>} Очерёдность стройки учитывает и малые поставки. Материалы в инвентаре, подключение питания и стартовое заполнение контура проверяет игрок.</>;
  const sink = !!active?.configurations.some(g => g.kind === 'sink');
  const differentClocks = !!active && new Set(active.configurations.map(g => g.clock)).size > 1;
  const differentDuties = !!active && new Set(active.configurations.map(g => g.activeDuty)).size > 1;
  const duty = active?.count ? active.configurations.reduce((s, g) => s + g.count * g.activeDuty, 0) / active.count : null;
  const generated = active?.configurations.some(g => g.generatedPower !== undefined) ? active.configurations.reduce((n, g) => n + (g.generatedPower ?? 0), 0) : null;
  return <>
    <div className="schematic-controls"><div className="schematic-zoom" role="group" aria-label="Масштаб схемы">
      <button type="button" className="icon-button" aria-label="Уменьшить масштаб" disabled={zoom <= minZoom + 1e-9} onClick={() => zoomTo(zoom - .1)}><Minus size={17} /></button>
      <button type="button" className="secondary-button" aria-label="Масштаб 100 процентов" onClick={() => zoomTo(1)}>{Math.round(zoom * 100)}%</button>
      <button type="button" className="icon-button" aria-label="Увеличить масштаб" disabled={zoom >= 1.5} onClick={() => zoomTo(zoom + .1)}><Plus size={17} /></button>
      <button type="button" className="secondary-button" onClick={fit}>Уместить</button>
    </div>
    <div className="schematic-search"><Search size={15} aria-hidden="true" /><input type="search" aria-label="Найти на схеме" placeholder="Здание, рецепт или предмет" value={query}
      onChange={e => { setQuery(e.target.value); setHit(-1); }}
      onKeyDown={e => {
        if (e.key === 'Enter' && matches.length) {
          e.preventDefault();
          const next = (hit + 1) % matches.length;
          setHit(next); select(matches[next]); centre(matches[next]);
        } else if (e.key === 'Escape' && query) { e.preventDefault(); e.stopPropagation(); clearSearch(); }
      }} />
      {query.trim() && <span className="schematic-search-count" role="status">{hit + 1} из {matches.length}</span>}</div>
    <label><input type="checkbox" checked={readyOnly} onChange={e => setReadyOnly(e.target.checked)} /> Подсветить: можно строить</label>
    <button type="button" className="secondary-button" disabled={!Object.keys(manual.positions).length} onClick={() => manual.save()}>Вернуть автораскладку</button>
    {actions}
    <details className="schematic-help"><summary aria-label="Как управлять схемой" title="Как управлять схемой">?</summary><p className="hint">{help}</p></details></div>
    {manual.error && <p className="hint" role="alert">{manual.error}</p>}
    {readyOnly && <div className="schematic-ready-list" aria-label="Готовые блоки">{[...progress].filter(([, p]) => p.ready).map(([id, p]) => <button type="button" className="text-button" key={id} onClick={() => goTo(p.firstReady!)}>{byId.get(id)!.label} · {p.ready}</button>)}{![...progress.values()].some(p => p.ready) && 'Все блоки отмечены.'}</div>}
    <div className="schematic-stage"><div className="schematic-frame"><div className={`schematic-viewport${dragging ? ' is-dragging' : ''}`} ref={viewport} {...bindings} tabIndex={0} role="group" aria-label="Полотно схемы, прокрутка стрелками" aria-description="Перетаскивайте мышью для перемещения. Колесо изменяет масштаб вокруг указателя.">
      <div className="schematic-scaled" style={{ width: layout.width * zoom, height: layout.height * zoom }}>
        <div className="schematic-canvas" data-layout="elk" data-level={level} style={{ transform: `scale(${zoom})`, width: layout.width, height: layout.height }}>
          <svg className="schematic-edges" width={layout.width} height={layout.height} aria-hidden="true"><defs><marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" style={{ fill: 'var(--edge-marker)' }} /></marker></defs>{graph.edges.map(visibleEdge)}</svg>
          {graph.nodes.map(node => {
            const rect = layout.rects[node.id];
            if (!rect) return null;
            const status = progress.get(node.id);
            return <SchematicNodeCard key={node.id} node={node} level={level} rect={rect} items={items} progress={status} built={built} mark={mark}
              selected={selected === node.id} next={holds(node, nextId)} simple={simple} muted={!!selected && !neighbors.has(node.id) || readyOnly && !status?.ready} detailId={detailId}
              buttonRef={el => { if (el) buttons.current.set(node.id, el); else buttons.current.delete(node.id); }}
              onSelect={() => select(node.id)} onGoTo={goTo}>
              <MoveNode name={node.label} position={rect} zoom={zoom}
                preview={point => setPreview(point ? { id: node.id, point: toMedium(point) } : null)} save={p => manual.save(node.id, toMedium(p))} />
            </SchematicNodeCard>;
          })}
        </div>
      </div>
    </div>
    <SchematicMinimap layout={layout} viewport={viewport} zoom={zoom} onMove={scroll => { const element = viewport.current; if (element) { element.scrollLeft = scroll.scrollLeft; element.scrollTop = scroll.scrollTop; } }} /></div>
    <div id={detailId} className={`schematic-details${active ? ' is-open' : ''}`} role="region" aria-label="Подробности узла">
      {active ? <><div className="section-heading"><h3>{active.label}{active.count > 0 && ` ×${active.count}`}</h3><button type="button" className="text-button" onClick={() => { setSelected(null); setSelectedEdge(null); }}>Снять выделение</button></div>
        {active.routingDepth !== undefined && <p className="schematic-summary">{active.kind === 'split' ? 'Конвейерный разделитель' : 'Конвейерный соединитель'} · Проверенные порты · глубина {active.routingDepth}</p>}
        {sink && <p className="schematic-summary">Утилизация предметов</p>}
        {active.configurations.length > 0 && <p className="schematic-summary">{differentClocks ? 'Средняя частота' : 'Частота'} {number(active.clock!)}% · {differentDuties ? 'Средняя доля работы' : 'Работа'} {number(duty! * 100)}% времени{(differentClocks || differentDuties) && ' · Настройки различаются · см. состав'}{active.existing > 0 && ` · Уже есть ${active.existing} · добавить ${active.count - active.existing}`}</p>}
        {(active.configurations.length > 0 || active.kind === 'source') && <p className="schematic-summary">{active.averagePower === null ? 'Энергия поставки неизвестна' : `Мощность ${number(active.averagePower)} МВт средняя · пик ${number(active.peakPower!)} МВт`}{generated !== null && ` · выработка ${number(generated)} МВт`}</p>}
        {progress.has(active.id) && <BuildMark node={active} progress={progress.get(active.id)!} built={built} mark={mark} items={items} onGoTo={goTo} adjustable />}
        {residueLinks?.map(id => <p key={id}><a href={'#residue-' + encodeURIComponent(id)} onClick={() => closeForResidue(id)}>Подобрать переработку — {item(id)?.name}</a></p>)}
        {!!progress.get(active.id)?.missing.length && <div className="schematic-blockers"><h4>Нужны поставщики</h4>{progress.get(active.id)!.missing.map(m =>
          <button type="button" className="text-button" key={JSON.stringify([m.id, m.index, m.itemId])} onClick={() => goTo(m)}>{item(m.itemId)?.name ?? 'Связь скважины'} ← {m.label}</button>)}</div>}
        {active.configurations.length > 0 && <div className="schematic-configurations">{active.configurations.map(g => <div key={g.id}><strong>{g.name} · зданий {g.count}</strong>{g.recipeId && <span>Рецепт: {catalog.recipes.find(r => r.id === g.recipeId)?.name ?? g.recipeId}</span>}<span>Частота {number(g.clock)}% · работа {number(g.activeDuty * 100)}% времени · Somersloops на машину: {g.somersloops ?? 0}</span><span>Активная машина: {number(g.activePower)} МВт · средняя группы: {number(g.averagePower)} МВт · пик: {number(g.peakPower)} МВт</span>{g.powerEstimated && <span>Мощность оценочная по каталогу.</span>}</div>)}</div>}
        <h4>Соединения выбранного узла</h4>
        {!!incident.length && <label>Выбрать линию <select value={selectedEdge ?? ''} onChange={e => setSelectedEdge(e.target.value || null)}><option value="">Все соединения</option>{incident.map(e =>
          <option key={e.id} value={e.id}>{byId.get(e.from)!.label} → {byId.get(e.to)!.label} · {edgeText(e)}</option>)}</select></label>}
        {selectedLink && <p role="status">{byId.get(selectedLink.from)!.label} → {byId.get(selectedLink.to)!.label} · {isReturn(selectedLink) && '↶ Возврат · '}{edgeText(selectedLink)}
          {selectedLink.kind === 'flow' && ` · ${capacity(selectedLink).name}, ${selectedLink.parallel} × ${number(capacity(selectedLink).rate)} ${unit(item(selectedLink.itemId))}`}</p>}
        <ul className="schematic-connections">{incident.map(e => {
          const other = graph.nodes.find(n => n.id === (e.from === active.id ? e.to : e.from))!;
          return <li key={e.id}><button type="button" onClick={() => select(other.id, true)}><span>{e.from === active.id ? '→ Куда: ' : '← Откуда: '}{other.label}</span><strong>{edgeText(e)}</strong>{e.kind === 'flow' && <small>{e.physicalRouting ? 'Одна физическая лента проверенной схемы' : <>Не менее {e.parallel} {item(e.itemId)?.fluid ? 'параллельных труб' : 'параллельных лент'} по среднему потоку</>}</small>}</button></li>;
        })}</ul>{!incident.length && <p>Предметные соединения не используются.</p>}</> : <p className="hint">Выберите узел, чтобы увидеть подробности.</p>}
    </div>
  </div>
  </>;
}

export function Schematic({ catalog, model, destinations, mode, scope, built, mark, residueItemIds, nextId, focus, onFocused }: Tracking & { catalog: Catalog; model: ConstructionModel; destinations: SchematicDestinations; mode: SchematicMode; scope: string; residueItemIds?: readonly string[]; nextId?: string; focus?: string | null; onFocused?: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const manual = useSchematicPositions(scope, mode, model.fingerprint);
  const dialog = useRef<HTMLDialogElement>(null), expandButton = useRef<HTMLButtonElement>(null);
  const residueTarget = useRef<string | null>(null);
  // Callers rebuild destinations on every render; a new graph would restart the worker layout.
  const destinationsKey = JSON.stringify(destinations);
  const stable = useMemo(() => destinations, [destinationsKey]);
  const tracking = useMemo(() => {
    try { return { dependencies: constructionDependencies(buildSchematic(catalog, model, stable, 'configurations')), error: '' }; }
    catch (e) { return { error: e instanceof Error ? e.message : 'Не удалось проверить зависимости.' }; }
  }, [catalog, model, stable]);
  const computed = useMemo(() => {
    try { return { graph: filterSchematicFlows(buildSchematic(catalog, model, stable, mode)), error: '' }; }
    catch (e) { return { graph: null, error: e instanceof Error ? e.message : 'Не удалось построить схему.' }; }
  }, [catalog, model, stable, mode]);
  useEffect(() => { if (expanded) dialog.current?.showModal(); }, [expanded]);
  const graph = computed.graph;
  const dependencies = tracking.dependencies;
  if (!graph || !dependencies) return <section className="panel" role="alert"><h3>Схема не прошла перепроверку</h3><p>{computed.error || tracking.error}</p><p>Исходная инструкция остаётся доступна.</p></section>;
  const content = (full: boolean) => <>
    <div className="schematic-heading"><div><h3>Схема строительства</h3><p>Один узел — одинаковые здания с одним рецептом · всего {graph.machineCount} зданий{graph.physicalRouting && ` · ${graph.nodes.filter(node => node.routingDepth !== undefined).length} устройств логистики`}</p></div></div>
    <SchematicCanvas key={mode} catalog={catalog} graph={graph}
      manual={manual} built={built} mark={mark} dependencies={dependencies} transport={model.transport} residueItemIds={residueItemIds} nextId={nextId} focus={full ? null : focus} onFocused={onFocused}
      closeForResidue={id => { if (full) { residueTarget.current = id; dialog.current?.close(); } }}
      actions={full ? <button type="button" className="secondary-button schematic-screen" onClick={() => dialog.current?.close()}><X size={17} />Закрыть схему</button>
        : <button type="button" className="secondary-button schematic-screen" ref={expandButton} onClick={() => setExpanded(true)}><Maximize2 size={17} />На весь экран</button>} />
    <div className="schematic-notes-row">
      <details className="schematic-notes"><summary>Как читать схему{graph.cycles.length > 0 ? ` · циклов: ${graph.cycles.length}` : ''}</summary><p>Частота — настройка машины; работа — доля активного времени. Средняя частота разных конфигураций справочная: настройки каждой смотрите в составе узла. МВт суммируются по исходным конфигурациям.</p><p>{graph.physicalRouting ? 'Конвейерные разделители и соединители показаны по проверенному результату: каждый узел — одно устройство, каждое ребро — одна физическая лента. Одинаковые здания в групповом виде сохраняют все физические связи. Трубы остаются представлением средних потоков; равное деление к ним не применяется. Геометрическое размещение в игровом мире не рассчитано.' : 'Связи идут напрямую от поставщиков к потребителям в стабильном порядке; «×N» на связи — число параллельных лент или труб по среднему потоку. Точная разводка, физические порты и размещение распределителей не рассчитаны.'}</p><p>Средняя мощность учитывает работу, пик — одновременную нагрузку физических машин. Простои standby, синхронизация и запуск не моделируются. Неизвестная энергия импорта остаётся вне расчёта.</p>{graph.cycles.map(c => <div className="alert warning" key={c.recipeIds.join('|')}><div><strong>Совместный контур: {c.names.join(' → ')}</strong><p>Возвратные потоки сохраняются. Обеспечьте начальное заполнение, приоритет возврата и отвод побочных продуктов. Стартовый запас и время запуска не рассчитаны.</p>{c.internalFlows.map(f => <p key={f.itemId}>{catalog.items.find(i => i.id === f.itemId)?.name ?? f.itemId}: внутри произведено {number(f.produced)}, потреблено {number(f.consumed)} {unit(catalog.items.find(i => i.id === f.itemId))}.</p>)}</div></div>)}<p>Разные рецепты показаны отдельными узлами. Обратные связи циклов показаны штрихом.</p></details>
      {graph.warnings.length > 0 && <details className="schematic-notes"><summary>Численные остатки потоков ({graph.warnings.length})</summary>{graph.warnings.map(w => <p key={w}>{w}</p>)}</details>}
    </div>
  </>;
  return <><section className="panel schematic-panel" role="region" aria-label="Схема строительства">{content(false)}</section><dialog className="schematic-dialog" aria-label="Схема строительства" ref={dialog} onClose={() => {
    setExpanded(false);
    const id = residueTarget.current;
    residueTarget.current = null;
    if (id) document.getElementById('residue-' + id)?.focus();
    else expandButton.current?.focus();
  }}>{expanded && content(true)}</dialog></>;
}
