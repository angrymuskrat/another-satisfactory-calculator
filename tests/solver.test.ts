import { beforeAll, describe, expect, it } from 'vitest';
import { createHighs as loadHighs } from '../packages/solver/highs';
import { solve } from '../packages/solver/solve';
import { validateResult } from '../packages/solver/validate';
import type { Catalog, Plan, Recipe, Result } from '../packages/domain/types';
import gameCatalog from '../packages/game-data/catalog.json';
import { createDefaultPlan } from '../packages/domain/defaults';

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
  it.each(['aluminum-ingot', 'battery'])('сохраняет баланс малых потоков в реальной цепочке %s', itemId => {
    const catalog = gameCatalog as Catalog; const plan = createDefaultPlan(catalog);
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
