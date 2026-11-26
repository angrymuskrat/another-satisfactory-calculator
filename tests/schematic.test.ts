import { describe, expect, it } from 'vitest';
import { buildSchematic, filterSchematicFlows } from '../packages/domain/schematic';
import { builtCount, constructionDependencies, firstMachines, markBuilt, markFirst } from '../packages/domain/constructionProgress';
import type { ConstructionGroup, ConstructionModel } from '../packages/domain/construction';
import type { Catalog } from '../packages/domain/types';

const catalog = {
  items: ['ore', 'ingot', 'plate', 'water'].map(id => ({ id, name: id, fluid: id === 'water' })),
  buildings: [{ id: 'smelter', name: 'Плавильня' }, { id: 'constructor', name: 'Конструктор' }, { id: 'sink', name: 'Утилизатор' }],
  miners: [],
} as unknown as Catalog;
const flow = (itemId: string, rate: number) => ({ itemId, rate });
function group(id: string, count = 4, input = 80.4): ConstructionGroup {
  return { id, kind: 'production', buildingId: 'smelter', name: id, recipeId: id,
    count, clock: 67, activeDuty: 1, activeInputs: [flow('ore', input / count)], activeOutputs: [flow('ingot', input / count)],
    averageInputs: [flow('ore', input)], averageOutputs: [flow('ingot', input)], activePower: 2,
    averagePower: count * 2, peakPower: count * 3, powerEstimated: false };
}
function model(production: ConstructionGroup[], supply = 80.4): ConstructionModel {
  return { production, extraction: [], sinks: [],
    externalSources: [{ sourceId: 'ore', name: 'Руда извне', itemId: 'ore', rate: supply, power: null }],
    transport: { belt: { id: 'belt', name: 'Лента', rate: 60 }, pipe: { id: 'pipe', name: 'Труба', rate: 300 } },
    fingerprint: 'fixture', materials: { items: [], unknown: [], totalMachines: 0, knownMachines: 0, complete: true },
    addedMaterials: { items: [], unknown: [], totalMachines: 0, knownMachines: 0, complete: true },
    productionIdlePower: 0, productionPower: 0, extractionPower: 0, sinkPower: 0, averagePower: 0, peakPower: 0,
  };
}
const destinations = { products: [flow('ingot', 80.4)] };

