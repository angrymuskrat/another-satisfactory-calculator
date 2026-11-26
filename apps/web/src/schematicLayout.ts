import type { SchematicEdge, SchematicModel, SchematicNode } from '../../../packages/domain/schematic';

export type Rect = { x: number; y: number; width: number; height: number };
type Size = Pick<Rect, 'width' | 'height'>;
export type Point = { x: number; y: number };
export type SchematicLayout = { width: number; height: number; rects: Record<string, Rect> };
export const MEDIUM_NODE: Size = { width: 200, height: 56 };
const padding = 90, GUTTER = 48;
/** Cards start below the gutter that routeSchematicEdges uses for long and return links. */
export const SCHEMATIC_TOP = 96;
const CLOSE_WIDTH = 250;

export function placeSchematicNodes<L extends SchematicLayout>(initial: L, positions: Record<string, Point>): L {
  if (!Object.keys(positions).length) return initial;
  const rects = { ...initial.rects };
  let { width, height } = initial;
  for (const [id, point] of Object.entries(positions)) {
    if (!rects[id]) continue;
    rects[id] = { ...rects[id], x: Math.max(0, point.x), y: Math.max(SCHEMATIC_TOP, point.y) };
    width = Math.max(width, rects[id].x + rects[id].width + padding);
    height = Math.max(height, rects[id].y + rects[id].height + padding);
  }
  return { ...initial, rects, width, height };
}

export function closeNodeSize(node: SchematicNode): Size {
  return { width: CLOSE_WIDTH, height: 64 + 18 * (node.inputs.length + node.outputs.length) + (node.parts?.length ? 30 : 0) };
}

/** Maps a manual position, stored in medium coordinates, onto the close layout. */
export function toCloseCoordinates(point: Point, medium: SchematicLayout, close: SchematicLayout): Point {
  return { x: medium.width ? point.x * close.width / medium.width : point.x, y: medium.height ? point.y * close.height / medium.height : point.y };
}

/** Scroll that keeps `nodeId` at the same screen position across a zoom (and
 * layout) change; without the node the content point under the pointer stays.
 * Scroll is clamped at 0, so a node near the canvas origin may still move. */
export function zoomAnchor(before: SchematicLayout, after: SchematicLayout, nodeId: string, pointer: Point,
  zoomBefore: number, zoomAfter: number, scroll: { scrollLeft: number; scrollTop: number }) {
  const a = before.rects[nodeId], b = after.rects[nodeId];
  const [left, top] = a && b
    ? [b.x * zoomAfter - a.x * zoomBefore + scroll.scrollLeft, b.y * zoomAfter - a.y * zoomBefore + scroll.scrollTop]
    : [(scroll.scrollLeft + pointer.x) / zoomBefore * zoomAfter - pointer.x, (scroll.scrollTop + pointer.y) / zoomBefore * zoomAfter - pointer.y];
  return { scrollLeft: Math.max(0, left), scrollTop: Math.max(0, top) };
}

/** Keep text off cards and other labels. Dense links keep their arrows and
 * expose their full description in the connection list. Selected links go first. */
export function placeFlowLabels(layout: SchematicLayout, labels: { id: string; at: Point; width: number; height: number }[]) {
  const cells = new Map<string, Rect[]>();
  const keys = (r: Rect) => {
    const result: string[] = [];
    for (let x = Math.floor(r.x / 120); x <= (r.x + r.width) / 120; x++)
      for (let y = Math.floor(r.y / 60); y <= (r.y + r.height) / 60; y++) result.push(`${x}/${y}`);
    return result;
  };
  const occupy = (rect: Rect) => {
    for (const key of keys(rect)) {
      const others = cells.get(key);
      if (others) others.push(rect); else cells.set(key, [rect]);
    }
  };
  for (const rect of Object.values(layout.rects)) occupy(rect);
  const placed = new Map<string, Point>();
  for (const { id, at, width, height } of labels) {
    if (placed.has(id)) continue;
    for (const dy of [0, -24, 24, -48, 48, -72, 72]) {
      const r = { x: at.x - width / 2, y: at.y + dy - 15, width, height };
      if (r.x < 0 || r.y < 0 || r.x + width > layout.width || r.y + height > layout.height) continue;
      if (keys(r).some(key => cells.get(key)?.some(b => r.x < b.x + b.width && b.x < r.x + width && r.y < b.y + b.height && b.y < r.y + height))) continue;
      placed.set(id, { x: at.x, y: at.y + dy }); occupy(r); break;
    }
  }
  return placed;
}

