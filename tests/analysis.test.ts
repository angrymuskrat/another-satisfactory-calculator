import { beforeAll, describe, expect, it } from 'vitest';
import { createHighs } from '../packages/solver/highs';
import { analyze, constraintCandidates, summarizeResult } from '../packages/solver/analysis';
import { createDefaultPlan } from '../packages/domain/defaults';
import type { Catalog, Plan } from '../packages/domain/types';
import gameCatalog from '../packages/game-data/catalog.json';

let highs: Awaited<ReturnType<typeof createHighs>>;
beforeAll(async () => { highs = await createHighs(); });
function fixture() {
  const catalog: Catalog = {
    version: 'analysis', provenance: { source: 'fixture', commit: '', importedAt: '', verified: true, notes: [] },
    items: ['ore', 'plate', 'waste'].map(id => ({ id, name: id, nameEn: id, category: 'Детали', raw: id === 'ore', fluid: false, sinkable: true })),
    buildings: [{ id: 'constructor', name: 'Конструктор', nameEn: 'Constructor', power: 4 }, { id: 'awesome-sink', name: 'Утилизатор', nameEn: 'Sink', power: 30 }],
    recipes: [{ id: 'plate', name: 'Пластина', nameEn: 'Plate', category: 'Детали', buildingId: 'constructor', seconds: 6, alternate: false, inputs: [{ itemId: 'ore', amount: 3 }], outputs: [{ itemId: 'plate', amount: 2 }] }],
    miners: [{ id: 'mk1', name: 'Mk1', rate: 60, power: 5, resourceIds: ['ore'] }],
    belts: [{ id: 'belt1', name: 'Лента', rate: 60 }], pipes: [{ id: 'pipe1', name: 'Труба', rate: 300 }], categories: ['Детали'],
  };
  const plan = createDefaultPlan(catalog); plan.settings.objective = 'power';
  plan.targets = [{ itemId: 'plate', rate: 20, weight: 1, scale: 1 }];
  plan.sources = [{ id: 'ore1', itemId: 'ore', kind: 'flow', limit: 60, count: 1, purity: 1, minerId: 'mk1', clock: 100 }];
  return { catalog, plan };
}
describe('повторный анализ полного плана', () => {
  it('сравнивает энергию допустимых планов с подобранными частотами при большем расходе сырья', () => {
    const { catalog, plan } = fixture(); plan.mode = 'target'; plan.settings.objective = 'smooth-power';
    catalog.recipes[0].inputs[0].amount = 6;
    catalog.recipes.push({ ...catalog.recipes[0], id: 'fast', seconds: 3, power: 8, inputs: [{ itemId: 'ore', amount: 3 }] });
    catalog.recipes[0].power = 2;
    plan.settings.enabledRecipeIds = ['fast'];
    const report = analyze(catalog, plan, highs, { kind: 'recipes', recipeIds: ['plate'] });
    expect(report.baseline.status).toBe('approximate');
    const variant = report.variants[0]; expect(variant.result.status).toBe('approximate');
    expect(variant.comparison?.power.delta).toBeCloseTo(-1.2, 5);
    expect(variant.comparison?.productionIdlePower.before).toBeCloseTo(0, 5);
    expect(variant.comparison?.productionIdlePower.after).toBeCloseTo(0, 5);
    expect(variant.comparison?.resourceCost.delta).toBeCloseTo(30, 5);
    expect(variant.benefit).toBe('cost');
  });
  it('литой винт меняет всю цепочку, экономит 10,4 MW и две производственные машины без изменения плана', () => {
    const catalog = gameCatalog as Catalog, plan = createDefaultPlan(catalog); plan.settings.objective = 'power';
    plan.mode = 'target'; plan.targets[0].rate = 10;
    const original = structuredClone(plan);
    const report = analyze(catalog, plan, highs, { kind: 'recipes', recipeIds: ['alt-screw'] });
    expect(report.baseline.status).toBe('optimal');
    expect(report.variants[0].result.status).toBe('optimal');
    expect(report.variants[0].comparison?.power.delta).toBeCloseTo(-10.4, 3);
    expect(report.variants[0].comparison?.physical.production.delta).toBe(-2);
    expect(report.variants[0].comparison?.physical.extraction.before).toBe(1);
    expect(report.variants[0].comparison?.outputs[0].delta).toBeCloseTo(0, 4);
    expect(report.variants[0].comparison?.recipes.some(r => r.id === 'alt-screw')).toBe(true);
    expect(plan).toEqual(original);
  });
  it('конкретный конечный источник увеличивает выпуск с 40 до 80', () => {
    const { catalog, plan } = fixture();
    const report = analyze(catalog, plan, highs, { kind: 'constraints', candidateIds: ['source-limit:ore1'] });
    expect(report.variants[0].benefit).toBe('output');
    expect(report.variants[0].comparison?.outputs[0]).toMatchObject({ before: expect.closeTo(40, 4), after: expect.closeTo(80, 4) });
  });
  it('насыщение двух лимитов не доказывает пользу одиночного расширения, совместное проверяется отдельно', () => {
    const { catalog, plan } = fixture(); plan.settings.powerLimit = 8;
    const report = analyze(catalog, plan, highs, { kind: 'constraints', candidateIds: ['source-limit:ore1', 'powerLimit'] });
    expect(report.variants.slice(0, 2).map(v => v.benefit)).toEqual(['none', 'none']);
    expect(report.variants[2].candidateIds).toEqual(['source-limit:ore1', 'powerLimit']);
    expect(report.variants[2].benefit).toBe('output');
    expect(report.variants[2].comparison?.outputs[0].after).toBeGreaterThan(40);
  });
  it('выключенное здание и рецепт дают нулевой максимум; полезно только их совместное включение', () => {
    const { catalog, plan } = fixture(); plan.settings.enabledBuildingIds = ['awesome-sink']; plan.settings.enabledRecipeIds = [];
    const report = analyze(catalog, plan, highs, { kind: 'constraints', candidateIds: ['building:constructor', 'recipe:plate'] });
    expect(report.noProductionPath).toBe(true);
    expect(report.variants.map(v => v.benefit)).toEqual(['none', 'none', 'output']);
  });
  it('разрешение Sink разблокирует отход и включает физический утилизатор', () => {
    const { catalog, plan } = fixture(); catalog.recipes[0].outputs.push({ itemId: 'waste', amount: 1 }); plan.mode = 'target';
    const report = analyze(catalog, plan, highs, { kind: 'constraints', candidateIds: ['sink'] });
    expect(report.baseline.status).toBe('infeasible');
    expect(report.variants[0].benefit).toBe('feasibility');
    expect(summarizeResult(catalog, plan, report.variants[0].result).physical.sinks).toBe(1);
  });
  it('сохраняет достижимую долю невыполнимого заказа', () => {
    const { catalog, plan } = fixture(); plan.mode = 'target'; plan.targets[0].rate = 100;
    const report = analyze(catalog, plan, highs, { kind: 'constraints', candidateIds: ['source-limit:ore1'] });
    expect(report.baseline.feasibleAlternative?.fraction).toBeCloseTo(.4, 4);
    expect(report.variants[0].result.feasibleAlternative?.fraction).toBeCloseTo(.8, 4);
    expect(report.variants[0].benefit).toBe('reachable-output');
  });
  it('общий deadline не превращает непроверенные изменения в доказанные', () => {
    const { catalog, plan } = fixture();
    const report = analyze(catalog, plan, highs, { kind: 'constraints', candidateIds: ['source-limit:ore1'] }, performance.now() - 1);
    expect(report.baseline.status).toBe('timeout');
    expect(report.complete).toBe(false);
    expect(report.variants.every(v => v.benefit === 'unknown')).toBe(true);
  });
  it('для узла отделяет дополнительный cap от количества добытчиков', () => {
    const { catalog, plan } = fixture(); plan.sources[0].kind = 'node'; plan.sources[0].limit = 30;
    const ids = constraintCandidates(catalog, plan).map(c => c.id);
    expect(ids).toContain('source-limit:ore1'); expect(ids).toContain('source-node:ore1');
    const report = analyze(catalog, plan, highs, { kind: 'constraints', candidateIds: ['source-node:ore1'] });
    expect(report.variants[0].benefit).toBe('none');
  });
  it('предлагает отсутствующее сырьё конечным внешним потоком и не приписывает поставке нулевую энергию', () => {
    const { catalog, plan } = fixture(); plan.sources = [];
    const original = structuredClone(plan);
    const candidate = constraintCandidates(catalog, plan).find(c => c.id === 'source-add:ore');
    expect(candidate).toBeDefined();
    const report = analyze(catalog, plan, highs, { kind: 'constraints', candidateIds: ['source-add:ore'] });
    expect(report.variants[0].benefit).toBe('output');
    expect(report.variants[0].result.products[0].rate).toBeCloseTo(40, 4);
    expect(report.variants[0].result.resources[0].limit).toBe(60);
    expect(report.variants[0].result.warnings.some(w => w.includes('внешних потоков'))).toBe(true);
    expect(plan).toEqual(original);
    plan.settings.resourcePolicy = 'unlimited-unlisted';
    expect(constraintCandidates(catalog, plan).some(c => c.id === 'source-add:ore')).toBe(false);
  });
  it('открывает добытчик в мире отдельным изменением', () => {
    const { catalog, plan } = fixture(); plan.sources[0].kind = 'node';
    plan.world = { id: 'world', revision: 1, unlockedRecipeIds: ['plate'], unlockedBuildingIds: ['constructor', 'awesome-sink'], beltId: 'belt1', pipeId: 'pipe1', overclockUnlocked: false, unlockedMilestoneIds: [] };
    expect(constraintCandidates(catalog, plan).some(c => c.id === 'unlock-building:mk1')).toBe(true);
    const report = analyze(catalog, plan, highs, { kind: 'constraints', candidateIds: ['unlock-building:mk1'] });
    expect(report.noProductionPath).toBe(true);
    expect(report.variants[0].benefit).toBe('output');
    expect(report.variants[0].summary?.physical.extraction).toBe(1);
    expect(plan.world.unlockedBuildingIds).not.toContain('mk1');
  });
  it('четыре цели показывают измеримый компромисс при одном заказе и неизменных ограничениях', () => {
    const { catalog, plan } = fixture(); plan.mode = 'target'; catalog.recipes[0].seconds = 12;
    catalog.recipes.push({ ...catalog.recipes[0], id: 'eco', alternate: true, power: 2, inputs: [{ itemId: 'ore', amount: 4 }] },
      { ...catalog.recipes[0], id: 'compact', alternate: true, power: 10, seconds: 60, inputs: [{ itemId: 'ore', amount: 40 }], outputs: [{ itemId: 'plate', amount: 20 }] });
    plan.settings.enabledRecipeIds.push('eco', 'compact');
    const before = structuredClone(plan);
    const report = analyze(catalog, plan, highs, { kind: 'objectives' });
    expect(report.variants.map(v => v.result.status)).toEqual(['optimal', 'approximate', 'optimal', 'optimal']);
    expect(report.variants.map(v => v.result.steps[0].recipeId)).toEqual(['eco', 'compact', 'plate', 'compact']);
    expect(report.variants.map(v => v.summary?.physical.production)).toEqual([2, 1, 2, 1]);
    for (const v of report.variants) expect(v.result.products[0].rate).toBeCloseTo(20, 4);
    expect(plan).toEqual(before);
  });
  it('разрешённая потеря 100% не выдаётся за отсутствие производственного пути', () => {
    const { catalog, plan } = fixture(); plan.settings.outputSlack = 100;
    const report = analyze(catalog, plan, highs, { kind: 'constraints', candidateIds: [] });
    expect(report.baseline.products[0].rate).toBeCloseTo(0, 4);
    expect(report.noProductionPath).toBe(false);
  });
  it('нулевой maxRate действительно запрещает положительный выпуск, в отличие от outputSlack', () => {
    const { catalog, plan } = fixture(); plan.targets[0].maxRate = 0;
    const report = analyze(catalog, plan, highs, { kind: 'constraints', candidateIds: ['source-limit:ore1'] });
    expect(report.noProductionPath).toBe(true);
    expect(report.variants[0].benefit).toBe('none');
    expect(report.variants[0].result.products[0].rate).toBeCloseTo(0, 4);
  });
  it('неподдерживаемый масштаб границы не называется отсутствующим производственным путём', () => {
    const { catalog, plan } = fixture(); plan.targets[0].maxRate = 5e-8;
    const report = analyze(catalog, plan, highs, { kind: 'constraints', candidateIds: [] });
    expect(report.baseline.status).toBe('error');
    expect(report.baseline.message).toContain('0,000001');
    expect(report.noProductionPath).toBe(false);
  });
  it('взвешенный выпуск оценивается по весам даже при снижении первого продукта', () => {
    const { catalog, plan } = fixture(); plan.policy = 'weighted';
    plan.targets[0].weight = 2;
    plan.targets.push({ itemId: 'waste', rate: 1, weight: 1, scale: 1 });
    catalog.recipes.push({ ...catalog.recipes[0], id: 'more', alternate: true, inputs: [{ itemId: 'ore', amount: 1 }], outputs: [{ itemId: 'waste', amount: 2 }] });
    const report = analyze(catalog, plan, highs, { kind: 'recipes', recipeIds: ['more'] });
    expect(report.variants[0].benefit).toBe('output');
    expect(report.variants[0].result.products.find(p => p.itemId === 'waste')?.rate).toBeCloseTo(120, 4);
    expect(report.variants[0].comparison?.outputs.find(p => p.itemId === 'plate')?.delta).toBeLessThan(-39.99);
  });
  it('альтернативы с общим промежуточным продуктом имеют совместную пользу, которой нет поодиночке', () => {
    const { catalog, plan } = fixture(); plan.mode = 'target';
    catalog.recipes.push({ ...catalog.recipes[0], id: 'a', power: 1, alternate: true, inputs: [{ itemId: 'ore', amount: 1 }], outputs: [{ itemId: 'waste', amount: 1 }] },
      { ...catalog.recipes[0], id: 'b', power: 1, alternate: true, inputs: [{ itemId: 'waste', amount: 1 }], outputs: [{ itemId: 'plate', amount: 2 }] });
    const report = analyze(catalog, plan, highs, { kind: 'recipes', recipeIds: ['a', 'b'] });
    expect(report.variants.map(v => v.benefit)).toEqual(['none', 'none', 'cost']);
    expect(report.variants[2].result.power).toBeCloseTo(2, 4);
    expect(plan.settings.enabledRecipeIds).not.toContain('a');
  });
  it('различает лимит пика с резервом и среднюю мощность при проверке расширения', () => {
    const { catalog, plan } = fixture(); plan.mode = 'target'; plan.settings.peakPowerLimit = 6; plan.settings.powerReserve = 3;
    const before = structuredClone(plan);
    const report = analyze(catalog, plan, highs, { kind: 'constraints', candidateIds: ['peakPowerLimit'] });
    expect(report.baseline.status).toBe('infeasible');
    expect(report.variants[0].benefit).toBe('feasibility');
    expect(report.variants[0].result.installedPower).toBeCloseTo(4, 4);
    expect(plan).toEqual(before);
  });
  it('мир остаётся закрытым при простом разрешении рецепта в сравнении', () => {
    const { catalog, plan } = fixture(); plan.settings.enabledRecipeIds = [];
    plan.world = { id: 'world', revision: 1, unlockedRecipeIds: [], unlockedBuildingIds: ['constructor'], beltId: 'belt1', pipeId: 'pipe1', overclockUnlocked: false, unlockedMilestoneIds: [] };
    const report = analyze(catalog, plan, highs, { kind: 'recipes', recipeIds: ['plate'] });
    expect(report.variants[0].benefit).toBe('none');
    expect(report.variants[0].result.products[0].rate).toBeCloseTo(0, 4);
    expect(plan.world.unlockedRecipeIds).toEqual([]);
  });
});