describe('схема строительства', () => {
  it('прослеживает конкретные машины до фильтра; групповые и одиночные отметки общие', () => {
    const smelters = group('smelters', 96, 960);
    const plates = { ...group('plates', 96, 960), averageInputs: [flow('ingot', 960)], averageOutputs: [flow('plate', 960)] };
    const graph = buildSchematic(catalog, model([plates, smelters], 960), { products: [flow('plate', 960)] }, 'configurations');
    const progress = constructionDependencies(graph);
    const span = (id: string, first: number, count: number) => [{ id, first, count }];
    const machine = span('plates', 70, 1);
    expect(progress(machine, {}).missing).toMatchObject([{ id: 'smelters', itemId: 'ingot', index: 70 }]);
    const all = span('smelters', 0, 96), built = markBuilt({}, all, true);
    const partial = markBuilt(built, span('smelters', 70, 2), false);
    expect(builtCount(partial, all)).toBe(94);
    expect(progress(span('plates', 0, 96), partial).ready).toBe(94);
    expect(progress(machine, partial).ready).toBe(0);
    expect(progress(span('plates', 69, 1), partial).ready).toBe(1);
    expect(progress(machine, markBuilt(partial, span('smelters', 70, 1), true)).ready).toBe(1);
    expect(progress(span('smelters', 0, 1), {}).missing[0].label).toBe('Руда извне');
  });

  it('отмечает ровно первые n машин узла по порядку частей и снимает остальные', () => {
    const parts = [{ id: 'a', first: 2, count: 3 }, { id: 'b', first: 0, count: 4 }];
    expect(firstMachines(parts, 0)).toEqual([]);
    expect(firstMachines(parts, 2)).toEqual([{ id: 'a', first: 2, count: 2 }]);
    expect(firstMachines(parts, 5)).toEqual([{ id: 'a', first: 2, count: 3 }, { id: 'b', first: 0, count: 2 }]);
    expect(firstMachines(parts, 99)).toEqual(parts);
    const other = { a: [[0, 1]] as [number, number][], b: [[3, 6]] as [number, number][] };
    const five = markFirst(other, parts, 5);
    expect(five).toEqual({ a: [[0, 1], [2, 5]], b: [[0, 2], [4, 6]] });
    expect(builtCount(five, parts)).toBe(5);
    expect(markFirst(five, parts, 1)).toEqual({ a: [[0, 1], [2, 3]], b: [[4, 6]] });
    expect(markFirst(five, parts, 0)).toEqual({ a: [[0, 1]], b: [[4, 6]] });
    expect(markFirst({}, parts, 7)).toEqual(markBuilt({}, parts, true));
  });

  it('ждёт малый внешний вход всего контура, затем рекомендует оба здания вместе', () => {
    const a = { ...group('a', 1, 20), averageInputs: [flow('water', 20.0001)], averageOutputs: [flow('ingot', 20)] };
    const b = { ...group('b', 1, 20), averageInputs: [flow('ingot', 20)], averageOutputs: [flow('water', 20), flow('plate', 1)] };
    const m = model([a, b]);
    m.externalSources = [{ sourceId: 'water', itemId: 'water', name: 'Подпитка водой', rate: .0001, power: null }];
    const graph = buildSchematic(catalog, m, { products: [flow('plate', 1)] }, 'configurations');
    const progress = constructionDependencies(graph);
    const source = graph.nodes.find(n => n.kind === 'source')!;
    expect(filterSchematicFlows(graph).edges.some(e => e.from === source.id)).toBe(false);
    const water = markBuilt({}, source.parts!, true);
    for (const id of ['a', 'b']) {
      const parts = [{ id, first: 0, count: 1 }];
      expect(progress(parts, {})).toMatchObject({ together: true, ready: 0, missing: [{ id: source.id, itemId: 'water' }] });
      expect(progress(parts, water)).toMatchObject({ together: true, ready: 1, missing: [] });
    }
  });
  it('скрывает связи ниже 0,01% общего потока предмета', () => {
    const m = model([group('large', 1, 99.985), group('boundary', 1, .01), group('tiny', 1, .005)], 100);
    m.transport.belt.rate = 120;
    const raw = buildSchematic(catalog, m, { products: [flow('ingot', 100)] }, 'types');
    const before = structuredClone(raw);
    const visible = filterSchematicFlows(raw);
    expect(visible.edges.some(e => e.rate === .005)).toBe(false);
    expect(visible.edges.some(e => Math.abs(e.rate - .01) < 1e-12)).toBe(true);
    expect(visible.edges.length).toBeLessThan(raw.edges.length);
    expect(raw).toEqual(before);
    expect(visible.nodes).toEqual(raw.nodes);
  });

  it('порог относительный: сохраняет самостоятельный малый выпуск и управляющую связь', () => {
    const raw = buildSchematic(catalog, model([group('small', 1, 1e-12)], 1e-12), { products: [flow('ingot', 1e-12)] }, 'types');
    raw.edges.push({ id: 'control', from: raw.nodes[0].id, to: raw.nodes[1].id, kind: 'control', rate: 0, parallel: 0 });
    expect(filterSchematicFlows(raw).edges).toEqual(raw.edges);
  });

  it('группирует одинаковый рецепт, суммирует МВт и взвешивает частоты по числу машин', () => {
    const second = { ...group('second-line', 2, 20), recipeId: 'iron', clock: 100, activeDuty: .5, averagePower: 5, existing: 2 };
    const graph = buildSchematic(catalog, model([group('iron'), second], 100.4), { products: [flow('ingot', 100.4)] }, 'types');
    const nodes = graph.nodes.filter(n => n.kind === 'building');
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ count: 6, existing: 2, averagePower: 13, peakPower: 18, clock: 78 });
    expect(nodes[0].configurations).toHaveLength(2);
    expect(nodes[0].inputs).toEqual([flow('ore', 100.4)]);
    expect(graph.nodes.find(n => n.kind === 'source')?.averagePower).toBeNull();
  });

  it('в групповом виде без учёта конвейеров соединяет поставщиков с потребителями напрямую', () => {
    const graph = buildSchematic(catalog, model([group('iron')]), destinations, 'types');
    expect(graph.nodes.some(n => n.kind === 'merge' || n.kind === 'split')).toBe(false);
    const machines = graph.nodes.filter(n => n.kind === 'building');
    expect(machines).toHaveLength(1);
    expect(machines[0]).toMatchObject({ count: 4, clock: 67, averagePower: 8, peakPower: 12, inputs: [flow('ore', 80.4)] });
    const source = graph.nodes.find(n => n.kind === 'source')!;
    expect(graph.edges.filter(e => e.from === source.id).map(e => e.rate)).toEqual([80.4]);
  });

  it('соединяет двух поставщиков с двумя потребителями без условных блоков, сохраняя суммарный поток', () => {
    const m = model([group('a', 1, 70), group('b', 1, 30)], 100);
    m.externalSources = [{ sourceId: 'p', name: 'P', itemId: 'ore', rate: 60, power: null }, { sourceId: 'q', name: 'Q', itemId: 'ore', rate: 40, power: null }];
    const graph = buildSchematic(catalog, m, { products: [flow('ingot', 100)] }, 'types');
    expect(graph.nodes.some(n => n.kind === 'merge' || n.kind === 'split')).toBe(false);
    const ore = graph.edges.filter(e => e.itemId === 'ore');
    expect(ore.reduce((s, e) => s + e.rate, 0)).toBeCloseTo(100);
    for (const e of ore) expect(graph.nodes.find(n => n.id === e.from)!.kind).toBe('source');
    for (const e of ore) expect(graph.nodes.find(n => n.id === e.to)!.kind).toBe('building');
  });

  it('подписывает неравные 40/30/20/10 процентов, не выбирая пары поставщиков и потребителей', () => {
    const groups = [40, 30, 20, 10].map((rate, i) => group(`line${i}`, 1, rate));
    const m = model(groups, 100);
    m.externalSources = [
      { sourceId: 'a', name: 'A', itemId: 'ore', rate: 55, power: 5 },
      { sourceId: 'b', name: 'B', itemId: 'ore', rate: 45, power: null },
    ];
    const graph = buildSchematic(catalog, m, { products: [flow('ingot', 100)] }, 'types');
    const ore = graph.edges.filter(e => e.itemId === 'ore');
    expect(graph.nodes.some(n => n.kind === 'merge' || n.kind === 'split')).toBe(false);
    expect(ore.reduce((s, e) => s + e.rate, 0)).toBeCloseTo(100);
    expect(ore.reduce((s, e) => s + e.share!, 0)).toBeCloseTo(1);
  });

  it('не превращает последовательные рецепты одного типа в настоящий цикл', () => {
    const a = group('a', 1, 10);
    const b = { ...group('b', 1, 10), averageInputs: [flow('ingot', 10)], averageOutputs: [flow('plate', 10)] };
    const graph = buildSchematic(catalog, model([a, b], 10), { products: [flow('plate', 10)] }, 'types');
    expect(graph.nodes.filter(n => n.kind === 'building')).toHaveLength(2);
    expect(graph.cycles).toHaveLength(0);
    expect(graph.edges.some(e => e.from === e.to)).toBe(false);
    expect(graph.edges.some(e => e.itemId === 'ingot')).toBe(true);
  });

  it('разные рецепты одного продукта и разные добываемые ресурсы не объединяются', () => {
    const m = model([group('normal', 1, 40), group('alternate', 1, 40)], 80);
    m.externalSources = [];
    m.extraction = ['ore', 'water'].map(itemId => ({ ...group(itemId, 1, 80), recipeId: undefined,
      kind: 'extraction', activeInputs: [], activeOutputs: [flow(itemId, 80)], averageInputs: [], averageOutputs: [flow(itemId, 80)] }));
    const graph = buildSchematic(catalog, m, { products: [flow('ingot', 80), flow('water', 80)] }, 'types');
    expect(graph.nodes.filter(n => n.kind === 'building')).toHaveLength(4);
  });

  it('распределяет 224 напрямую, соблюдая баланс на каждом узле', () => {
    const m = model([group('a', 50, 224)], 224);
    m.transport.belt.rate = 120;
    m.externalSources = [
      { sourceId: 'a', name: 'A', itemId: 'ore', rate: 130, power: null },
      { sourceId: 'b', name: 'B', itemId: 'ore', rate: 94, power: null },
    ];
    const graph = buildSchematic(catalog, m, { products: [flow('ingot', 224)] }, 'types');
    expect(graph.nodes.some(n => ['merge', 'split'].includes(n.kind))).toBe(false);
    expect(graph.edges.every(e => e.rate > 0)).toBe(true);
    for (const n of graph.nodes) for (const direction of ['inputs', 'outputs'] as const) {
      for (const f of n[direction]) expect(graph.edges.filter(e => e.itemId === f.itemId &&
        (direction === 'inputs' ? e.to === n.id : e.from === n.id)).reduce((s, e) => s + e.rate, 0)).toBeCloseTo(f.rate, 10);
    }
  });

  it('показывает большой поток одним ребром с числом параллельных лент или труб', () => {
    const m = model([], 0); m.externalSources = [];
    for (const [itemId, rate] of [['ore', 120 + 1e-10], ['water', 650]] as const) {
      m.externalSources.push({ sourceId: itemId, name: itemId, itemId, rate, power: null });
    }
    m.transport.belt.rate = 120;
    const graph = buildSchematic(catalog, m, { products: m.externalSources }, 'types');
    expect(graph.edges.filter(e => e.itemId === 'ore')).toMatchObject([{ rate: 120 + 1e-10, parallel: 1 }]);
    expect(graph.edges.filter(e => e.itemId === 'water')).toMatchObject([{ rate: 650, parallel: 3 }]);
  });

  it('в групповом виде твёрдая связь выше пропускной способности ленты получает ceil(расход / лента) лент', () => {
    const m = model([group('iron', 10, 300)], 300);
    m.transport.belt.rate = 120;
    const graph = buildSchematic(catalog, m, { products: [flow('ingot', 300)] }, 'types');
    const ore = graph.edges.filter(e => e.itemId === 'ore');
    expect(ore).toHaveLength(1);
    expect(ore[0].parallel).toBe(Math.ceil(300 / 120));
    expect(graph.edges.find(e => e.itemId === 'ingot')!.parallel).toBe(3);
  });

  it('сохраняет настоящий самовозврат, а также следовые потоки', () => {
    const loop = { ...group('loop', 1, 1e-12), averageInputs: [flow('ore', 1e-12), flow('water', 10)], averageOutputs: [flow('ingot', 1e-12), flow('water', 10)] };
    const graph = buildSchematic(catalog, model([loop], 1e-12), { products: [flow('ingot', 1e-12)] }, 'types');
    expect(graph.cycles).toHaveLength(1);
    expect(graph.edges.some(e => e.itemId === 'water' && e.rate === 10)).toBe(true);
    expect(graph.edges.some(e => e.itemId === 'ore' && e.rate === 1e-12)).toBe(true);
  });

  it('сохраняет экспорт и утилизацию отдельными конечными назначениями', () => {
    const m = model([group('a', 1, 100)], 100);
    m.sinks = [{ ...group('sink', 1, 10), kind: 'sink', buildingId: 'sink', averageInputs: [flow('ingot', 10)], averageOutputs: [], averagePower: 30, peakPower: 30 }];
    const graph = buildSchematic(catalog, m, { products: [flow('ingot', 70)], exports: [{ ...flow('ingot', 20), name: 'Соседняя фабрика' }] }, 'types');
    expect(graph.nodes.find(n => n.kind === 'export')?.label).toContain('Соседняя фабрика');
    expect(graph.nodes.find(n => n.buildingId === 'sink')).toMatchObject({ averagePower: 30, outputs: [] });
  });

  it('связывает компенсатор со спутниками без дополнительного потока или энергии', () => {
    const m = model([], 0); m.externalSources = [];
    m.extraction = [
      { ...group('well', 1, 10), kind: 'extraction', buildingId: 'resource-well-pressurizer', averageInputs: [], averageOutputs: [], averagePower: 150, peakPower: 150 },
      { ...group('satellites', 2, 10), kind: 'extraction', buildingId: 'resource-well-extractor', controllerId: 'well', averageInputs: [], averageOutputs: [flow('water', 10)], averagePower: 0, peakPower: 0 },
    ];
    const graph = buildSchematic(catalog, m, { products: [flow('water', 10)] }, 'types');
    expect(graph.edges.filter(e => e.kind === 'control')).toHaveLength(1);
    expect(graph.nodes.filter(n => n.kind === 'building').reduce((s, n) => s + n.averagePower!, 0)).toBe(150);
  });

  it('отклоняет значительный дисбаланс, а малый численный остаток сообщает явно', () => {
    expect(() => buildSchematic(catalog, model([group('a')]), { products: [flow('ingot', 70)] }, 'types')).toThrow(/баланс/i);
    const graph = buildSchematic(catalog, model([group('a')]), { products: [flow('ingot', 80.4 + 1e-10)] }, 'types');
    expect(graph.warnings.some(w => w.includes('остаток'))).toBe(true);
  });

  it('не скрывает след без назначения и пропускает нулевые граничные потоки', () => {
    expect(() => buildSchematic(catalog, model([group('a', 1, 1e-12)], 1e-12), { products: [] }, 'types')).toThrow(/баланс/i);
    const empty = model([], 0);
    expect(buildSchematic(catalog, empty, { products: [] }, 'types').nodes).toEqual([]);
  });
});
