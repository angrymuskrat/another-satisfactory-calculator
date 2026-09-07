import { beforeAll, describe, expect, it } from 'vitest';
import { createHighs as loadHighs } from '../packages/solver/highs';
import { solve } from '../packages/solver/solve';
import { validateResult } from '../packages/solver/validate';
import type { Catalog, Plan, Recipe, Result } from '../packages/domain/types';
import gameCatalog from '../packages/game-data/catalog.json';
import { createDefaultPlan } from '../packages/domain/defaults';
import { buildConstruction } from '../packages/domain/construction';

let highs: Awaited<ReturnType<typeof loadHighs>>;
beforeAll(async () => { highs = await loadHighs(); });
const item = (id: string, raw = false, sinkable = true) => ({ id, name: id, nameEn: id, category: 'Детали', fluid: false, raw, sinkable });
const recipe = (id: string, out: string, cost: number, amount: number, seconds: number, power = 4): Recipe => ({
  id, name: id, nameEn: id, category: 'Детали', buildingId: 'constructor', seconds,
  inputs: [{ itemId: 'ore', amount: cost }], outputs: [{ itemId: out, amount }], alternate: false, power,
});
function fixture(): { catalog: Catalog; plan: Plan } {
  const catalog: Catalog = {
    version: 'test', provenance: { source: 'fixture', commit: '', importedAt: '', verified: true, notes: [] },
    items: [item('ore', true), item('plate'), item('rod')],
    buildings: [{ id: 'constructor', name: 'Конструктор', nameEn: 'Constructor', power: 4 }, { id: 'awesome-sink', name: 'Утилизатор', nameEn: 'Sink', power: 30 }],
    recipes: [recipe('plate', 'plate', 3, 2, 6), recipe('rod', 'rod', 1, 1, 4)],
    miners: [{ id: 'mk1', name: 'Mk.1', rate: 60, power: 5, resourceIds: ['ore'] }],
    belts: [{ id: 'belt1', name: 'Mk.1', rate: 60 }, { id: 'belt2', name: 'Mk.2', rate: 120 }],
    pipes: [{ id: 'pipe1', name: 'Mk.1', rate: 300 }], categories: ['Детали'],
  };
  const plan: Plan = { schemaVersion: 1, catalogVersion: 'test', name: 'Тест', mode: 'maximize', policy: 'proportional',
    targets: [{ itemId: 'plate', rate: 1, weight: 1, scale: 1 }],
    sources: [{ id: 'ore1', itemId: 'ore', kind: 'flow', limit: 60, count: 1, purity: 1, minerId: 'mk1', clock: 100 }],
    settings: { enabledRecipeIds: ['plate', 'rod'], enabledBuildingIds: ['constructor', 'awesome-sink'], beltId: 'belt1', pipeId: 'pipe1', clock: 100, resourcePolicy: 'listed-only', objective: 'power', powerLimit: null, outputSlack: 0, allowSink: false, resourceWeights: {} } };
  return { catalog, plan };
}
const output = (r: Result, id: string) => r.products.find(p => p.itemId === id)?.rate ?? 0;

