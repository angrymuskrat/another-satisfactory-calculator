import { beforeAll, describe, expect, it } from 'vitest';
import { closeNodeSize, placeFlowLabels, placeSchematicNodes, routeSchematicEdges, toCloseCoordinates, zoomAnchor, type Point, type SchematicLayout } from '../apps/web/src/schematicLayout';
import { layoutBoth, layoutWithElk, type MediumLayout } from '../apps/web/src/schematicElk';
import { readPositions, schematicPositionsKey, writePositions } from '../apps/web/src/SchematicPosition';
import type { SchematicNode } from '../packages/domain/schematic';
import { expectEdgesAvoidNodes, graph } from './schematicFixtures';

describe('ручные позиции и подписи на средней раскладке', () => {
  let medium: MediumLayout;
  beforeAll(async () => { medium = await layoutWithElk(graph()); });

  it('переносит конец стрелки за карточкой и размещает подписи вне занятых областей', () => {
    const g = graph();
    const moved = placeSchematicNodes(medium, { b: { x: 1400, y: 700 } });
    const edge = g.edges.find(e => e.to === 'b')!;
    expect(routeSchematicEdges(g, moved)[edge.id].points.at(-1)?.x).toBe(1400);
    expect(medium.rects.b).not.toEqual(moved.rects.b);
    const label = { at: { x: 485, y: 320 }, width: 160, height: 36 };
    const positions = placeFlowLabels(moved, [{ id: 'first', ...label }, { id: 'second', ...label }]);
    expect(positions.size).toBe(2);
    expect(Math.abs(positions.get('first')!.y - positions.get('second')!.y)).toBeGreaterThanOrEqual(label.height);
    const blocked = placeFlowLabels(moved, [{ id: 'third', at: { x: 1500, y: 728 }, width: 50, height: 120 }]);
    expect(blocked.size).toBe(0);
  });
});

/** graph() plus an isolated node, a return edge and a skipped-stage edge. */
function loopedGraph() {
  const g = graph();
  g.nodes.push({ id: 'isolated', stage: 0, inputs: [], outputs: [] } as unknown as SchematicNode);
  g.edges.push({ ...g.edges[0], id: 'return', from: 'end', to: 'a' }, { ...g.edges[0], id: 'skip', from: 'source', to: 'end' });
  return g;
}

function expectRouteShape(route: { points: Point[]; d: string }, layout: SchematicLayout) {
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
    expect((a.x * b.x + a.y * b.y) / (Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y))).toBeGreaterThanOrEqual(Math.SQRT1_2 - 1e-7);
  }
}

describe('маршруты сдвинутых карточек', () => {
  it('сохраняют циклы, длинные связи и изолированные узлы в границах полотна', () => {
    const g = loopedGraph();
    const card = (x: number, y: number) => ({ x, y, width: 200, height: 56 });
    const layout: SchematicLayout = { width: 1200, height: 420, rects: {
      source: card(12, 134), a: card(312, 96), c: card(312, 172), b: card(612, 96), d: card(612, 172), end: card(912, 134), isolated: card(12, 300),
    } };
    const routes = routeSchematicEdges(g, layout);
    for (const edge of g.edges) expectRouteShape(routes[edge.id], layout);
    expectEdgesAvoidNodes(g, { rects: layout.rects, bends: Object.fromEntries(g.edges.map(e => [e.id, routes[e.id].points])) });
  });

  it('на раскладке ELK обходят чужие карточки и не поднимают карточку в коридор длинных связей', async () => {
    // ELK puts source, a, b and end on one top row; the return and skip edges then need the gutter.
    const g = loopedGraph(), medium = await layoutWithElk(graph());
    const top = Math.min(...Object.values(medium.rects).map(r => r.y));
    expect(['source', 'a', 'b', 'end'].map(id => medium.rects[id].y)).toEqual([top, top, top, top]);
    // The top-row card `a` stays where it is but counts as moved; `end` goes below the factory.
    const moved = placeSchematicNodes(medium, { a: medium.rects.a, end: { x: medium.rects.end.x, y: medium.height + 150 } });
    const routes = routeSchematicEdges(g, moved, new Set(['a', 'end']));
    const rerouted = g.edges.filter(e => [e.from, e.to].some(id => id === 'a' || id === 'end'));
    expect(Object.keys(routes).sort()).toEqual(rerouted.map(e => e.id).sort());
    for (const edge of rerouted) expectRouteShape(routes[edge.id], moved);
    expectEdgesAvoidNodes(g, { rects: moved.rects, bends: Object.fromEntries(rerouted.map(e => [e.id, routes[e.id].points])) });
    expect(placeSchematicNodes(medium, { b: { x: medium.rects.b.x, y: 0 } }).rects.b.y).toBeGreaterThanOrEqual(top);
  });

  it('распределяют порты по всей высоте карточки 56 px, а коридор делят только между своими связями', () => {
    const g = graph();
    g.edges.push(...['b', 'c', 'd'].map(to => ({ ...g.edges[0], id: `skip-${to}`, from: 'source', to })));
    const card = (x: number, y: number) => ({ x, y, width: 200, height: 56 });
    const layout: SchematicLayout = { width: 1200, height: 420, rects: {
      source: card(12, 134), a: card(312, 96), c: card(312, 172), b: card(612, 96), d: card(612, 172), end: card(912, 134),
    } };
    const routes = routeSchematicEdges(g, layout);
    const exits = g.edges.filter(e => e.from === 'source').map(e => routes[e.id].points[0].y).sort((l, r) => l - r);
    expect(exits.length).toBeGreaterThanOrEqual(4);
    expect(new Set(exits).size).toBe(exits.length);
    expect(exits[0]).toBeGreaterThan(134);
    expect(exits.at(-1)!).toBeLessThan(134 + 56);
    expect(exits.at(-1)! - exits[0]).toBeGreaterThanOrEqual(56 / 2);
    // Only the edges of a moved card take gutter lanes, so the lanes start at the top.
    const own = routeSchematicEdges(g, layout, new Set(['d']));
    expect(Object.keys(own).sort()).toEqual(g.edges.filter(e => e.from === 'd' || e.to === 'd').map(e => e.id).sort());
    expect(Math.min(...own['skip-d'].points.map(p => p.y))).toBe(48);
    expect(Math.min(...routes['skip-d'].points.map(p => p.y))).toBeGreaterThan(48);
  });
});

