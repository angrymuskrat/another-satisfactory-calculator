import { describe, expect, it } from 'vitest';
import { buildConstruction } from '../packages/domain/construction';
import { createDefaultPlan } from '../packages/domain/defaults';
import type { Catalog, Result } from '../packages/domain/types';
import gameCatalog from '../packages/game-data/catalog.json';

function fixture() {
  const catalog: Catalog = {
    version: 'test', provenance: { source: 'fixture', commit: 'test', importedAt: '', verified: false, notes: [] },
    items: ['ore', 'plate', 'concrete'].map(id => ({ id, name: id, nameEn: id, raw: id === 'ore', fluid: false, sinkable: true, category: 'test' })),
    buildings: [{ id: 'constructor', name: 'Конструктор', nameEn: 'Constructor', power: 4 }, { id: 'awesome-sink', name: 'Утилизатор', nameEn: 'Sink', power: 30 }],
    recipes: [{ id: 'plate', name: 'Пластина', nameEn: 'Plate', buildingId: 'constructor', seconds: 6, inputs: [{ itemId: 'ore', amount: 3 }], outputs: [{ itemId: 'plate', amount: 2 }], alternate: false, category: 'test' }],
    miners: [{ id: 'miner', name: 'Бур', rate: 60, power: 5, resourceIds: ['ore'] }],
    belts: [{ id: 'belt', name: 'Лента', rate: 60 }], pipes: [{ id: 'pipe', name: 'Труба', rate: 300 }], categories: [],
  };
  const plan = createDefaultPlan(catalog); plan.settings.objective = 'power';
  plan.sources = [{ id: 'node', itemId: 'ore', kind: 'node', count: 10, purity: 1, clock: 200, minerId: 'miner', limit: null }];
  const result: Result = { status: 'optimal', message: '', products: [{ itemId: 'plate', rate: 30 }],
    steps: [{ recipeId: 'plate', cycles: 15, machines: 999, installedMachines: 2, power: 999, powerMax: 999, inputs: [], outputs: [] }],
    resources: [{ sourceId: 'node', itemId: 'ore', rate: 90, limit: 999, power: 999 }], surplus: [],
    power: 999, productionPower: 999, extractionPower: 999, sinkPower: 999, installedPower: 999, objectiveValue: 0, warnings: [], diagnostics: [], maxBalanceError: 0 };
  return { catalog, plan, result };
}

