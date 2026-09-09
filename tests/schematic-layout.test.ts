import { expect, it } from 'vitest';
import { layoutSchematic, routeSchematicEdges } from '../apps/web/src/schematicLayout';
import type { SchematicModel, SchematicNode } from '../packages/domain/schematic';

function graph() {
  return { nodes: [['source', 0], ['a', 1], ['b', 2], ['c', 1], ['d', 2], ['end', 3]].map(([id, stage]) => ({ id, stage })),
    edges: [['source', 'a'], ['a', 'b'], ['source', 'c'], ['c', 'd'], ['b', 'end'], ['d', 'end']]
      .map(([from, to], i) => ({ id: `${i}`, from, to, kind: 'flow', rate: 10, parallel: 1 })) } as SchematicModel;
}
it('размещает ветви в глубину, центрирует общий источник и не перекрывает карточки', () => {
  const g = graph();
  const layout = layoutSchematic(g, { c: { width: 280, height: 470 } });
  const center = (id: string) => layout.rects[id].y + layout.rects[id].height / 2;
  expect(center('a')).toBe(center('b'));
  expect(center('c')).toBe(center('d'));
  expect(center('source')).toBeGreaterThan(center('a'));
  expect(center('source')).toBeLessThan(center('c'));
  const rects = Object.values(layout.rects);
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const a = rects[i], b = rects[j];
    expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true);
  }
  expect(layoutSchematic(g, { c: { width: 280, height: 470 } })).toEqual(layout);
});
it('сохраняет циклы, длинные связи и изолированные узлы в границах полотна', () => {
  const g = graph();
  g.nodes.push({ id: 'isolated', stage: 0 } as SchematicNode);
  g.edges.push({ ...g.edges[0], id: 'return', from: 'end', to: 'a' }, { ...g.edges[0], id: 'skip', from: 'source', to: 'end' });
  const layout = layoutSchematic(g, {});
  const routes = routeSchematicEdges(g, layout);
  expect(Object.keys(layout.rects)).toHaveLength(g.nodes.length);
  for (const edge of g.edges) {
    const route = routes[edge.id];
    expect(route.points.every(p => p.x >= 0 && p.x <= layout.width && p.y >= 0 && p.y <= layout.height)).toBe(true);
    expect(route.d).not.toMatch(/[CQ]/);
    for (let i = 1; i < route.points.length; i++) {
      const dx = Math.abs(route.points[i].x - route.points[i - 1].x), dy = Math.abs(route.points[i].y - route.points[i - 1].y);
      expect(dx === 0 || dy === 0 || Math.abs(dx - dy) < 1e-7).toBe(true);
    }
    expect(route.points[0].y).toBe(route.points[1].y);
    expect(route.points.at(-1)!.y).toBe(route.points.at(-2)!.y);
    const points = route.points.filter((p, i, all) => i === 0 || p.x !== all[i - 1].x || p.y !== all[i - 1].y);
    for (let i = 1; i < points.length - 1; i++) {
      const a = { x: points[i].x - points[i - 1].x, y: points[i].y - points[i - 1].y };
      const b = { x: points[i + 1].x - points[i].x, y: points[i + 1].y - points[i].y };
      const cosine = (a.x * b.x + a.y * b.y) / (Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y));
      expect(cosine).toBeGreaterThanOrEqual(Math.SQRT1_2 - 1e-7);
    }
  }
});
