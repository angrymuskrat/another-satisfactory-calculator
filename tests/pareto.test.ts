import { beforeAll, expect, it } from 'vitest';
import { createHighs } from '../packages/solver/highs';
import { solveVariants } from '../packages/solver/variants';
import { solve } from '../packages/solver/solve';
import { solvePareto, dominates } from '../packages/solver/pareto';
import { validateResult } from '../packages/solver/validate';
import { parsePlan } from '../packages/domain/validation';
import { createDefaultPlan } from '../packages/domain/defaults';
import { compareFactories } from '../apps/web/src/paretoComparison';
import type { Catalog } from '../packages/domain/types';
let highs: Awaited<ReturnType<typeof createHighs>>;
beforeAll(async () => { highs = await createHighs(); });
export function fixture() {
  const catalog: Catalog = { version: 'test', provenance: { source: 'test', commit: '', importedAt: '', verified: true, notes: [] },
    items: ['iron', 'copper', 'product'].map(id => ({ id, name: id, nameEn: id, raw: id !== 'product', fluid: false, sinkable: false, category: 'test' })),
    buildings: [{ id: 'machine', name: 'machine', nameEn: 'machine', power: 10 }],
    recipes: ['iron', 'copper'].map((id, i) => ({ id, name: id, nameEn: id, category: 'test', buildingId: 'machine', seconds: 60, inputs: [{ itemId: id, amount: i ? 1 : 2 }], outputs: [{ itemId: 'product', amount: 1 }], alternate: false, power: i ? 20 : 10 })),
    miners: [{ id: 'miner', name: 'miner', power: 1, rate: 60, resourceIds: ['iron', 'copper'] }], belts: [{ id: 'belt', name: 'belt', rate: 1000 }], pipes: [{ id: 'pipe', name: 'pipe', rate: 1000 }], categories: ['test'] };
  const plan = createDefaultPlan(catalog); plan.mode = 'target'; plan.targets = [{ itemId: 'product', rate: 10, weight: 1, scale: 1 }];
  plan.sources = ['iron', 'copper'].map(id => ({ id, itemId: id, kind: 'flow' as const, limit: 100, count: 1, purity: 1 as const, minerId: '', clock: 100 }));
  plan.settings.pareto = true;
  return { catalog, plan };
}
it('сохраняет настройки и не допускает отрицательные лимиты', () => {
  const { plan } = fixture(); plan.settings.inputLimits = { iron: 0, copper: null }; plan.settings.selfSupply = 'coal';
  expect(parsePlan(plan)).toEqual(plan);
  plan.settings.inputLimits.iron = -1; expect(() => parsePlan(plan)).toThrow();
});
it('смешивает ветки и ограничивает сумму источников, без бюджета машин', () => {
  const { catalog, plan } = fixture(); plan.settings.inputLimits = { iron: 12, copper: 4 }; plan.settings.smoothPowerExtraMachines = 0;
  plan.sources.push({ ...plan.sources[1], id: 'copper2' });
  const result = solve(catalog, plan, highs);
  expect(result.status, JSON.stringify(result)).toBe('approximate');
  expect(result.steps).toHaveLength(2); expect(result.machineBudget).toBeUndefined();
  expect(result.resources.filter(s => s.itemId === 'copper').reduce((n, s) => n + s.rate, 0)).toBeCloseTo(4, 5);
  expect(result.steps.reduce((n, s) => n + s.installedMachines, 0)).toBeGreaterThan(10);
  expect(validateResult(catalog, plan, result).errors).toEqual([]);
  plan.settings.inputLimits.copper = 3; expect(validateResult(catalog, plan, result).errors.join()).toContain('суммарный');
});
it('обзор содержит крайние и смешанные недоминируемые точки', () => {
  const { catalog, plan } = fixture();
  const report = solvePareto(catalog, plan, highs, performance.now() + 20000);
  expect(report.variants.length).toBeGreaterThan(2);
  for (const a of report.variants) {
    expect(validateResult(catalog, a.plan, a.result).errors).toEqual([]);
    expect(a.result.products[0].rate).toBeCloseTo(10, 5);
    for (const b of report.variants) if (a !== b) expect(dominates(a.result, b.result)).toBe(false);
  }
});
it('доминирование учитывает каждый ресурс и отличает ноль от малого потока', () => {
  const result = (power: number, iron: number, copper: number) => ({ power, resources: [{ itemId: 'iron', rate: iron }, { itemId: 'copper', rate: copper }] });
  expect(dominates(result(1, 2, 0), result(2, 3, 0))).toBe(true);
  expect(dominates(result(1, 2, 1), result(2, 3, 0))).toBe(false);
  expect(dominates(result(1, 2, 0), result(1, 2, 1e-9))).toBe(true);
});
it('сравнение сохраняет удалённый источник с расходом ноль и изменения рецептов/машин', () => {
  const { catalog, plan } = fixture(); plan.sources = [plan.sources[1]];
  plan.settings.pareto = false;
  catalog.recipes[0].seconds = 120;
  const before = { id: 'before', label: 'before', plan: structuredClone(plan), result: solve(catalog, plan, highs) };
  plan.sources = [{ ...plan.sources[0], id: 'iron', itemId: 'iron' }];
  const after = { id: 'after', label: 'after', plan, result: solve(catalog, plan, highs) };
  const comparison = compareFactories(catalog, before, after);
  expect(comparison.resources.find(r => r.itemId === 'copper')).toMatchObject({ before: 10, after: 0, delta: -10 });
  expect(comparison.added).toEqual(['iron']); expect(comparison.removed).toEqual(['copper']);
  expect(comparison.machines).toBe(10);
});
it('продолжает поиск, сохраняет проверенные точки при тайм-ауте и не переиспользует другой вход', () => {
  const { catalog, plan } = fixture();
  const first = solvePareto(catalog, plan, highs);
  const next = solvePareto(catalog, plan, highs, performance.now() + 10000, undefined, first);
  expect(next.pareto!.attempted).toBeGreaterThan(first.pareto!.attempted);
  expect(next.variants.length).toBeLessThanOrEqual(12);
  const expired = solveVariants(catalog, plan, highs, performance.now() - 1, undefined, next);
  expect(expired.variants).toEqual(next.variants);
  const changed = structuredClone(plan); changed.targets[0].rate = 1000;
  const stale = solvePareto(catalog, changed, highs, performance.now() - 1, undefined, next);
  expect(stale.variants.every(v => v.result.status === 'timeout')).toBe(true);
});
