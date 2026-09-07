import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createHighs } from '../packages/solver/highs';
import { solve } from '../packages/solver/solve';
import { parsePlan } from '../packages/domain/validation';
import { validateResult } from '../packages/solver/validate';
import { createDefaultPlan } from '../packages/domain/defaults';
import gameCatalog from '../packages/game-data/catalog.json';
import type { Catalog, Plan } from '../packages/domain/types';
import { solveVariants } from '../packages/solver/variants';

const catalog = gameCatalog as Catalog;
let highs: Awaited<ReturnType<typeof createHighs>>;
beforeAll(async () => { highs = await createHighs(); });
function ingots(): Plan {
  const plan = createDefaultPlan(catalog);
  plan.mode = 'target';
  plan.targets = [{ itemId: 'iron-ingot', rate: 30, weight: 1, scale: 1 }];
  plan.sources = [{ id: 'iron', itemId: 'iron-ore', kind: 'flow', limit: 120, count: 1, purity: 1, minerId: 'miner-mk1', clock: 100 }];
  plan.settings.enabledRecipeIds = ['iron-ingot'];
  plan.settings.clock = 100;
  plan.settings.objective = 'smooth-power';
  return plan;
}

describe('бюджет машин вариантов', () => {
  it('снижает энергию за счёт одной дополнительной физической плавильни', () => {
    const plan = ingots();
    const compact = solve(catalog, plan, highs);
    expect(compact.status, compact.message).toBe('approximate');
    Object.assign(plan.settings, { smoothPowerExtraMachines: 1 });
    const economy = solve(catalog, plan, highs);
    expect(economy.status, economy.message).toBe('approximate');
    expect(economy.products[0].rate).toBeCloseTo(30, 5);
    expect(economy.steps[0].installedMachines).toBe(2);
    expect(economy.steps[0].clock).toBeCloseTo(50, 5);
    expect(economy.power).toBeCloseTo(3.2, 5);
    expect(economy.power).toBeLessThan(compact.power);
    expect(validateResult(catalog, plan, economy).errors).toEqual([]);
  });
  it('сохраняет новые настройки при чтении плана без изменения старых файлов', () => {
    const plan = ingots();
    expect(parsePlan(plan)).toEqual(plan);
    Object.assign(plan.settings, { variantOptions: { outputLoss: 10, extraMachines: 2 }, smoothPowerExtraMachines: 2 });
    expect(parsePlan(JSON.parse(JSON.stringify(plan)))).toEqual(plan);
  });
  it.each([
    { variantOptions: { outputLoss: -1, extraMachines: 0 } },
    { variantOptions: { outputLoss: 100, extraMachines: 0 } },
    { variantOptions: { outputLoss: 10, extraMachines: 0.5 } },
    { variantOptions: { outputLoss: 10, extraMachines: 1001 } },
    { smoothPowerExtraMachines: -1 }, { smoothPowerExtraMachines: 0.5 }, { smoothPowerExtraMachines: 1001 },
  ])('отклоняет недопустимые настройки %j', settings => {
    const plan = ingots(); Object.assign(plan.settings, settings);
    expect(() => parsePlan(plan)).toThrow('Некорректный план');
  });
  it('возвращает конечный бюджет с целыми количествами', () => {
    const plan = ingots(); plan.settings.smoothPowerExtraMachines = 1;
    expect(solve(catalog, plan, highs).machineBudget).toEqual({ minimum: 1, limit: 2, used: 2 });
  });
});

