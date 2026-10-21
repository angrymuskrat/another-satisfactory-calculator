import { beforeAll, describe, expect, it } from 'vitest';
import { createHighs } from '../packages/solver/highs';
import { solve } from '../packages/solver/solve';
import { validateResult } from '../packages/solver/validate';
import { analyze } from '../packages/solver/analysis';
import { solveVariants } from '../packages/solver/variants';
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
  it('повторно использует рецепт закреплённой линии вместо новых стадий', () => {
    const { fixture, plan } = simpleFixture();
    plan.lines = [{ id: 'old', name: 'Цех', recipeId: 'direct', count: 1, clock: 100, somersloops: 0, duty: 1, locked: true }];
    plan.expansion = 'add';
    plan.settings.recipesFirst = { extraPercent: 10 };
    const result = solve(fixture, plan, highs);
    expect(['approximate', 'optimal']).toContain(result.status);
    expect(result.steps.every(s => s.recipeId === 'direct')).toBe(true);
    expect(buildComplexity(plan, result).distinctRecipes).toBe(1);
    expect(result.machineBudget).toEqual({ minimum: 3, limit: 4, used: 3 });
    expect(validateResult(fixture, plan, result).errors).toEqual([]);
  });
  it('при равном числе рецептов выбирает набор с меньшим числом машин', () => {
    const { fixture, plan } = simpleFixture();
    fixture.recipes.push({ id: 'direct-slow', name: 'Медленная', nameEn: 'Slow', category: 'Детали', buildingId: 'constructor', seconds: 12, alternate: false, inputs: [{ itemId: 'ore', amount: 1 }], outputs: [{ itemId: 'plate', amount: 1 }] });
    plan.settings.recipesFirst = { extraPercent: 300 };
    const result = solve(fixture, plan, highs);
    expect(['approximate', 'optimal']).toContain(result.status);
    expect(result.steps.map(s => s.recipeId)).toEqual(['direct']);
    expect(result.machineBudget).toEqual({ minimum: 2, limit: 8, used: 3 });
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
  it('вне ровной нагрузки флаг не действует: нет бюджета, валидатор его не требует', () => {
    const { fixture, plan } = simpleFixture();
    plan.settings.objective = 'buildings';
    plan.settings.recipesFirst = { extraPercent: 10 };
    const result = solve(fixture, plan, highs);
    expect(['approximate', 'optimal']).toContain(result.status);
    expect(result.machineBudget).toBeUndefined();
    expect(buildComplexity(plan, result).distinctRecipes).toBe(2);
    expect(validateResult(fixture, plan, result).errors).toEqual([]);
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

describe('вариант «Проще построить»', () => {
  it('четвёртая карточка уменьшает число рецептов и сохраняет заказ', () => {
    const { fixture, plan } = simpleFixture();
    const report = solveVariants(fixture, plan, highs);
    expect(report.variants.map(v => v.id)).toEqual(['maximum', 'economy', 'resources', 'simple']);
    const simple = report.variants[3];
    expect(simple.label).toBe('Проще построить');
    expect(simple.plan.settings.recipesFirst).toEqual({ extraPercent: 10 });
    expect(simple.plan.settings.outputSlack).toBe(0);
    expect(simple.result.steps.map(s => s.recipeId)).toEqual(['direct']);
    expect(simple.sameAs).toBeUndefined();
    expect(report.equivalent).toBe(false);
    expect(validateResult(fixture, simple.plan, simple.result).errors).toEqual([]);
  });
  it('берёт процент из настроек и потерю выпуска как у экономичных вариантов', () => {
    const { fixture, plan } = simpleFixture();
    plan.mode = 'maximize'; plan.sources[0].limit = 30;
    plan.settings.variantOptions = { outputLoss: 20, extraMachines: 0, simplerExtraPercent: 0 };
    const simple = solveVariants(fixture, plan, highs).variants[3];
    expect(simple.plan.settings.recipesFirst).toEqual({ extraPercent: 0 });
    expect(simple.plan.settings.outputSlack).toBe(20);
  });
  it('план с принятым recipesFirst снова даёт четыре допустимых варианта', () => {
    const { fixture, plan } = simpleFixture();
    const accepted = solveVariants(fixture, plan, highs).variants[3].plan;
    const next = solveVariants(fixture, accepted, highs);
    for (const variant of next.variants) {
      expect(variant.result.status, variant.result.message).toBe('approximate');
      expect(validateResult(fixture, variant.plan, variant.result).errors).toEqual([]);
    }
    expect(next.variants[0].plan.settings.recipesFirst).toBeUndefined();
    expect(next.variants[1].plan.settings.recipesFirst).toBeUndefined();
    expect(next.variants[2].plan.settings.recipesFirst).toBeUndefined();
  });
});

describe('анализ с recipesFirst', () => {
  it('сравнение хранит число разных рецептов, а польза идёт по порядку «рецепты → машины»', () => {
    const { fixture, plan } = simpleFixture();
    plan.settings.recipesFirst = { extraPercent: 10 };
    // Базовый план: одна «прямая» (1 рецепт, 3 машины); без неё — две стадии (2 рецепта, 2 машины).
    const off = analyze(fixture, plan, highs, { kind: 'recipes', recipeIds: ['direct'] });
    expect(off.baselineSummary?.distinctRecipes).toBe(1);
    const disabled = off.variants[0];
    expect(disabled.comparison?.distinctRecipes).toEqual({ before: 1, after: 2, delta: 1 });
    expect(disabled.comparison?.physical.total).toEqual({ before: 3, after: 2, delta: -1 });
    // Машин меньше, но рецептов больше: при порядке «машины первыми» это была бы польза, при recipesFirst — нет.
    expect(disabled.benefit).toBe('none');

    // Обратный случай: базово две стадии, разрешение «прямой» уменьшает число рецептов ценой машины.
    plan.settings.enabledRecipeIds = plan.settings.enabledRecipeIds.filter(id => id !== 'direct');
    const on = analyze(fixture, plan, highs, { kind: 'recipes', recipeIds: ['direct'] });
    expect(on.baselineSummary?.distinctRecipes).toBe(2);
    const enabled = on.variants[0];
    expect(enabled.comparison?.distinctRecipes).toEqual({ before: 2, after: 1, delta: -1 });
    expect(enabled.comparison?.physical.total).toEqual({ before: 2, after: 3, delta: 1 });
    expect(enabled.benefit).toBe('cost');

    // Без recipesFirst решатель ставит машины первыми и остаётся на двух стадиях: рецептов столько же, пользы нет.
    delete plan.settings.recipesFirst;
    const control = analyze(fixture, plan, highs, { kind: 'recipes', recipeIds: ['direct'] }).variants[0];
    expect(control.comparison?.distinctRecipes).toEqual({ before: 2, after: 2, delta: 0 });
    expect(control.benefit).toBe('none');
  });
});
