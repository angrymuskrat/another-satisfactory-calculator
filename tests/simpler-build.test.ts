import { beforeAll, describe, expect, it } from 'vitest';
import { createHighs } from '../packages/solver/highs';
import { solve } from '../packages/solver/solve';
import { validateResult } from '../packages/solver/validate';
import { analyze } from '../packages/solver/analysis';
import { createDefaultPlan } from '../packages/domain/defaults';
import { buildComplexity } from '../packages/domain/complexity';
import type { Catalog, Plan } from '../packages/domain/types';

let highs: Awaited<ReturnType<typeof createHighs>>;
beforeAll(async () => { highs = await createHighs(); });

/** Две быстрые стадии через деталь (2 машины) против одной медленной (3 машины). */
export function simpleFixture() {
  const fixture: Catalog = {
    version: 'simpler', provenance: { source: 'fixture', commit: '', importedAt: '', verified: true, notes: [] },
    items: ['ore', 'part', 'plate'].map(id => ({ id, name: id, nameEn: id, category: 'Детали', raw: id === 'ore', fluid: false, sinkable: true })),
    buildings: [{ id: 'constructor', name: 'Конструктор', nameEn: 'Constructor', power: 4 }],
    recipes: [
      { id: 'make-part', name: 'Деталь', nameEn: 'Part', category: 'Детали', buildingId: 'constructor', seconds: 1, alternate: false, inputs: [{ itemId: 'ore', amount: 1 }], outputs: [{ itemId: 'part', amount: 1 }] },
      { id: 'assemble', name: 'Сборка', nameEn: 'Assemble', category: 'Детали', buildingId: 'constructor', seconds: 1, alternate: false, inputs: [{ itemId: 'part', amount: 1 }], outputs: [{ itemId: 'plate', amount: 1 }] },
      { id: 'direct', name: 'Прямая', nameEn: 'Direct', category: 'Детали', buildingId: 'constructor', seconds: 6, alternate: false, inputs: [{ itemId: 'ore', amount: 1 }], outputs: [{ itemId: 'plate', amount: 1 }] },
    ],
    miners: [{ id: 'mk1', name: 'Mk1', rate: 60, power: 5, resourceIds: ['ore'] }],
    belts: [{ id: 'belt1', name: 'Лента', rate: 600 }], pipes: [{ id: 'pipe1', name: 'Труба', rate: 300 }], categories: ['Детали'],
  };
  const plan: Plan = createDefaultPlan(fixture);
  plan.mode = 'target';
  plan.targets = [{ itemId: 'plate', rate: 30, weight: 1, scale: 1 }];
  plan.sources = [{ id: 'ore', itemId: 'ore', kind: 'flow', limit: 600, count: 1, purity: 1, minerId: 'mk1', clock: 100 }];
  plan.settings.objective = 'smooth-power';
  plan.settings.clock = 100;
  return { fixture, plan };
}

describe('цель recipesFirst', () => {
  it('компактный план использует две стадии, «проще» — один рецепт в бюджете +10%', () => {
    const { fixture, plan } = simpleFixture();
    const compact = solve(fixture, plan, highs);
    expect(compact.status, compact.message).toBe('approximate');
    expect(buildComplexity(plan, compact)).toEqual({ distinctRecipes: 2, intermediateItems: 1 });
    plan.settings.recipesFirst = { extraPercent: 10 };
    const simple = solve(fixture, plan, highs);
    expect(simple.status, simple.message).toBe('approximate');
    expect(simple.products[0].rate).toBeCloseTo(30, 6);
    expect(simple.steps.map(s => s.recipeId)).toEqual(['direct']);
    expect(buildComplexity(plan, simple)).toEqual({ distinctRecipes: 1, intermediateItems: 0 });
    expect(simple.machineBudget).toEqual({ minimum: 2, limit: 3, used: 3 });
    expect(simple.modelNotes!.join(' ')).toContain('минимизируется число разных рецептов');
    expect(validateResult(fixture, plan, simple).errors).toEqual([]);
  });
  it('при 0% не превышает минимум машин и остаётся допустимым', () => {
    const { fixture, plan } = simpleFixture();
    plan.settings.recipesFirst = { extraPercent: 0 };
    const result = solve(fixture, plan, highs);
    expect(result.status, result.message).toBe('approximate');
    expect(result.machineBudget).toEqual({ minimum: 2, limit: 2, used: 2 });
    expect(buildComplexity(plan, result).distinctRecipes).toBe(2);
    expect(validateResult(fixture, plan, result).errors).toEqual([]);
  });
  it('засчитывает рецепт закреплённой линии и не становится невыполнимым', () => {
    const { fixture, plan } = simpleFixture();
    plan.lines = [{ id: 'old', name: 'Цех', recipeId: 'make-part', count: 1, clock: 100, somersloops: 0, duty: 0.5, locked: true }];
    plan.expansion = 'add';
    plan.settings.recipesFirst = { extraPercent: 10 };
    const result = solve(fixture, plan, highs);
    expect(['approximate', 'optimal']).toContain(result.status);
    expect(result.steps.some(s => s.recipeId === 'make-part')).toBe(true);
    expect(validateResult(fixture, plan, result).errors).toEqual([]);
  });
  it('нулевой заказ даёт нулевой бюджет без ошибок', () => {
    const { fixture, plan } = simpleFixture();
    plan.batch = { minutes: 10, items: [{ itemId: 'plate', required: 30, stock: 30 }] };
    plan.settings.recipesFirst = { extraPercent: 10 };
    const result = solve(fixture, plan, highs);
    expect(['approximate', 'optimal']).toContain(result.status);
    expect(result.machineBudget).toEqual({ minimum: 0, limit: 0, used: 0 });
  });
  it('валидатор отклоняет подменённый бюджет', () => {
    const { fixture, plan } = simpleFixture();
    plan.settings.recipesFirst = { extraPercent: 10 };
    const result = solve(fixture, plan, highs);
    expect(validateResult(fixture, plan, { ...result, machineBudget: { minimum: 2, limit: 4, used: 3 } }).errors)
      .toContain('Нарушен бюджет физических машин.');
  });
  it('сводка анализа содержит число разных рецептов', () => {
    const { fixture, plan } = simpleFixture();
    plan.settings.recipesFirst = { extraPercent: 10 };
    const report = analyze(fixture, plan, highs, { kind: 'alternates' });
    expect(report.baselineSummary?.distinctRecipes).toBe(1);
  });
});