describe('совместная оптимизация производства', () => {
  it.each(['target', 'proportional', 'priority', 'weighted'] as const)('ровная нагрузка подбирает частоту и снижает энергию: %s', mode => {
    const { catalog, plan } = fixture();
    plan.mode = mode === 'target' ? 'target' : 'maximize';
    if (mode !== 'target') plan.policy = mode;
    plan.targets[0].rate = 20; plan.targets[0].maxRate = 20;
    // После подбора: slow 100%, 4 МВт; fast 50% частоты, 100% времени, 3,2 МВт.
    catalog.recipes = [recipe('slow', 'plate', 6, 2, 6, 4), recipe('fast', 'plate', 3, 2, 3, 8)];
    plan.settings.enabledRecipeIds = ['slow', 'fast'];
    const energy = solve(catalog, plan, highs);
    expect(energy.status).toBe('optimal'); expect(energy.steps.map(s => s.recipeId)).toEqual(['fast']);
    plan.settings.objective = 'smooth-power';
    const before = structuredClone(plan);
    const result = solve(catalog, plan, highs);
    expect(result.status, result.message).toBe('approximate');
    expect(output(result, 'plate')).toBeCloseTo(20, 5);
    expect(result.power).toBeCloseTo(3.2, 5);
    expect(result.steps.map(s => s.recipeId)).toEqual(['fast']);
    expect(result.steps[0].installedMachines).toBe(1);
    const group = buildConstruction(catalog, plan, result).production[0];
    expect(group.activeDuty).toBeCloseTo(1, 6); expect(group.clock).toBeCloseTo(50, 5);
    expect(validateResult(catalog, plan, result).errors).toEqual([]);
    expect(plan).toEqual(before);
  });
  it('ровная нагрузка выполняет неделимый заказ на пониженной частоте без простоев', () => {
    const { catalog, plan } = fixture(); plan.mode = 'target'; plan.targets[0].rate = 15;
    plan.settings.objective = 'smooth-power'; plan.settings.clock = 150;
    const result = solve(catalog, plan, highs);
    expect(result.status, result.message).toBe('approximate');
    const group = buildConstruction(catalog, plan, result).production[0];
    expect(group.count).toBe(1); expect(group.clock).toBeCloseTo(75, 5); expect(group.activeDuty).toBeCloseTo(1, 6);
    expect(output(result, 'plate')).toBeCloseTo(15, 6); expect(result.surplus).toEqual([]);
  });
  it('снижение энергии входит в выбор рецепта до решения, а не в коррекцию результата', () => {
    const { catalog, plan } = fixture(); plan.mode = 'target'; plan.targets[0].rate = 20;
    catalog.recipes.push(recipe('fast', 'plate', 3, 2, 3, 9)); plan.settings.enabledRecipeIds.push('fast');
    const fixed = solve(catalog, plan, highs);
    expect(fixed.steps.map(s => s.recipeId)).toEqual(['plate']); expect(fixed.power).toBeCloseTo(4, 5);
    plan.settings.objective = 'smooth-power';
    const result = solve(catalog, plan, highs);
    expect(result.status, result.message).toBe('approximate');
    expect(result.steps.map(s => s.recipeId)).toEqual(['fast']); expect(result.power).toBeCloseTo(3.6, 5);
  });
  it('подбор частот учитывается в лимитах энергии и пика с резервом', () => {
    const { catalog, plan } = fixture(); plan.mode = 'target'; plan.targets[0].rate = 10;
    plan.settings.powerLimit = 1.61; plan.settings.peakPowerLimit = 2.61; plan.settings.powerReserve = 1;
    expect(solve(catalog, plan, highs).status).toBe('infeasible');
    plan.settings.objective = 'smooth-power';
    const result = solve(catalog, plan, highs);
    expect(result.status, result.message).toBe('approximate');
    expect(result.steps[0].installedMachines).toBe(1); expect(result.power).toBeCloseTo(1.6, 5);
    expect(result.installedPower).toBeCloseTo(1.6, 5); expect(validateResult(catalog, plan, result).errors).toEqual([]);
    const tampered = structuredClone(result); tampered.steps[0].clock = 100;
    expect(validateResult(catalog, plan, tampered).errors.join(' ')).toContain('частота');
    plan.settings.peakPowerLimit = 2;
    expect(validateResult(catalog, plan, result).errors.join(' ')).toContain('максимальной');
  });
  it.each(['proportional', 'priority', 'weighted'] as const)('сохраняет границы нескольких продуктов и допустимую потерю выпуска с автоподбором: %s', policy => {
    const { catalog, plan } = fixture(); plan.settings.objective = 'smooth-power'; plan.policy = policy;
    plan.targets = [{ itemId: 'plate', rate: 1, weight: 2, scale: 1, minRate: 10, maxRate: 20 }, { itemId: 'rod', rate: 1, weight: 1, scale: 1, minRate: 10, maxRate: 20 }];
    plan.settings.outputSlack = 20;
    const result = solve(catalog, plan, highs);
    expect(result.status, result.message).toBe('approximate');
    expect(validateResult(catalog, plan, result).errors).toEqual([]);
    for (const product of result.products) { expect(product.rate).toBeGreaterThanOrEqual(10 - 1e-6); expect(product.rate).toBeLessThanOrEqual(20 + 1e-6); }
    for (const group of buildConstruction(catalog, plan, result).production) expect(group.activeDuty).toBeCloseTo(1, 5);
  });
  it('ниже минимальной частоты честно показывает остаточный простой и физический пик', () => {
    const { catalog, plan } = fixture(); plan.settings.objective = 'smooth-power'; plan.mode = 'target'; plan.targets[0].rate = 0.1;
    const result = solve(catalog, plan, highs);
    expect(result.status, result.message).toBe('approximate');
    const group = buildConstruction(catalog, plan, result).production[0];
    expect(group.clock).toBe(1); expect(group.activeDuty).toBeCloseTo(0.5, 6);
    expect(group.peakPower).toBeCloseTo(group.averagePower * 2, 8);
    expect(validateResult(catalog, plan, result).errors).toEqual([]);
  });
  it('незакреплённая существующая линия настраивается по выпуску с сохранением оборудования', () => {
    const { catalog, plan } = fixture(); plan.mode = 'target'; plan.targets[0].rate = 30;
    plan.settings.objective = 'smooth-power'; plan.expansion = 'keep';
    plan.lines = [{ id: 'old', name: 'Старая линия', recipeId: 'plate', count: 2, clock: 100, duty: 0.25, locked: false, somersloops: 0 }];
    const result = solve(catalog, plan, highs);
    expect(result.status, result.message).toBe('approximate');
    const group = buildConstruction(catalog, plan, result).production[0];
    expect(group.count).toBe(2); expect(group.clock).toBeCloseTo(75, 6); expect(group.activeDuty).toBeCloseTo(1, 6);
    expect(plan.lines[0].clock).toBe(100); expect(plan.lines[0].duty).toBe(0.25);
  });
  it('ровная нагрузка сначала минимизирует машины и настраивает оставшуюся на непрерывный выпуск', () => {
    const { catalog, plan } = fixture(); plan.mode = 'target'; plan.targets[0].rate = 40;
    catalog.recipes.push(recipe('fast', 'plate', 3, 3, 3, 12)); plan.settings.enabledRecipeIds.push('fast');
    plan.settings.objective = 'smooth-power';
    const result = solve(catalog, plan, highs);
    expect(result.status, result.message).toBe('approximate');
    expect(result.steps.map(s => s.recipeId)).toEqual(['fast']);
    expect(result.steps[0].installedMachines).toBe(1); expect(result.steps[0].clock).toBeCloseTo(200 / 3, 5);
    expect(result.power).toBeCloseTo(12 * (2 / 3) ** Math.log2(2.5), 5);
    expect(buildConstruction(catalog, plan, result).productionIdlePower).toBeCloseTo(0, 5);
  });
  it('ровная нагрузка не увеличивает среднюю энергию ради полной загрузки', () => {
    const { catalog, plan } = fixture(); plan.mode = 'target'; plan.targets[0].rate = 20;
    catalog.recipes[0].power = 8;
    catalog.recipes.push(recipe('fast', 'plate', 3, 2, 3, 8)); plan.settings.enabledRecipeIds.push('fast');
    plan.settings.objective = 'smooth-power'; plan.settings.allowSink = true;
    const result = solve(catalog, plan, highs);
    expect(result.status, result.message).toBe('approximate');
    expect(result.steps.map(s => s.recipeId)).toEqual(['fast']); expect(result.power).toBeCloseTo(3.2, 5);
    expect(result.surplus).toEqual([]); expect(output(result, 'plate')).toBeCloseTo(20, 6);
  });
  it('ровная нагрузка устраняет простой из-за транспорта снижением частоты', () => {
    const { catalog, plan } = fixture(); plan.mode = 'target'; plan.targets[0].rate = 20;
    catalog.belts[0].rate = 15; plan.settings.objective = 'smooth-power';
    const result = solve(catalog, plan, highs);
    expect(result.status, result.message).toBe('approximate');
    const construction = buildConstruction(catalog, plan, result);
    expect(construction.production[0].count).toBe(2);
    expect(construction.production[0].activeDuty).toBeCloseTo(1, 6);
    expect(construction.production[0].clock).toBeCloseTo(50, 5);
    expect(construction.productionIdlePower).toBeCloseTo(0, 6);
    expect(validateResult(catalog, plan, result).errors).toEqual([]);
  });
  it('ровная нагрузка сохраняет закреплённую линию и её усилители', () => {
    const { catalog, plan } = fixture(); plan.mode = 'target'; plan.targets[0].rate = 20;
    plan.settings.objective = 'smooth-power'; plan.somersloopBudget = 2; plan.expansion = 'keep';
    plan.lines = [{ id: 'old', name: 'Старая линия', recipeId: 'plate', count: 2, clock: 100, duty: 0.25, locked: true, somersloops: 1 }];
    const result = solve(catalog, plan, highs);
    expect(result.status, result.message).toBe('optimal'); expect(result.somersloops).toBe(2);
    const construction = buildConstruction(catalog, plan, result);
    expect(construction.production[0].count).toBe(2); expect(construction.production[0].activeDuty).toBeCloseTo(0.25, 6);
    expect(construction.productionIdlePower).toBeCloseTo(24, 6); expect(result.power).toBeCloseTo(8, 6);
    expect(validateResult(catalog, plan, result).errors).toEqual([]);
  });
  it.each(['priority', 'weighted'] as const)('сохраняет минимум младшего продукта и при потере выпуска: %s', policy => {
    const { catalog, plan } = fixture(); plan.policy = policy;
    plan.targets[0].weight = 10;
    plan.targets.push({ itemId: 'rod', rate: 1, weight: 1, scale: 1, minRate: 15 });
    let result = solve(catalog, plan, highs);
    expect(result.status).toBe('optimal'); expect(output(result, 'rod')).toBeCloseTo(15, 5);
    expect(output(result, 'plate')).toBeCloseTo(30, 4);
    plan.settings.outputSlack = 50; result = solve(catalog, plan, highs);
    expect(result.status).toBe('optimal'); expect(output(result, 'rod')).toBeGreaterThanOrEqual(15 - 1e-6);
  });
  it('верхняя граница ограничивает совместную пропорцию', () => {
    const { catalog, plan } = fixture(); plan.targets[0].maxRate = 10;
    plan.targets.push({ itemId: 'rod', rate: 2, weight: 1, scale: 1, minRate: 5 });
    const result = solve(catalog, plan, highs);
    expect(result.status).toBe('optimal'); expect(output(result, 'plate')).toBeCloseTo(10, 5);
    expect(output(result, 'rod')).toBeCloseTo(20, 5);
  });
  it('сообщает о недостижимом минимуме, не меняя заказ', () => {
    const { catalog, plan } = fixture(); plan.targets[0].minRate = 50;
    const result = solve(catalog, plan, highs);
    expect(result.status).toBe('infeasible'); expect(result.message).toContain('минимум');
    expect(plan.targets[0].minRate).toBe(50);
  });
  it('ограничивает физический пик вместо средней мощности', () => {
    const { catalog, plan } = fixture(); plan.mode = 'target'; plan.targets[0].rate = 30;
    plan.settings.powerLimit = 7; plan.settings.peakPowerLimit = 7;
    expect(solve(catalog, plan, highs).status).toBe('infeasible');
    plan.mode = 'maximize'; const result = solve(catalog, plan, highs);
    expect(result.status).toBe('optimal'); expect(output(result, 'plate')).toBeCloseTo(20, 4);
    expect(result.installedPower).toBeCloseTo(4, 5);
  });
  it('вычитает резерв сети и независимо проверяет его', () => {
    const { catalog, plan } = fixture(); plan.settings.peakPowerLimit = 9; plan.settings.powerReserve = 2;
    const result = solve(catalog, plan, highs);
    expect(result.status).toBe('optimal'); expect(output(result, 'plate')).toBeCloseTo(20, 4);
    plan.settings.powerReserve = 6;
    expect(validateResult(catalog, plan, result).errors.join(' ')).toContain('максимальной');
  });
  it('предпочитает одну мощную машину двум экономным', () => {
    const { catalog, plan } = fixture(); plan.mode = 'target'; plan.targets[0].rate = 40;
    catalog.recipes.push(recipe('fast', 'plate', 3, 2, 3, 12)); plan.settings.enabledRecipeIds.push('fast');
    const energy = solve(catalog, plan, highs); expect(energy.steps[0].recipeId).toBe('plate');
    plan.settings.objective = 'buildings'; const compact = solve(catalog, plan, highs);
    expect(compact.status).toBe('optimal'); expect(compact.steps.map(s => s.recipeId)).toEqual(['fast']);
    expect(compact.steps[0].installedMachines).toBe(1); expect(compact.power).toBeCloseTo(12, 4);
  });
  it.each(['power', 'resources'] as const)('при равных основных целях предпочитает меньше разных рецептов: %s', objective => {
    const { catalog, plan } = fixture(); plan.mode = 'target'; plan.targets[0].rate = 10;
    plan.settings.objective = objective;
    catalog.recipes = [
      recipe('direct', 'plate', 1, 1, 6, 4),
      recipe('stage1', 'rod', 10, 10, 60, 2),
      { ...recipe('stage2', 'plate', 10, 10, 60, 2), inputs: [{ itemId: 'rod', amount: 10 }] },
    ];
    plan.settings.enabledRecipeIds = catalog.recipes.map(r => r.id);
    const result = solve(catalog, plan, highs);
    expect(result.status).toBe('optimal'); expect(result.power).toBeCloseTo(4, 5);
    expect(result.resources[0].rate).toBeCloseTo(10, 5);
    expect(result.steps.map(s => s.recipeId)).toEqual(['direct']);
  });
  it('лимит типа здания общий для разных рецептов', () => {
    const { catalog, plan } = fixture(); plan.mode = 'target'; plan.targets[0].rate = 20;
    plan.targets.push({ itemId: 'rod', rate: 15, weight: 1, scale: 1 });
    plan.settings.buildingLimits = { constructor: 1 };
    expect(solve(catalog, plan, highs).status).toBe('infeasible');
    plan.settings.buildingLimits['constructor'] = 2; const result = solve(catalog, plan, highs);
    expect(result.status).toBe('optimal');
    plan.settings.buildingLimits['constructor'] = 1;
    expect(validateResult(catalog, plan, result).errors.join(' ')).toContain('зданий');
  });
  it('считает пиковую мощность нужных добытчиков, а не всех доступных узлов', () => {
    const { catalog, plan } = fixture(); plan.mode = 'target'; plan.targets[0].rate = 20;
    Object.assign(plan.sources[0], { kind: 'node', count: 3, limit: null });
    plan.settings.peakPowerLimit = 9;
    const result = solve(catalog, plan, highs);
    expect(result.status).toBe('optimal'); expect(result.installedPower).toBeCloseTo(9, 5);
    expect(result.resources[0].installedMachines).toBe(1);
  });
  it('открытия мира нельзя обойти локальным разрешением рецепта', () => {
    const { catalog, plan } = fixture(); plan.mode = 'target';
    plan.world = { id: 'world', revision: 1, unlockedRecipeIds: ['rod'], unlockedBuildingIds: ['constructor'],
      beltId: 'belt1', pipeId: 'pipe1', overclockUnlocked: false, unlockedMilestoneIds: [] };
    expect(solve(catalog, plan, highs).status).toBe('infeasible');
  });
  it.each(['aluminum-ingot', 'battery'])('сохраняет баланс малых потоков в реальной цепочке %s', itemId => {
    const catalog = gameCatalog as Catalog; const plan = createDefaultPlan(catalog); plan.settings.objective = 'power';
    plan.mode = 'target'; plan.targets = [{ itemId, rate: 10, weight: 1, scale: 1 }]; plan.sources = [];
    plan.settings.resourcePolicy = 'unlimited-unlisted'; plan.settings.allowSink = true;
    plan.settings.enabledRecipeIds = catalog.recipes.map(r => r.id);
    const result = solve(catalog, plan, highs); expect(result.status).toBe('optimal');
  });
  it('сохраняет баланс: 60 руды дают 40 пластин, расход 8 MW', () => {
    const { catalog, plan } = fixture(); const result = solve(catalog, plan, highs);
    expect(result.status).toBe('optimal'); expect(output(result, 'plate')).toBeCloseTo(40, 4);
    expect(result.power).toBeCloseTo(8, 4); expect(result.maxBalanceError).toBeLessThan(1e-5);
  });
  it('сохраняет пропорцию 1:2 для конкурирующих продуктов', () => {
    const { catalog, plan } = fixture(); plan.targets.push({ itemId: 'rod', rate: 2, weight: 1, scale: 1 });
    const result = solve(catalog, plan, highs);
    expect(result.status).toBe('optimal'); expect(output(result, 'plate')).toBeCloseTo(120 / 7, 4);
    expect(output(result, 'rod')).toBeCloseTo(240 / 7, 4);
  });
  it('масштаб пропорции или весов не меняет максимальный выпуск', () => {
    const { catalog, plan } = fixture(); plan.targets[0].rate = 1e9;
    expect(output(solve(catalog, plan, highs), 'plate')).toBeCloseTo(40, 4);
    plan.policy = 'weighted'; plan.targets[0].scale = 1e9;
    expect(output(solve(catalog, plan, highs), 'plate')).toBeCloseTo(40, 4);
  });
  it('независимый валидатор обнаруживает ложные лимиты и мощность в результате', () => {
    const { catalog, plan } = fixture(); const result = solve(catalog, plan, highs);
    plan.sources[0].limit = 1; plan.settings.powerLimit = 1; result.power = 0;
    expect(validateResult(catalog, plan, result).errors.length).toBeGreaterThan(0);
  });
  it('приоритет полностью обслуживает первый продукт', () => {
    const { catalog, plan } = fixture(); plan.policy = 'priority'; plan.targets.push({ itemId: 'rod', rate: 1, weight: 1, scale: 1 });
    const result = solve(catalog, plan, highs);
    expect(result.status).toBe('optimal'); expect(output(result, 'plate')).toBeCloseTo(40, 4); expect(output(result, 'rod')).toBeLessThan(1e-4);
  });
  it('веса выбирают продукт по ценности, а не просто по числу штук', () => {
    const { catalog, plan } = fixture(); plan.policy = 'weighted'; plan.targets[0].weight = 2;
    plan.targets.push({ itemId: 'rod', rate: 1, weight: 1, scale: 1 });
    const result = solve(catalog, plan, highs); expect(result.status).toBe('optimal');
    expect(output(result, 'plate')).toBeCloseTo(40, 4); expect(output(result, 'rod')).toBeLessThan(1e-4);
  });
  it('заданный выпуск не снимает ограничение сырья', () => {
    const { catalog, plan } = fixture(); plan.mode = 'target'; plan.targets[0].rate = 41;
    expect(solve(catalog, plan, highs).status).toBe('infeasible');
  });
  it('невыполнимый заказ сохраняется, достижимый выпуск показан отдельно', () => {
    const { catalog, plan } = fixture(); plan.mode = 'target'; plan.targets[0].rate = 50;
    const result = solve(catalog, plan, highs);
    expect(result.status).toBe('infeasible'); expect(plan.targets[0].rate).toBe(50);
    expect(result.feasibleAlternative?.products[0].rate).toBeCloseTo(40, 4);
    expect(result.feasibleAlternative?.fraction).toBeCloseTo(0.8, 4);
  });
  it('энергетический приоритет и приоритет сырья действительно различаются', () => {
    const { catalog, plan } = fixture(); plan.mode = 'target'; plan.targets[0].rate = 20;
    catalog.recipes.push({ ...recipe('eco', 'plate', 4, 2, 6, 2), alternate: true });
    plan.settings.enabledRecipeIds.push('eco');
    expect(solve(catalog, plan, highs).steps[0].recipeId).toBe('eco');
    plan.settings.objective = 'resources';
    expect(solve(catalog, plan, highs).steps[0].recipeId).toBe('plate');
  });
  it('разрешённая потеря выпуска ограничивает компромисс энергии', () => {
    const { catalog, plan } = fixture(); plan.settings.outputSlack = 10;
    const result = solve(catalog, plan, highs);
    expect(result.status).toBe('optimal'); expect(output(result, 'plate')).toBeCloseTo(36, 4);
    expect(result.power).toBeCloseTo(7.2, 4);
  });
  it('при заданном выпуске выбирает минимум мощности среди разрешённых альтернатив', () => {
    const { catalog, plan } = fixture(); plan.mode = 'target'; plan.targets[0].rate = 20;
    catalog.recipes.push({ ...recipe('eco', 'plate', 4, 2, 6, 2), alternate: true });
    plan.settings.enabledRecipeIds.push('eco');
    let result = solve(catalog, plan, highs); expect(result.power).toBeCloseTo(2, 4); expect(result.steps[0].recipeId).toBe('eco');
    plan.settings.enabledRecipeIds = ['plate', 'rod']; result = solve(catalog, plan, highs);
    expect(result.power).toBeCloseTo(4, 4); expect(result.steps.every(s => s.recipeId !== 'eco')).toBe(true);
  });
  it('лимит мощности уменьшает доступный выпуск', () => {
    const { catalog, plan } = fixture(); plan.settings.powerLimit = 4;
    const result = solve(catalog, plan, highs); expect(result.status).toBe('optimal'); expect(output(result, 'plate')).toBeCloseTo(20, 4);
  });
  it('нулевой источник не становится бесконечным', () => {
    const { catalog, plan } = fixture(); plan.sources[0].limit = 0;
    const result = solve(catalog, plan, highs); expect(result.status).toBe('optimal'); expect(output(result, 'plate')).toBeLessThan(1e-6);
  });
  it('чистое месторождение ограничено выходной лентой, энергия добычи учитывается', () => {
    const { catalog, plan } = fixture(); Object.assign(plan.sources[0], { kind: 'node', limit: null, count: 1, purity: 2 });
    let result = solve(catalog, plan, highs); expect(output(result, 'plate')).toBeCloseTo(40, 4); expect(result.extractionPower).toBeCloseTo(2.5, 4);
    plan.settings.beltId = 'belt2'; result = solve(catalog, plan, highs); expect(output(result, 'plate')).toBeCloseTo(80, 4);
  });
  it('две параллельные ленты не ограничиваются одной общей пропускной способностью', () => {
    const { catalog, plan } = fixture(); Object.assign(plan.sources[0], { kind: 'node', limit: null, count: 2, purity: 1 });
    expect(output(solve(catalog, plan, highs), 'plate')).toBeCloseTo(80, 4);
  });
  it('запрет здания не обходится расчётом', () => {
    const { catalog, plan } = fixture(); plan.mode = 'target'; plan.settings.enabledBuildingIds = [];
    expect(solve(catalog, plan, highs).status).toBe('infeasible');
  });
  it('определяет неограниченную цель при неограниченном источнике', () => {
    const { catalog, plan } = fixture(); plan.sources[0].limit = null;
    expect(solve(catalog, plan, highs).status).toBe('unbounded');
  });
  it('не выбрасывает побочный продукт молча и считает целый утилизатор', () => {
    const { catalog, plan } = fixture(); catalog.items.push(item('waste'));
    catalog.recipes[0].outputs.push({ itemId: 'waste', amount: 1 });
    plan.mode = 'target'; plan.targets[0].rate = 20;
    expect(solve(catalog, plan, highs).status).toBe('infeasible');
    plan.settings.allowSink = true; const result = solve(catalog, plan, highs);
    expect(result.status).toBe('optimal'); expect(result.sinkPower).toBeCloseTo(30, 4); expect(result.power).toBeCloseTo(34, 4);
    expect(result.surplus.find(s => s.itemId === 'waste')?.rate).toBeCloseTo(10, 4);
  });
  it('не утилизирует запрещённые отходы даже при включённом утилизаторе', () => {
    const { catalog, plan } = fixture(); catalog.items.push(item('waste', false, false));
    catalog.recipes[0].outputs.push({ itemId: 'waste', amount: 1 }); plan.settings.allowSink = true;
    plan.mode = 'target'; plan.targets[0].rate = 20; expect(solve(catalog, plan, highs).status).toBe('infeasible');
  });
  it('решает цикл оборотного продукта совместно', () => {
    const { catalog, plan } = fixture(); catalog.items.push(item('water', false, false));
    catalog.recipes[0].inputs.push({ itemId: 'water', amount: 2 });
    catalog.recipes[0].outputs.push({ itemId: 'water', amount: 1 });
    catalog.recipes.push({ ...recipe('water', 'water', 1, 2, 6), inputs: [{ itemId: 'rod', amount: 1 }] });
    plan.settings.enabledRecipeIds.push('water');
    const result = solve(catalog, plan, highs); expect(result.status).toBe('optimal');
    expect(output(result, 'plate')).toBeCloseTo(240 / 7, 4); expect(result.maxBalanceError).toBeLessThan(1e-5);
  });
  it('не принимает отрицательные лимиты и повреждённые входные данные', () => {
    const { catalog, plan } = fixture(); plan.sources[0].limit = -1;
    expect(solve(catalog, plan, highs).status).toBe('error');
  });
});
