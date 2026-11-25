import { beforeAll, describe, expect, it } from 'vitest';
import catalogData from '../packages/game-data/catalog.json';
import { createDefaultPlan } from '../packages/domain/defaults';
import { supplyChange } from '../packages/domain/supplyGap';
import type { Catalog } from '../packages/domain/types';
import { createHighs } from '../packages/solver/highs';
import { attachSupplyDiagnosis, diagnoseSupply } from '../packages/solver/diagnoseSupply';
import { emptyResult, solve } from '../packages/solver/solve';
import type { ProductionVariants } from '../packages/domain/types';
import { largeOrder } from './largeOrderFixture';

const catalog = catalogData as Catalog;
let highs: Awaited<ReturnType<typeof createHighs>>;
beforeAll(async () => { highs = await createHighs(); });
function plates() {
  const plan = createDefaultPlan(catalog);
  plan.mode = 'target';
  plan.targets = [{ itemId: 'iron-plate', rate: 40, scale: 1, weight: 1 }];
  plan.sources = [{ ...plan.sources[0], kind: 'flow', limit: 30 }];
  plan.settings.enabledRecipeIds = ['iron-ingot', 'iron-plate'];
  return plan;
}
describe('предпросмотр недостающего снабжения', () => {
  it('объясняет недостающий катерий во всех представлениях заказа на 14 продуктов', () => {
    const plan = largeOrder(catalog);
    plan.sources = plan.sources.filter(s => s.itemId !== 'caterium-ore');
    const result = emptyResult('error', 'В консервативной модели автоподбора частот допустимый план не найден.');
    const report: ProductionVariants = { equivalent: false, variants: [{ id: 'maximum', label: '', plan, result }],
      pareto: { pass: 1, attempted: 1, covered: [], pending: [], complete: false, failures: [{ label: '', message: '', status: 'timeout' }] } };
    attachSupplyDiagnosis(catalog, plan, highs, report);
    expect(report.supplyGaps).toHaveLength(1);
    expect(report.supplyGaps![0]).toMatchObject({ itemId: 'caterium-ore', available: 0 });
    expect(report.supplyGaps![0].minimumExtra).toBeGreaterThan(0);
    expect(result.status).toBe('infeasible');
    expect(report.pareto!.failures[0]).toMatchObject({ status: 'infeasible', message: result.message });
  });
  it('рассчитывает недостающую руду и добавляет один узел после подтверждения', () => {
    const plan = plates();
    const gaps = diagnoseSupply(catalog, plan, highs);
    expect(gaps).toEqual([{ itemId: 'iron-ore', available: 30, extra: 30, minimumExtra: 30, consumers: ['iron-ingot'] }]);
    const next = supplyChange(catalog, plan, gaps[0], 30, 'miner-mk1', 0.5, 'proposal')!;
    expect(next.sources.at(-1)).toMatchObject({ id: 'proposal', count: 1, purity: 0.5, limit: 30 });
    expect(plan.sources).toHaveLength(1);
    expect(solve(catalog, next, highs).products[0].rate).toBeCloseTo(40);
  });
  it('учитывает общий лимит, даже если текущие внешние поставки не ограничены', () => {
    const plan = plates();
    plan.sources[0].limit = null;
    plan.settings.inputLimits = { 'iron-ore': 0 };
    const [gap] = diagnoseSupply(catalog, plan, highs);
    expect(gap.extra).toBe(60);
    const next = supplyChange(catalog, plan, gap, 60, null, 1, 'proposal')!;
    expect(next.sources).toEqual(plan.sources);
    expect(next.settings.inputLimits?.['iron-ore']).toBe(60);
    expect(plan.settings.inputLimits['iron-ore']).toBe(0);
  });
  it('различает взаимозаменяемый вход и обязательную поставку', () => {
    const plan = plates();
    plan.sources = [];
    const iron = catalog.recipes.find(r => r.id === 'iron-ingot')!;
    const alternative = { ...iron, id: 'test-copper', inputs: [{ itemId: 'copper-ore', amount: 1 }] };
    const alternativeCatalog = { ...catalog, recipes: [...catalog.recipes, alternative] };
    plan.settings.enabledRecipeIds.push(alternative.id);
    const [gap] = diagnoseSupply(alternativeCatalog, plan, highs);
    expect(gap.extra).toBe(60);
    expect(gap.minimumExtra).toBe(0);
  });
  it('при доступном сырье, закрытом рецепте или полностью набранной партии не предлагает добычу', () => {
    const plan = plates();
    plan.sources = [];
    plan.settings.resourcePolicy = 'unlimited-unlisted';
    expect(diagnoseSupply(catalog, plan, highs)).toEqual([]);
    plan.settings.resourcePolicy = 'listed-only';
    plan.batch = { minutes: 10, items: [{ itemId: 'iron-plate', required: 10, stock: 10 }] };
    expect(diagnoseSupply(catalog, plan, highs)).toEqual([]);
    delete plan.batch;
    plan.settings.enabledRecipeIds = [];
    expect(diagnoseSupply(catalog, plan, highs)).toEqual([]);
  });
});
