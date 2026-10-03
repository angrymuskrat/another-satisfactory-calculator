import { beforeAll, describe, expect, it } from 'vitest';
import { createHighs } from '../packages/solver/highs';
import { solve } from '../packages/solver/solve';
import { solveVariants } from '../packages/solver/variants';
import { alternateCandidates, analyze } from '../packages/solver/analysis';
import { validateResult } from '../packages/solver/validate';
import { createDefaultPlan } from '../packages/domain/defaults';
import { parsePlan } from '../packages/domain/validation';
import { mapResourceLimits, scarcityWeights, UNLIMITED_WEIGHT } from '../packages/domain/mapResources';
import gameCatalog from '../packages/game-data/catalog.json';
import type { Catalog, Plan } from '../packages/domain/types';

const catalog = gameCatalog as Catalog;
let highs: Awaited<ReturnType<typeof createHighs>>;
beforeAll(async () => { highs = await createHighs(); });

/** Fast recipe spends a rare ore; the slow one spends twice as much common ore. */
function rareFixture() {
  const fixture: Catalog = {
    version: 'scarcity', provenance: { source: 'fixture', commit: '', importedAt: '', verified: true, notes: [] },
    items: ['ore', 'rare', 'plate'].map(id => ({ id, name: id, nameEn: id, category: 'Детали', raw: id !== 'plate', fluid: false, sinkable: true })),
    buildings: [{ id: 'constructor', name: 'Конструктор', nameEn: 'Constructor', power: 4 }],
    recipes: [
      { id: 'fast-rare', name: 'Быстрая', nameEn: 'Fast', category: 'Детали', buildingId: 'constructor', seconds: 1, alternate: false, inputs: [{ itemId: 'rare', amount: 1 }], outputs: [{ itemId: 'plate', amount: 1 }] },
      { id: 'slow-common', name: 'Медленная', nameEn: 'Slow', category: 'Детали', buildingId: 'constructor', seconds: 6, alternate: false, inputs: [{ itemId: 'ore', amount: 2 }], outputs: [{ itemId: 'plate', amount: 1 }] },
    ],
    miners: [{ id: 'mk1', name: 'Mk1', rate: 60, power: 5, resourceIds: ['ore', 'rare'] }],
    belts: [{ id: 'belt1', name: 'Лента', rate: 600 }], pipes: [{ id: 'pipe1', name: 'Труба', rate: 300 }], categories: ['Детали'],
  };
  const plan = createDefaultPlan(fixture);
  plan.mode = 'target';
  plan.targets = [{ itemId: 'plate', rate: 30, weight: 1, scale: 1 }];
  plan.sources = [
    { id: 'ore', itemId: 'ore', kind: 'flow', limit: 600, count: 1, purity: 1, minerId: 'mk1', clock: 100 },
    { id: 'rare', itemId: 'rare', kind: 'flow', limit: 600, count: 1, purity: 1, minerId: 'mk1', clock: 100 },
  ];
  plan.settings.resourceWeights = { ore: 1, rare: 10 };
  return { fixture, plan };
}

describe('запасы карты и веса редкости', () => {
  it('пределы карты совпадают с контрольными итогами Wiki', () => {
    const limits = mapResourceLimits(catalog);
    expect(limits['iron-ore']).toBe(92100);
    expect(limits.limestone).toBe(69300);
    expect(limits['crude-oil']).toBe(12600);
    expect(limits['nitrogen-gas']).toBe(12000);
    expect(limits.uranium).toBe(2100);
    expect(limits.water).toBeNull();
  });
  it('железо получает вес 1, уран — наибольший, вода — минимальный допустимый', () => {
    const weights = scarcityWeights(catalog);
    expect(weights['iron-ore']).toBe(1);
    expect(weights.uranium).toBeCloseTo(92100 / 2100, 3);
    expect(Math.max(...Object.values(weights))).toBe(weights.uranium);
    expect(weights.water).toBe(UNLIMITED_WEIGHT);
    expect(Object.keys(weights).sort()).toEqual(catalog.items.filter(i => i.raw).map(i => i.id).sort());
  });
  it('новый план получает веса редкости и проходит проверку вместе с resourcesFirst', () => {
    const plan = createDefaultPlan(catalog);
    expect(plan.settings.resourceWeights).toEqual(scarcityWeights(catalog));
    plan.settings.resourcesFirst = true;
    expect(() => parsePlan(plan)).not.toThrow();
  });
});

