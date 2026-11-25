import { beforeAll, expect, it } from 'vitest';
import { hasSolution, type Catalog } from '../packages/domain/types';
import { createDefaultPlan } from '../packages/domain/defaults';
import { createHighs } from '../packages/solver/highs';
import { solve } from '../packages/solver/solve';
import { validateResult } from '../packages/solver/validate';
import { solveVariants } from '../packages/solver/variants';
import gameCatalog from '../packages/game-data/catalog.json';
import { largeOrder } from './largeOrderFixture';

const catalog = gameCatalog as Catalog;
let highs: Awaited<ReturnType<typeof createHighs>>;
beforeAll(async () => { highs = await createHighs(); });

it('не приписывает первому допустимому решению минимум, бюджет машин или незавершённый максимум', () => {
  const plan = createDefaultPlan(catalog);
  plan.mode = 'target';
  plan.settings.enabledRecipeIds = ['iron-ingot'];
  plan.targets = [{ itemId: 'iron-ingot', rate: 30, scale: 1, weight: 1 }];
  const interrupted: typeof highs = { ...highs, solve: (...args) => {
    const result = highs.solve(...args);
    return result.Status === 'Optimal' ? { ...result, Status: 'Time limit reached' } : result;
  } };
  const early = () => solve(catalog, plan, interrupted, undefined, { retainOnTimeout: true });
  const result = early();
  expect(result.status).toBe('approximate');
  expect(result.searchProgress?.machineMinimum).toBeUndefined();
  expect(validateResult(catalog, plan, result).errors).toEqual([]);
  plan.settings.smoothPowerExtraMachines = 0;
  expect(early().status).toBe('timeout');
  delete plan.settings.smoothPowerExtraMachines;
  plan.settings.recipesFirst = { extraPercent: 10 };
  expect(early().status).toBe('timeout');
  delete plan.settings.recipesFirst;
  plan.mode = 'maximize';
  expect(early().status).toBe('timeout');
});

it('сохраняет подтверждённую ступень числа машин при тайм-ауте уточнения энергии', () => {
  const plan = createDefaultPlan(catalog);
  plan.mode = 'target';
  plan.settings.enabledRecipeIds = ['iron-ingot'];
  plan.targets = [{ itemId: 'iron-ingot', rate: 30, scale: 1, weight: 1 }];
  let calls = 0;
  const engine: typeof highs = { ...highs, solve: (...args) => {
    const result = highs.solve(...args);
    return ++calls < 3 ? result : { Status: 'Time limit reached', Columns: {}, Rows: [], ObjectiveValue: NaN };
  } };
  const result = solve(catalog, plan, engine, undefined, { retainOnTimeout: true });
  expect(result.status, result.message).toBe('approximate');
  expect(result.searchProgress).toMatchObject({ completedTiers: 1, machineMinimum: 2 });
  expect(validateResult(catalog, plan, result).errors).toEqual([]);
});

it('отдаёт проверенные физические планы на 14 продуктов до поиска по всем 141 рецептам и сохраняет их при продолжении', () => {
  const plan = largeOrder(catalog);
  const order: string[] = [];
  const engine: typeof highs = { ...highs, solve: (lp, options) => {
    const integerCount = lp.split('Generals\n')[1]?.split('\n')[0].trim().split(/\s+/).length ?? 0;
    if (integerCount >= 141) {
      order.push('full');
      return { Status: 'Time limit reached', Columns: {}, Rows: [], ObjectiveValue: NaN };
    }
    return highs.solve(lp, options);
  } };
  const report = solveVariants(catalog, plan, engine, performance.now() + 30000, (partial, pending) => {
    if (partial.workingPlans?.length && pending.length === 4) order.push('working');
  });
  expect(order[0]).toBe('working');
  expect(order).toContain('full');
  expect(report.workingPlans?.map(v => v.id)).toEqual(['working-machines', 'working-resources']);
  for (const v of report.workingPlans!) {
    expect(v.result.status).toBe('approximate');
    expect(v.plan.settings.enabledRecipeIds).toEqual(plan.settings.enabledRecipeIds);
    expect(v.result.products).toHaveLength(14);
    expect(v.result.machineBudget).toBeUndefined();
    expect(validateResult(catalog, plan, v.result).errors).toEqual([]);
  }
  expect(report.variants.every(v => !hasSolution(v.result))).toBe(true);
  const next = solveVariants(catalog, plan, engine, performance.now() - 1, undefined, report);
  expect(next.pass).toBe(2);
  expect(next.workingPlans).toEqual(report.workingPlans);
  const changed = structuredClone(plan);
  changed.sources.find(s => s.itemId === 'caterium-ore')!.limit = 0;
  expect(solveVariants(catalog, changed, engine, performance.now() - 1, undefined, report).workingPlans).toBeUndefined();
}, 35000);