describe('инструкция строительства при заданных частотах', () => {
  it('считает материалы одного компенсатора и всех трёх спутников даже при малом расходе', () => {
    const catalog = gameCatalog as Catalog, plan = createDefaultPlan(catalog); plan.settings.objective = 'power';
    plan.sources = [{ id: 'well', itemId: 'water', kind: 'well', limit: null, count: 1, purity: 1, minerId: '', clock: 100,
      well: { satellites: [{ purity: 0.5, count: 1 }, { purity: 2, count: 2 }] } }];
    const result = fixture().result;
    result.steps = []; result.resources = [{ sourceId: 'well', itemId: 'water', rate: 10, limit: 270, power: 150 }];
    const model = buildConstruction(catalog, plan, result);
    expect(model.materials.complete).toBe(true);
    expect(model.materials.knownMachines).toBe(4);
    expect(Object.fromEntries(model.materials.items.map(i => [i.itemId, i.amount]))).toEqual({
      'radio-control-unit': 10, 'heavy-modular-frame': 25, motor: 50,
      'alclad-aluminum-sheet': 50, rubber: 100, 'steel-beam': 30, 'aluminum-casing': 30,
    });
    expect(model.addedMaterials).toEqual(model.materials);
    expect(buildConstruction({ ...catalog, version: 'unverified-build' }, plan, result).materials.complete).toBe(false);
    result.resources[0].rate = 0;
    expect(buildConstruction(catalog, plan, result).materials.totalMachines).toBe(0);
  });
  it('оставляет 2 машины на 100% с duty 75%, пересчитывая потоки и MW без доверия итогам solver', () => {
    const { catalog, plan, result } = fixture();
    const { production: [group] } = buildConstruction(catalog, plan, result);
    expect(group.count).toBe(2); expect(group.clock).toBe(100); expect(group.activeDuty).toBe(.75);
    expect(group.activeInputs).toEqual([{ itemId: 'ore', rate: 30 }]);
    expect(group.activeOutputs).toEqual([{ itemId: 'plate', rate: 20 }]);
    expect(group.averageInputs).toEqual([{ itemId: 'ore', rate: 45 }]);
    expect(group.averageOutputs).toEqual([{ itemId: 'plate', rate: 30 }]);
    expect(group.activePower).toBe(4); expect(group.averagePower).toBe(6); expect(group.peakPower).toBe(8);
  });
  it('при ограничении порта не путает capacity equivalent с активной долей и не меняет clock', () => {
    const { catalog, plan, result } = fixture(); plan.settings.clock = 200; catalog.belts[0].rate = 30;
    const group = buildConstruction(catalog, plan, result).production[0];
    expect(group.count).toBe(2); expect(group.clock).toBe(200); expect(group.activeDuty).toBe(.375);
    expect(group.activeInputs[0].rate).toBe(60); expect(group.averageInputs[0].rate).toBe(45);
    expect(group.averagePower).toBeCloseTo(7.5); expect(group.peakPower).toBeCloseTo(20);
  });
  it('использует мощность рецепта, его пик и оценочность вместо базовой мощности здания', () => {
    const { catalog, plan, result } = fixture();
    Object.assign(catalog.recipes[0], { power: 100, powerMax: 200, powerEstimated: true });
    const group = buildConstruction(catalog, plan, result).production[0];
    expect(group.averagePower).toBe(150); expect(group.peakPower).toBe(400); expect(group.powerEstimated).toBe(true);
  });
  it('считает только нужные добытчики с лимитом выхода; внешние поставки имеют неизвестную энергию', () => {
    const { catalog, plan, result } = fixture();
    Object.assign(plan.sources[0], { name: 'Северный карьер' });
    result.resources.push({ sourceId: 'implicit:ore', itemId: 'ore', rate: 10, limit: null, power: 0 });
    const model = buildConstruction(catalog, plan, result);
    expect(model.extraction[0].count).toBe(2); expect(model.extraction[0].activeDuty).toBe(.375);
    expect(model.extraction[0].name).toContain('Северный карьер');
    expect(model.extraction[0].averagePower).toBeCloseTo(9.375); expect(model.extraction[0].peakPower).toBeCloseTo(25);
    expect(model.externalSources[0].power).toBeNull(); expect(model.peakPower).toBeCloseTo(33);
  });
  it('не использует все доступные узлы при нулевом расходе и принимает installedMachines нового solver', () => {
    const { catalog, plan, result } = fixture();
    Object.assign(result.resources[0], { installedMachines: 3 });
    expect(buildConstruction(catalog, plan, result).extraction[0].count).toBe(3);
    result.resources[0].rate = 0;
    expect(buildConstruction(catalog, plan, result).extraction).toEqual([]);
  });
  it('выделяет целые утилизаторы, считает их материалы и не уменьшает MW по duty потока', () => {
    const { catalog, plan, result } = fixture(); result.surplus = [{ itemId: 'plate', rate: 90 }];
    const model = buildConstruction(catalog, plan, result);
    expect(model.sinks[0].count).toBe(2); expect(model.sinks[0].averagePower).toBe(60);
    expect(model.sinks[0].activeDuty).toBe(1); expect(model.sinks[0].averageInputs[0].rate).toBe(90);
    expect(model.sinks[0].activeInputs[0].rate).toBe(45); expect(model.sinks[0].averageOutputs).toEqual([]);
  });
  it('суммирует материалы только физических зданий; неизвестные стоимости не становятся нулём', () => {
    const { catalog, plan, result } = fixture();
    catalog.buildings[0].buildCost = [{ itemId: 'concrete', amount: 3 }];
    const model = buildConstruction(catalog, plan, result);
    expect(model.materials.items).toEqual([{ itemId: 'concrete', amount: 6 }]);
    expect(model.materials.knownMachines).toBe(2); expect(model.materials.totalMachines).toBe(4);
    expect(model.materials.unknown).toEqual([{ buildingId: 'miner', name: 'Бур', count: 2 }]);
    expect(model.materials.complete).toBe(false);
    Object.assign(catalog.miners[0], { buildCost: [{ itemId: 'concrete', amount: 5 }] });
    expect(buildConstruction(catalog, plan, result).materials.items).toEqual([{ itemId: 'concrete', amount: 16 }]);
    expect(buildConstruction(catalog, plan, result).materials.complete).toBe(true);
  });
  it('fingerprint меняется с частотой, потоками, составом здания и ограничениями, но стабилен при пересчёте', () => {
    const { catalog, plan, result } = fixture(); const original = buildConstruction(catalog, plan, result).fingerprint;
    expect(buildConstruction(structuredClone(catalog), structuredClone(plan), structuredClone(result)).fingerprint).toBe(original);
    result.steps[0].cycles = 10;
    expect(buildConstruction(catalog, plan, result).fingerprint).not.toBe(original); result.steps[0].cycles = 15;
    Object.assign(plan.settings, { peakPowerLimit: 70, powerReserve: 5 });
    expect(buildConstruction(catalog, plan, result).fingerprint).not.toBe(original);
    plan.settings.clock = 200; expect(buildConstruction(catalog, plan, result).fingerprint).not.toBe(original);
  });
  it('не превращает отсутствующий рецепт или добытчик в нулевую мощность', () => {
    const { catalog, plan, result } = fixture(); catalog.recipes = [];
    expect(() => buildConstruction(catalog, plan, result)).toThrow(/рецепт/i);
  });
  it('использует более медленный транспорт мира для добытчиков и утилизации', () => {
    const { catalog, plan, result } = fixture();
    catalog.belts.push({ id: 'fast', name: 'Быстрая', rate: 120 }); plan.settings.beltId = 'fast';
    plan.world = { id: 'world', revision: 1, unlockedRecipeIds: ['plate'], unlockedBuildingIds: ['constructor', 'awesome-sink', 'miner'], beltId: 'belt', pipeId: 'pipe', overclockUnlocked: true, unlockedMilestoneIds: [] };
    result.surplus = [{ itemId: 'plate', rate: 90 }];
    const model = buildConstruction(catalog, plan, result);
    expect(model.transport.belt.rate).toBe(60); expect(model.extraction[0].count).toBe(2); expect(model.sinks[0].count).toBe(2);
    expect(plan.settings.beltId).toBe('fast');
  });
  it('не выдаёт неполную или невалидную стоимость за известную', () => {
    const { catalog, plan, result } = fixture();
    catalog.buildings[0].buildCost = [{ itemId: 'missing', amount: 3 }];
    const model = buildConstruction(catalog, plan, result);
    expect(model.materials.knownMachines).toBe(0); expect(model.materials.items).toEqual([]);
    expect(model.materials.unknown.map(b => b.buildingId)).toEqual(['constructor', 'miner']);
  });
  it('материалы реального каталога покрывают производство, добытчики и утилизаторы', () => {
    const catalog = gameCatalog as Catalog, plan = createDefaultPlan(catalog); plan.settings.objective = 'power';
    const { result } = fixture(); const recipe = catalog.recipes.find(r => r.id === 'iron-plate')!;
    result.steps = [{ ...result.steps[0], recipeId: recipe.id, cycles: 1, installedMachines: 1 }];
    result.resources = [{ sourceId: plan.sources[0].id, itemId: plan.sources[0].itemId, rate: 1, power: 0, limit: null }];
    result.surplus = [{ itemId: 'iron-plate', rate: 1 }];
    const bill = buildConstruction(catalog, plan, result).materials;
    expect(bill.complete).toBe(true); expect(bill.totalMachines).toBe(3); expect(bill.unknown).toEqual([]);
    expect(bill.items.length).toBeGreaterThan(0);
  });
});