describe('два проверенных варианта', () => {
  it('применяет потерю ровно один раз к исходному максимуму и не меняет вход', () => {
    const plan = ingots(); plan.mode = 'maximize'; plan.settings.outputSlack = 50;
    plan.settings.smoothPowerExtraMachines = 100;
    const before = structuredClone(plan);
    const { variants, equivalent } = solveVariants(catalog, plan, highs);
    expect(plan).toEqual(before);
    expect(variants.map(v => v.id)).toEqual(['maximum', 'economy']);
    expect(variants[0].result.products[0].rate).toBeCloseTo(120, 5);
    expect(variants[1].result.products[0].rate).toBeCloseTo(108, 5);
    expect(variants[1].result.machineBudget).toEqual({ minimum: 4, limit: 4, used: 4 });
    expect(variants[1].plan.settings.outputSlack).toBe(10);
    expect(variants[0].plan.settings.smoothPowerExtraMachines).toBeUndefined();
    expect(equivalent).toBe(false);
    for (const variant of variants) expect(validateResult(catalog, variant.plan, variant.result).errors).toEqual([]);
  });
  it.each(['proportional', 'priority', 'weighted'] as const)('сохраняет минимумы/максимумы и политику %s', policy => {
    const plan = ingots(); plan.mode = 'maximize'; plan.policy = policy;
    plan.settings.enabledRecipeIds.push('iron-plate');
    plan.targets = [{ itemId: 'iron-ingot', rate: 1, weight: 2, scale: 1, minRate: 30, maxRate: 60 },
      { itemId: 'iron-plate', rate: 1, weight: 1, scale: 1, minRate: 10, maxRate: 40 }];
    plan.settings.variantOptions = { outputLoss: 20, extraMachines: 1 };
    for (const variant of solveVariants(catalog, plan, highs).variants) {
      expect(variant.result.status, variant.result.message).toBe('approximate');
      expect(validateResult(catalog, variant.plan, variant.result).errors).toEqual([]);
      expect(variant.plan.policy).toBe(policy);
      expect(variant.result.products[0].rate).toBeGreaterThanOrEqual(30 - 1e-6);
      expect(variant.result.products[0].rate).toBeLessThanOrEqual(60 + 1e-6);
      expect(variant.result.products[1].rate).toBeGreaterThanOrEqual(10 - 1e-6);
      expect(variant.result.products[1].rate).toBeLessThanOrEqual(40 + 1e-6);
    }
  });
  it.each([false, true])('не уменьшает заказ; партия=%s', batch => {
    const plan = ingots();
    if (batch) { plan.mode = 'maximize'; plan.batch = { minutes: 2, items: [{ itemId: 'iron-ingot', required: 80, stock: 20 }] }; }
    plan.settings.variantOptions = { outputLoss: 99, extraMachines: 1 };
    const result = solveVariants(catalog, plan, highs);
    for (const variant of result.variants) {
      expect(variant.result.status, variant.result.message).toBe('approximate');
      expect(variant.result.products[0].rate).toBeCloseTo(30, 5);
      expect(variant.plan.settings.outputSlack).toBe(0);
      expect(variant.plan.batch).toEqual(plan.batch);
    }
    expect(result.variants[1].result.power).toBeLessThan(result.variants[0].result.power);
  });
  it('объединяет только совпавшие допустимые конфигурации', () => {
    const result = solveVariants(catalog, ingots(), highs);
    expect(result.equivalent).toBe(true);
    expect(result.variants).toHaveLength(2);
  });
  it('не выдаёт тайм-аут или ошибки за эквивалентные варианты', () => {
    const timeout = solveVariants(catalog, ingots(), highs, performance.now() - 1);
    expect(timeout.variants.map(v => v.result.status)).toEqual(['timeout', 'timeout']);
    expect(timeout.equivalent).toBe(false);
    const plan = ingots(); plan.catalogVersion = 'unknown';
    const error = solveVariants(catalog, plan, highs);
    expect(error.variants.map(v => v.result.status)).toEqual(['error', 'error']);
    expect(error.equivalent).toBe(false);
  });
  it('сохраняет максимум при исчерпании общего срока экономичным вариантом', () => {
    const realNow = performance.now.bind(performance); const start = realNow();
    let expired = false;
    const timedHighs = { ...highs, solve: (...args: Parameters<typeof highs.solve>) => {
      // Максимальный вариант не имеет лимита extraMachines; первый вызов
      // экономичного варианта начинается после первого решения целиком.
      const result = highs.solve(...args);
      if (expired) return { ...result, Status: 'Time limit reached' };
      return result;
    } };
    // Реальный HiGHS решает максимум. Время переключается при втором parse/solve
    // через внешний срок, без подмены результата первого решения.
    const plan = ingots();
    const baseSolve = timedHighs.solve; let previousLimit = Infinity;
    timedHighs.solve = (...args) => {
      const limit = Number(args[1]?.time_limit);
      if (limit > previousLimit + 1) expired = true;
      previousLimit = limit;
      return baseSolve(...args);
    };
    vi.spyOn(performance, 'now').mockImplementation(() => realNow());
    try {
      const result = solveVariants(catalog, plan, timedHighs, start + 25000);
      expect(result.variants[0].result.status).toBe('approximate');
      expect(result.variants[1].result.status).toBe('timeout');
      expect(result.equivalent).toBe(false);
    } finally { vi.restoreAllMocks(); }
  });
});
