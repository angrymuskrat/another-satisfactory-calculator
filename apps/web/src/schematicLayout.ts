import type { SchematicEdge, SchematicModel } from '../../../packages/domain/schematic';

export type Rect = { x: number; y: number; width: number; height: number };
type Size = Pick<Rect, 'width' | 'height'>;
type Point = { x: number; y: number };
export type SchematicLayout = { width: number; height: number; rects: Record<string, Rect> };
const padding = 90, gap = 240, rowGap = 90;

/** A DFS spanning forest reserves a vertical band per branch. Shared nodes and
 * cycles are drawn once; all non-tree edges remain in the original graph. */
export function layoutSchematic(graph: SchematicModel, sizes: Record<string, Size>): SchematicLayout {
  const nodes = [...graph.nodes].sort((a, b) => a.stage - b.stage || a.id.localeCompare(b.id));
  const byId = new Map(nodes.map(n => [n.id, n]));
  const stages = [...new Set(nodes.map(n => n.stage))];
  const columns = new Map(stages.map((stage, i) => [stage, i]));
  const width = Math.max(280, ...Object.values(sizes).map(s => s.width));
  const children = new Map(nodes.map(n => [n.id, new Set<string>()]));
  let outerEdges = 0;
  for (const edge of graph.edges) {
    const a = byId.get(edge.from)!, b = byId.get(edge.to)!;
    if (b.stage > a.stage) children.get(a.id)!.add(b.id);
    if (columns.get(b.stage)! - columns.get(a.stage)! !== 1) outerEdges++;
  }
  const top = padding + outerEdges * 18;
  const seen = new Set<string>();
  type Branch = { id: string; height: number; children: Branch[] };
  const visit = (id: string): Branch => {
    seen.add(id);
    const branches: Branch[] = [];
    for (const child of [...children.get(id)!].sort((a, b) => byId.get(a)!.stage - byId.get(b)!.stage || a.localeCompare(b))) {
      if (!seen.has(child)) branches.push(visit(child));
    }
    return { id, children: branches, height: Math.max(sizes[id]?.height ?? 340,
      branches.reduce((s, b) => s + b.height, 0) + Math.max(0, branches.length - 1) * rowGap) };
  };
  const rects: Record<string, Rect> = {};
  const place = (branch: Branch, y: number) => {
    const size = sizes[branch.id] ?? { width: 280, height: 340 };
    rects[branch.id] = { ...size, x: padding + columns.get(byId.get(branch.id)!.stage)! * (width + gap),
      y: y + (branch.height - size.height) / 2 };
    const childHeight = branch.children.reduce((s, b) => s + b.height, 0) + Math.max(0, branch.children.length - 1) * rowGap;
    let cursor = y + (branch.height - childHeight) / 2;
    for (const child of branch.children) { place(child, cursor); cursor += child.height + rowGap; }
  };
  let cursor = top;
  for (const node of nodes) if (!seen.has(node.id)) {
    const branch = visit(node.id);
    place(branch, cursor); cursor += branch.height + rowGap;
  }
  return { width: Math.max(1000, padding * 2 + stages.length * (width + gap) - gap),
    height: Math.max(600, cursor - rowGap + padding), rects };
}

/** Horizontal exits/entries, with 45-degree diagonals and vertical runs for
 * long changes of height. Return and skipped-stage edges use the top gutter. */
export function routeSchematicEdges(graph: SchematicModel, layout: SchematicLayout) {
  const routes: Record<string, { points: Point[]; label: Point; d: string }> = {};
  // A new graph can precede its measured layout by one render.
  if (graph.edges.some(e => !layout.rects[e.from] || !layout.rects[e.to])) return routes;
  const outgoing = new Map<string, SchematicEdge[]>(), incoming = new Map<string, SchematicEdge[]>();
  for (const edge of graph.edges) {
    for (const [id, index] of [[edge.from, outgoing], [edge.to, incoming]] as const) {
      const list = index.get(id) ?? []; list.push(edge); index.set(id, list);
    }
  }
  const columns = new Map([...new Set(Object.values(layout.rects).map(r => r.x))].sort((x, y) => x - y).map((x, i) => [x, i]));
  const sourcePorts = new Map<string, number>(), targetPorts = new Map<string, number>();
  const portY = (rect: Rect, index: number, count: number) => rect.y + 45 + (rect.height - 60) * (index + 1) / (count + 1);
  for (const [index, ports, other] of [[outgoing, sourcePorts, 'to'], [incoming, targetPorts, 'from']] as const) {
    for (const [id, edges] of index) {
      edges.sort((l, r) => layout.rects[l[other]].y - layout.rects[r[other]].y || l.id.localeCompare(r.id));
      edges.forEach((e, i) => ports.set(e.id, portY(layout.rects[id], i, edges.length)));
    }
  }
  let outerIndex = 0;
  for (const edge of graph.edges) {
    const a = layout.rects[edge.from], b = layout.rects[edge.to];
    const x1 = a.x + a.width, x2 = b.x;
    const y1 = sourcePorts.get(edge.id)!, y2 = targetPorts.get(edge.id)!;
    let points: Point[], label: Point;
    if (columns.get(b.x)! - columns.get(a.x)! !== 1) {
      const top = 48 + outerIndex++ * 18;
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