describe('близкая раскладка', () => {
  let medium: MediumLayout, close: MediumLayout;
  beforeAll(async () => { ({ medium, close } = await layoutBoth(graph())); });

  it('считает размер близкой карточки по входам, выходам и отметкам', () => {
    const node = { inputs: [{}, {}], outputs: [{}], parts: [{}] } as unknown as SchematicNode;
    expect(closeNodeSize(node)).toEqual({ width: 250, height: 64 + 18 * 3 + 30 });
    expect(closeNodeSize({ ...node, parts: [] })).toEqual({ width: 250, height: 64 + 18 * 3 });
  });

  it('ручная позиция одна на оба уровня', () => {
    const moved = placeSchematicNodes(medium, { b: { x: 900, y: 400 } });
    expect(moved.bends).toBe(medium.bends);
    expect(toCloseCoordinates(moved.rects.b, medium, close)).toEqual({ x: 900 * close.width / medium.width, y: 400 * close.height / medium.height });
    expect(toCloseCoordinates({ x: 0, y: 0 }, medium, close)).toEqual({ x: 0, y: 0 });
    const empty = { width: 0, height: 0, rects: {} };
    expect(toCloseCoordinates({ x: 70, y: 80 }, empty, empty)).toEqual({ x: 70, y: 80 });
  });

  it('оставляет узел под курсором на месте при переходе через 100%', () => {
    const scrollBefore = { scrollLeft: 400, scrollTop: 300 };
    const s = zoomAnchor(medium, close, 'b', { x: 300, y: 200 }, 0.9, 1, scrollBefore);
    const screenBefore = medium.rects.b.x * 0.9 - scrollBefore.scrollLeft;
    expect(Math.abs(close.rects.b.x * 1 - s.scrollLeft - screenBefore)).toBeLessThanOrEqual(4);
    const screenTop = medium.rects.b.y * 0.9 - scrollBefore.scrollTop;
    expect(Math.abs(close.rects.b.y * 1 - s.scrollTop - screenTop)).toBeLessThanOrEqual(4);
    const back = zoomAnchor(close, medium, 'b', { x: 300, y: 200 }, 1, 0.9, s);
    expect(back.scrollLeft).toBeCloseTo(scrollBefore.scrollLeft);
    expect(back.scrollTop).toBeCloseTo(scrollBefore.scrollTop);
  });

  it('не возвращает отрицательную прокрутку и без узла держит точку под курсором', () => {
    const clamped = zoomAnchor(close, medium, 'source', { x: 0, y: 0 }, 1, 0.5, { scrollLeft: 0, scrollTop: 0 });
    expect(clamped).toEqual({ scrollLeft: 0, scrollTop: 0 });
    const free = zoomAnchor(medium, close, 'missing', { x: 100, y: 50 }, 0.5, 1, { scrollLeft: 200, scrollTop: 100 });
    expect(free).toEqual({ scrollLeft: (200 + 100) / 0.5 - 100, scrollTop: (100 + 50) / 0.5 - 50 });
  });

  it('игнорирует позиции v1 и позиции исчезнувших узлов, не трогая v1', () => {
    const data = new Map<string, string>();
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); },
      removeItem: (k: string) => { data.delete(k); } };
    const v1Key = 'satisfactory:schematic-layout:v1:' + JSON.stringify(['plan', 'types']);
    const v1 = JSON.stringify([{ fingerprint: 'f', positions: { a: { x: 700, y: 700 } } }]);
    data.set(v1Key, v1);
    const key = schematicPositionsKey('plan', 'types');
    expect(key).toBe('satisfactory:schematic-layout:v2:' + JSON.stringify(['plan', 'types']));
    expect(readPositions(storage, key)).toEqual([]);
    writePositions(storage, key, 'f', { b: { x: 900, y: 400 }, gone: { x: 100, y: 100 } });
    expect(data.get(v1Key)).toBe(v1);
    const saved = readPositions(storage, key).find(e => e.fingerprint === 'f')!.positions;
    const placed = placeSchematicNodes(medium, saved);
    expect(Object.keys(placed.rects).sort()).toEqual(Object.keys(medium.rects).sort());
    expect(placed.rects.b).toMatchObject({ x: 900, y: 400 });
    expect(placed.rects.a).toEqual(medium.rects.a);
    writePositions(storage, key, 'f', null);
    expect(data.has(key)).toBe(false);
    expect(data.get(v1Key)).toBe(v1);
  });
});
