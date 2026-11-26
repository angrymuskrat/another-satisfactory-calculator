import { expect, it } from 'vitest';
import { layoutBoth, layoutWithElk, MEDIUM_NODE } from '../apps/web/src/schematicElk';
import { closeNodeSize } from '../apps/web/src/schematicLayout';
import { columnsOf, cycleGraph, expectColumnOrderKept, expectEdgesAvoidNodes, expectNoOverlap, graph, twoNodeGraph } from './schematicFixtures';

it('раскладывает слева направо без наложений и детерминированно', async () => {
  const g = graph();
  const a = await layoutWithElk(g), b = await layoutWithElk(g);
  expect(a).toEqual(b);
  for (const e of g.edges) expect(a.rects[e.from].x).toBeLessThan(a.rects[e.to].x);
  expectNoOverlap(a.rects);
  for (const e of g.edges) {
    const line = a.bends[e.id];
    expect(line.length).toBeGreaterThanOrEqual(2);
    expect(line[0].x).toBeCloseTo(a.rects[e.from].x + a.rects[e.from].width);
    expect(line.at(-1)!.x).toBeCloseTo(a.rects[e.to].x);
  }
});

it('раскладывает пустой граф и граф из двух узлов без NaN', async () => {
  expect(await layoutWithElk({ ...graph(), nodes: [], edges: [] })).toMatchObject({ width: expect.any(Number) });
  const two = await layoutWithElk(twoNodeGraph());
  expect(Object.values(two.rects).flatMap(r => [r.x, r.y]).every(Number.isFinite)).toBe(true);
});

it('раскладывает цикл с самопетлёй', async () => {
  const g = cycleGraph();
  const laid = await layoutWithElk(g);
  expectNoOverlap(laid.rects);
  expect(Object.keys(laid.rects)).toHaveLength(g.nodes.length);
  for (const e of g.edges) expect(laid.bends[e.id].length).toBeGreaterThanOrEqual(2);
});

it('expectEdgesAvoidNodes принимает раскладку и ловит ребро через чужой узел', async () => {
  const g = graph();
  const laid = await layoutWithElk(g);
  expectEdgesAvoidNodes(g, laid);
  const middle = laid.rects.b;
  const through = { ...laid.bends, '0': [{ x: middle.x - 10, y: middle.y + middle.height / 2 }, { x: middle.x + middle.width + 10, y: middle.y + middle.height / 2 }] };
  expect(() => expectEdgesAvoidNodes(g, { rects: laid.rects, bends: through })).toThrow();
});

it('считает близкую раскладку вторым проходом с близкими размерами и порядком средней', async () => {
  for (const g of [graph(), cycleGraph(), twoNodeGraph()]) {
    const { medium, close } = await layoutBoth(g);
    expect(medium).toEqual(await layoutWithElk(g));
    for (const n of g.nodes) {
      expect(medium.rects[n.id]).toMatchObject(MEDIUM_NODE);
      expect(close.rects[n.id]).toMatchObject(closeNodeSize(n));
    }
    expectNoOverlap(close.rects);
    expectEdgesAvoidNodes(g, close);
    for (const e of g.edges) {
      expect(medium.bends[e.id].length).toBeGreaterThanOrEqual(2);
      expect(close.bends[e.id].length).toBeGreaterThanOrEqual(2);
    }
    expectColumnOrderKept(medium, close);
  }
  const { medium } = await layoutBoth(graph());
  expect(columnsOf(medium).some(c => c.length > 1)).toBe(true);
});
