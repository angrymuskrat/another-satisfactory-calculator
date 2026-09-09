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

const length = (g: SchematicModel, layout: ReturnType<typeof layoutSchematic>) => Object.values(routeSchematicEdges(g, layout))
  .reduce((sum, route) => sum + route.points.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - route.points[i].x, p.y - route.points[i].y), 0), 0);

it('отдельные машины сокращают суммарную длину общих связей, сохраняя граф и размеры', () => {
  const g = graph();
  const sizes = { c: { width: 280, height: 470 } };
  const before = structuredClone(g);
  const dfs = layoutSchematic(g, sizes);
  const optimized = layoutSchematic(g, sizes, 'machines');
  expect(length(g, optimized)).toBeLessThan(length(g, dfs) - 50);
  expect(g).toEqual(before);
  expect(optimized.rects.c.height).toBe(470);
  expect(layoutSchematic(g, sizes, 'machines')).toEqual(optimized);
  const rects = Object.values(optimized.rects);
  for (const a of rects) for (const b of rects) if (a !== b) {
    expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true);
  }
});

it('оптимизация не удлиняет циклы, параллельные связи и переходы через стадии', () => {
  const g = graph();
  g.nodes.push({ id: 'isolated', stage: 0 } as SchematicNode);
  g.edges.push({ ...g.edges[0], id: 'cycle', from: 'end', to: 'a' }, { ...g.edges[0], id: 'skip', from: 'source', to: 'end' });
  for (let i = 0; i < 20; i++) g.edges.push({ ...g.edges[0], id: `parallel${i}` });
  const dfs = layoutSchematic(g, {}), optimized = layoutSchematic(g, {}, 'machines');
  expect(length(g, optimized)).toBeLessThanOrEqual(length(g, dfs));
  expect(Object.keys(optimized.rects)).toHaveLength(g.nodes.length);
  const routes = routeSchematicEdges(g, optimized);
  expect(Object.keys(routes)).toHaveLength(g.edges.length);
  expect(Object.values(routes).every(r => r.points.every(p => p.x >= 0 && p.y >= 0 && p.x <= optimized.width && p.y <= optimized.height))).toBe(true);
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
