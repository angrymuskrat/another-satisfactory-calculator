import { describe, expect, it } from 'vitest';
import { buildSchematic, SCHEMATIC_PAGE_SIZE } from '../packages/domain/schematic';
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

  it('разворачивает ровно четыре машины с исходной частотой и равными средними потоками', () => {
    const graph = buildSchematic(catalog, model([group('iron')]), destinations, 'machines');
    const machines = graph.nodes.filter(n => n.kind === 'building');
    expect(machines).toHaveLength(4);
    for (const n of machines) {
      expect(n).toMatchObject({ count: 1, clock: 67, averagePower: 2, peakPower: 3 });
      expect(n.inputs).toEqual([flow('ore', 20.1)]);
    }
    const source = graph.nodes.find(n => n.kind === 'source')!;
    const branches = graph.edges.filter(e => e.from === source.id);
    expect(branches.map(e => e.rate)).toEqual([20.1, 20.1, 20.1, 20.1]);
    expect(branches.map(e => e.share)).toEqual([.25, .25, .25, .25]);
    expect(graph.nodes.some(n => n.kind === 'merge' || n.kind === 'split')).toBe(false);
  });

  it('подписывает неравные 40/30/20/10 процентов, не выбирая пары поставщиков и потребителей', () => {
    const groups = [40, 30, 20, 10].map((rate, i) => group(`line${i}`, 1, rate));
    const m = model(groups, 100);
    m.externalSources = [
      { sourceId: 'a', name: 'A', itemId: 'ore', rate: 55, power: 5 },
      { sourceId: 'b', name: 'B', itemId: 'ore', rate: 45, power: null },
    ];
    const graph = buildSchematic(catalog, m, { products: [flow('ingot', 100)] }, 'types');
    const split = graph.nodes.find(n => n.kind === 'split' && n.itemId === 'ore')!;
    const merge = graph.nodes.find(n => n.kind === 'merge' && n.itemId === 'ore')!;
    expect(graph.edges.filter(e => e.from === split.id).map(e => e.share)).toEqual([.4, .3, .2, .1]);
    expect(graph.edges.find(e => e.from === merge.id && e.to === split.id)?.rate).toBe(100);
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

  it.each([0, 1])('распределяет 224 напрямую, соблюдая 120 на каждом ребре и баланс на странице %i', page => {
    const m = model([group('a', 50, 224)], 224);
    m.transport.belt.rate = 120;
    m.externalSources = [
      { sourceId: 'a', name: 'A', itemId: 'ore', rate: 130, power: null },
      { sourceId: 'b', name: 'B', itemId: 'ore', rate: 94, power: null },
    ];
    const graph = buildSchematic(catalog, m, { products: [flow('ingot', 224)] }, 'machines', page);
    expect(graph.nodes.some(n => ['merge', 'split'].includes(n.kind))).toBe(false);
    expect(graph.edges.every(e => e.rate > 0 && e.rate <= 120 && e.parallel === 1)).toBe(true);
    for (const n of graph.nodes) for (const direction of ['inputs', 'outputs'] as const) {
      for (const f of n[direction]) expect(graph.edges.filter(e => e.itemId === f.itemId &&
        (direction === 'inputs' ? e.to === n.id : e.from === n.id)).reduce((s, e) => s + e.rate, 0)).toBeCloseTo(f.rate, 10);
    }
  });

  it('делит большие потоки на ленты/трубы, сохраняя малый положительный остаток', () => {
    const m = model([], 0); m.externalSources = [];
    for (const [itemId, rate] of [['ore', 120 + 1e-10], ['water', 650]] as const) {
      m.externalSources.push({ sourceId: itemId, name: itemId, itemId, rate, power: null });
    }
    m.transport.belt.rate = 120;
    const graph = buildSchematic(catalog, m, { products: m.externalSources }, 'machines');
    expect(graph.edges.filter(e => e.itemId === 'ore').map(e => e.rate)).toEqual([120, 120 + 1e-10 - 120]);
    expect(graph.edges.filter(e => e.itemId === 'water').map(e => e.rate)).toEqual([300, 300, 50]);
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
    const graph = buildSchematic(catalog, m, { products: [flow('ingot', 70)], exports: [{ ...flow('ingot', 20), name: 'Соседняя фабрика' }] }, 'machines');
    expect(graph.nodes.find(n => n.kind === 'export')?.label).toContain('Соседняя фабрика');
    expect(graph.nodes.find(n => n.buildingId === 'sink')).toMatchObject({ averagePower: 30, outputs: [] });
  });

  it('страницы не теряют здания, потоки, исходные конфигурации и МВт', () => {
    const m = model([group('large', SCHEMATIC_PAGE_SIZE + 2, 100)], 100);
    for (const page of [0, 1]) {
      const graph = buildSchematic(catalog, m, { products: [flow('ingot', 100)] }, 'machines', page);
      expect(graph.machineCount).toBe(SCHEMATIC_PAGE_SIZE + 2);
      expect(graph.pages).toBe(2);
      expect(graph.nodes.filter(n => n.kind === 'building')).toHaveLength(page === 0 ? SCHEMATIC_PAGE_SIZE : 2);
      const all = graph.nodes.filter(n => n.configurations.length);
      expect(all.reduce((s, n) => s + n.count, 0)).toBe(SCHEMATIC_PAGE_SIZE + 2);
      expect(all.reduce((s, n) => s + n.averagePower!, 0)).toBeCloseTo((SCHEMATIC_PAGE_SIZE + 2) * 2);
      expect(all.reduce((s, n) => s + n.inputs[0].rate, 0)).toBeCloseTo(100);
      expect(graph.nodes.some(n => n.kind === 'continuation' && n.page !== page)).toBe(true);
    }
  });

  it('связывает компенсатор со спутниками без дополнительного потока или энергии', () => {
    const m = model([], 0); m.externalSources = [];
    m.extraction = [
      { ...group('well', 1, 10), kind: 'extraction', buildingId: 'resource-well-pressurizer', averageInputs: [], averageOutputs: [], averagePower: 150, peakPower: 150 },
      { ...group('satellites', 2, 10), kind: 'extraction', buildingId: 'resource-well-extractor', controllerId: 'well', averageInputs: [], averageOutputs: [flow('water', 10)], averagePower: 0, peakPower: 0 },
    ];
    const graph = buildSchematic(catalog, m, { products: [flow('water', 10)] }, 'machines');
    expect(graph.edges.filter(e => e.kind === 'control')).toHaveLength(2);
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
    expect(buildSchematic(catalog, empty, { products: [] }, 'machines').nodes).toEqual([]);
  });
});