describe('вариант «Экономия редкого сырья»', () => {
  it('меняет рецепт на обычное сырьё, сохраняя заказ и баланс', () => {
    const { fixture, plan } = rareFixture();
    const compact = solve(fixture, plan, highs);
    expect(compact.status, compact.message).toBe('approximate');
    expect(compact.steps.map(s => s.recipeId)).toEqual(['fast-rare']);
    const report = solveVariants(fixture, plan, highs);
    const resources = report.variants.find(v => v.id === 'resources')!;
    expect(resources.result.status, resources.result.message).toBe('approximate');
    expect(resources.plan.settings.resourcesFirst).toBe(true);
    expect(resources.result.products[0].rate).toBeCloseTo(30, 6);
    expect(resources.result.steps.map(s => s.recipeId)).toEqual(['slow-common']);
    expect(resources.result.resources.find(r => r.itemId === 'rare')?.rate ?? 0).toBeCloseTo(0, 6);
    expect(validateResult(fixture, resources.plan, resources.result).errors).toEqual([]);
    expect(resources.sameAs).toBeUndefined();
    expect(report.equivalent).toBe(false);
  });
  it('в максимуме применяет ту же потерю выпуска, что и экономия энергии', () => {
    const { fixture, plan } = rareFixture();
    plan.mode = 'maximize'; plan.sources[1].limit = 30; plan.sources[0].limit = 0.000001;
    plan.settings.variantOptions = { outputLoss: 50, extraMachines: 0 };
    const [maximum, , resources] = solveVariants(fixture, plan, highs).variants;
    expect(resources.plan.settings.outputSlack).toBe(50);
    expect(resources.result.products[0].rate).toBeGreaterThanOrEqual(maximum.result.products[0].rate * 0.5 - 1e-6);
    expect(resources.result.resources.find(r => r.itemId === 'rare')!.rate).toBeLessThan(maximum.result.resources.find(r => r.itemId === 'rare')!.rate);
  });
});

describe('рейтинг альтернатив', () => {
  function plates(): Plan {
    const plan = createDefaultPlan(catalog);
    plan.mode = 'target'; plan.targets[0].rate = 10;
    return plan;
  }
  it('кандидаты производят предметы цепочки и учитывают закрытый мир', () => {
    const plan = plates();
    const baseline = solve(catalog, plan, highs);
    const { ids } = alternateCandidates(catalog, plan, baseline);
    expect(ids).toContain('alt-screw');
    for (const id of ids) {
      const recipe = catalog.recipes.find(r => r.id === id)!;
      expect(recipe.alternate).toBe(true);
      expect(plan.settings.enabledRecipeIds).not.toContain(id);
    }
    expect(ids.some(id => catalog.recipes.find(r => r.id === id)!.outputs.every(o => o.itemId === 'computer'))).toBe(false);
    const world = { ...plan, world: { id: 'w', revision: 1, unlockedRecipeIds: plan.settings.enabledRecipeIds, unlockedBuildingIds: plan.settings.enabledBuildingIds, beltId: plan.settings.beltId, pipeId: plan.settings.pipeId, overclockUnlocked: true, unlockedMilestoneIds: [] } };
    expect(alternateCandidates(catalog, world, baseline).ids).toEqual([]);
  });
  it('литой винт полезен по порядку целей, полезные варианты стоят выше, план не меняется', () => {
    const plan = plates(), original = structuredClone(plan);
    const report = analyze(catalog, plan, highs, { kind: 'alternates' }, performance.now() + 60000);
    expect(report.kind).toBe('alternates');
    const screw = report.variants.find(v => v.id === 'alt-screw')!;
    expect(screw.benefit).toBe('cost');
    expect(screw.comparison!.physical.total.delta).toBeLessThan(0);
    const order = report.variants.map(v => ['feasibility', 'reachable-output', 'output', 'cost', 'none', 'unknown'].indexOf(v.benefit));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(plan).toEqual(original);
  });
});
