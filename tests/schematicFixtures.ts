import { expect } from 'vitest';
import type { Point, Rect } from '../apps/web/src/schematicLayout';
import type { SchematicModel } from '../packages/domain/schematic';

function build(nodes: [string, number][], edges: [string, string][]) {
  const flows = (side: 0 | 1, id: string) => edges.filter(e => e[side] === id).map(() => ({ itemId: 'x', rate: 10 }));
  return { nodes: nodes.map(([id, stage]) => ({ id, stage, inputs: flows(1, id), outputs: flows(0, id) })),
    edges: edges.map(([from, to], i) => ({ id: `${i}`, from, to, kind: 'flow', rate: 10, parallel: 1 })) } as SchematicModel;
}

export function graph() {
  return build([['source', 0], ['a', 1], ['b', 2], ['c', 1], ['d', 2], ['end', 3]],
    [['source', 'a'], ['a', 'b'], ['source', 'c'], ['c', 'd'], ['b', 'end'], ['d', 'end']]);
}

export function twoNodeGraph() {
  return build([['a', 0], ['b', 1]], [['a', 'b']]);
}

/** source→a, a→b→a cycle, and a self-loop on c. */
export function cycleGraph() {
  return build([['source', 0], ['a', 1], ['b', 2], ['c', 1]],
    [['source', 'a'], ['a', 'b'], ['b', 'a'], ['c', 'c']]);
}

export function expectNoOverlap(rects: Record<string, Rect>) {
  const list = Object.values(rects);
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j];
    expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true);
  }
}

/** Node ids grouped by identical x, left to right. */
export function columnsOf(layout: { rects: Record<string, Rect> }) {
  const columns = new Map<number, string[]>();
  for (const [id, r] of Object.entries(layout.rects)) columns.set(r.x, [...columns.get(r.x) ?? [], id]);
  return [...columns].sort(([a], [b]) => a - b).map(([, ids]) => ids);
}

export function orderY(layout: { rects: Record<string, Rect> }, ids: string[]) {
  return [...ids].sort((a, b) => layout.rects[a].y - layout.rects[b].y || a.localeCompare(b));
}

/** Every medium column stays one column in the close layout, in the same vertical order. */
export function expectColumnOrderKept(medium: { rects: Record<string, Rect> }, close: { rects: Record<string, Rect> }) {
  for (const column of columnsOf(medium)) {
    expect(new Set(column.map(id => close.rects[id].x)).size).toBe(1);
    expect(orderY(close, column)).toEqual(orderY(medium, column));
  }
}

/** No edge segment may cross the interior of a node other than the edge's own endpoints. */
export function expectEdgesAvoidNodes(graph: SchematicModel, layout: { rects: Record<string, Rect>; bends: Record<string, Point[]> }) {
  const crossed: string[] = [];
  for (const edge of graph.edges) {
    const line = layout.bends[edge.id] ?? [];
    for (const [id, r] of Object.entries(layout.rects)) {
      if (id === edge.from || id === edge.to) continue;
      const [x0, x1, y0, y1] = [r.x + 1, r.x + r.width - 1, r.y + 1, r.y + r.height - 1];
      for (let i = 1; i < line.length; i++) {
        const a = line[i - 1], b = line[i];
        if (Math.max(a.x, b.x) > x0 && Math.min(a.x, b.x) < x1 && Math.max(a.y, b.y) > y0 && Math.min(a.y, b.y) < y1) { crossed.push(`${edge.id}:${id}`); break; }
      }
    }
  }
  expect(crossed).toEqual([]);
}