/** Horizontal exits/entries, with 45-degree diagonals and vertical runs for
 * long changes of height. Return and skipped-stage edges use the top gutter.
 * With `moved`, only the edges touching those cards are routed. */
export function routeSchematicEdges(graph: SchematicModel, layout: SchematicLayout, moved?: ReadonlySet<string>) {
  const routes: Record<string, { points: Point[]; label: Point; d: string }> = {};
  if (graph.edges.some(e => !layout.rects[e.from] || !layout.rects[e.to])) return routes;
  const outgoing = new Map<string, SchematicEdge[]>(), incoming = new Map<string, SchematicEdge[]>();
  for (const edge of graph.edges) {
    for (const [id, index] of [[edge.from, outgoing], [edge.to, incoming]] as const) {
      const list = index.get(id) ?? []; list.push(edge); index.set(id, list);
    }
  }
  const stages = [...new Set(graph.nodes.map(n => n.stage))].sort((a, b) => a - b);
  const columns = new Map(graph.nodes.map(n => [n.id, stages.indexOf(n.stage)]));
  const outer = (e: SchematicEdge) => columns.get(e.to)! - columns.get(e.from)! !== 1
    || layout.rects[e.to].x - layout.rects[e.from].x - layout.rects[e.from].width < 56;
  const routed = moved ? graph.edges.filter(e => moved.has(e.from) || moved.has(e.to)) : graph.edges;
  const outerCount = routed.filter(outer).length;
  // Gutter lanes stay above every card, so their vertical runs never turn back.
  const topGap = Math.max(0, Math.min(18, (Math.min(...Object.values(layout.rects).map(r => r.y)) - GUTTER - 8) / Math.max(1, outerCount)));
  const sourcePorts = new Map<string, number>(), targetPorts = new Map<string, number>();
  // Close cards keep ports below the title; medium cards spread them over the whole card.
  const portY = (rect: Rect, index: number, count: number) => {
    const [top, bottom] = rect.height > MEDIUM_NODE.height ? [45, 15] : [0, 0];
    return rect.y + top + (rect.height - top - bottom) * (index + 1) / (count + 1);
  };
  for (const [index, ports, other] of [[outgoing, sourcePorts, 'to'], [incoming, targetPorts, 'from']] as const) {
    for (const [id, edges] of index) {
      edges.sort((l, r) => layout.rects[l[other]].y - layout.rects[r[other]].y || l.id.localeCompare(r.id));
      edges.forEach((e, i) => ports.set(e.id, portY(layout.rects[id], i, edges.length)));
    }
  }
  let outerIndex = 0;
  for (const edge of routed) {
    const a = layout.rects[edge.from], b = layout.rects[edge.to];
    const x1 = a.x + a.width, x2 = b.x;
    const y1 = sourcePorts.get(edge.id)!, y2 = targetPorts.get(edge.id)!;
    let points: Point[], label: Point;
    if (outer(edge)) {
      const top = GUTTER + outerIndex++ * topGap;
      const turn = x2 > x1 ? 20 : -20;
      points = [[x1, y1], [x1 + 28, y1], [x1 + 48, y1 - 20], [x1 + 48, top + 20],
        [x1 + 48 + turn, top], [x2 - 48 - turn, top], [x2 - 48, top + 20], [x2 - 48, y2 - 20], [x2 - 28, y2], [x2, y2]]
        .map(([x, y]) => ({ x, y }));
      label = { x: (x1 + x2) / 2, y: top - 23 };
    } else {
      const lead = 28, dy = y2 - y1, direction = Math.sign(dy);
      const diagonal = Math.min(Math.abs(dy) / 2, (x2 - x1 - 2 * lead) / 2);
      points = (Math.abs(dy) <= x2 - x1 - 2 * lead
        ? [[x1, y1], [(x1 + x2 - Math.abs(dy)) / 2, y1], [(x1 + x2 + Math.abs(dy)) / 2, y2], [x2, y2]]
        : [[x1, y1], [x1 + lead, y1], [x1 + lead + diagonal, y1 + direction * diagonal],
          [x2 - lead - diagonal, y2 - direction * diagonal], [x2 - lead, y2], [x2, y2]])
        .map(([x, y]) => ({ x, y }));
      label = { x: (x1 + x2) / 2, y: (y1 + y2) / 2 - 23 };
    }
    routes[edge.id] = { points, label, d: points.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ') };
  }
  return routes;
}
