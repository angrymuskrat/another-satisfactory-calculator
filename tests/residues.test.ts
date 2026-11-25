import { beforeAll, expect, it } from 'vitest';
import data from '../packages/game-data/catalog.json';
import type { Catalog, Plan } from '../packages/domain/types';
import { createDefaultPlan } from '../packages/domain/defaults';
import { parsePlan } from '../packages/domain/validation';
import { analyze } from '../packages/solver/analysis';
import { residueCandidates } from '../packages/solver/residues';
import { solve } from '../packages/solver/solve';
import { validateResult } from '../packages/solver/validate';
import { createHighs } from '../packages/solver/highs';

const catalog = data as Catalog;
let highs: Awaited<ReturnType<typeof createHighs>>;
beforeAll(async () => { highs = await createHighs(); });
const itemId = 'heavy-oil-residue';
function oil(mode: Plan['mode'] = 'target') {
  const plan = createDefaultPlan(catalog);
  plan.mode = mode;
  plan.sources = [{ id: 'oil', itemId: 'crude-oil', kind: 'flow', limit: 30, count: 1, clock: 100, purity: 1, minerId: '' }];
  plan.targets = [{ itemId: 'plastic', rate: 20, scale: 1, weight: 1 }];
  plan.settings.enabledRecipeIds = ['plastic'];
  plan.settings.enabledBuildingIds = ['oil-refinery', 'packager', 'awesome-sink'];
  return plan;
}
function analyzeOil(plan: Plan, receiver = '') {
  return analyze(catalog, plan, highs, { kind: 'residues', itemId, receiver, limit: 10 }).residues!;
}

it('переработка запрещает отгрузку лишней жидкости, сохраняет заказанную и отклоняет поддельный результат', () => {
  const plan = oil();
  plan.settings.objective = 'power';
  plan.exports = [{ itemId, name: 'Топливная фабрика', limit: 10 }];
  const result = solve(catalog, plan, highs);
  expect(result.exports?.[0]?.rate).toBeCloseTo(10);
  plan.settings.processFluidsOnSite = true;
  expect(parsePlan(plan).settings.processFluidsOnSite).toBe(true);
  expect(solve(catalog, plan, highs).status).toBe('infeasible');
  expect(validateResult(catalog, plan, result).errors.join(' ')).toMatch(/получател/);
  plan.targets.push({ itemId, rate: 10, scale: 1, weight: 1 });
  expect(solve(catalog, plan, highs).products[1].rate).toBeCloseTo(10);
  plan.targets.pop();
  plan.settings.processFluidsOnSite = false;
  plan.exports[0].name = '  ';
  expect(solve(catalog, plan, highs).status).toBe('infeasible');
});

it.each(['target', 'maximize'] as const)('после блокировки в режиме %s проверяет конечную отгрузку и сохраняет исходный заказ', mode => {
  const p = oil(mode);
  const old = structuredClone(p);
  const baseline = solve(catalog, p, highs);
  expect(baseline.products.some(f => f.rate > 0)).toBe(false);
  expect(residueCandidates(catalog, p, baseline)).toContain(itemId);
  const report = analyzeOil(p);
  const outlet = report.routes.find(r => r.id === 'export')!;
  expect(outlet.conditionalReceiver).toBe(true);
  expect(outlet.result.products[0].rate).toBeCloseTo(20);
  expect(outlet.result.exports?.[0].rate).toBeCloseTo(10);
  expect(p).toEqual(old);
  expect(report.routes.every(r => r.result.products[0].rate > 19.99999 && !r.result.surplus.some(f => f.itemId === itemId))).toBe(true);
});

it('сравнивает кокс и упаковку при одном выпуске, включая расход тары и локальные МВт отдельно от энергии импорта', () => {
  const p = oil();
  p.settings.enabledRecipeIds.push('petroleum-coke', 'packaged-heavy-oil-residue');
  p.sources.push({ ...p.sources[0], id: 'container', itemId: 'empty-canister', limit: 10, importPower: 1 });
  const report = analyzeOil(p, 'Получатель мазута');
  const coke = report.routes.find(r => r.id === 'recipe:petroleum-coke:sink')!;
  const packing = report.routes.find(r => r.id === 'recipe:packaged-heavy-oil-residue:sink')!;
  expect(coke.localPower).toBeCloseTo(64.8, 2);
  expect(packing.localPower).toBeCloseTo(62.34, 2);
  expect(packing.result.power - packing.localPower).toBeCloseTo(10);
  expect(coke.result.surplus).toContainEqual({ itemId: 'petroleum-coke', rate: expect.closeTo(30) });
  expect(packing.result.surplus).toContainEqual({ itemId: 'packaged-heavy-oil-residue', rate: expect.closeTo(10) });
  for (const route of [coke, packing]) {
    expect(route.machines).toBe(3);
    expect(route.materials.complete).toBe(true);
    expect(validateResult(catalog, route.plan, route.result).errors).toEqual([]);
  }
  expect(report.routes.find(r => r.id === 'export')!.conditionalReceiver).toBe(false);
  p.sources.pop();
  expect(analyzeOil(p).routes.some(r => r.id === 'recipe:packaged-heavy-oil-residue:sink')).toBe(false);
});

it('соблюдает мир, локальные запреты зданий и пропускает подсказку для пластин без остатка', () => {
  const p = oil();
  p.world = { id: 'world', revision: 1, unlockedRecipeIds: ['plastic', 'petroleum-coke'], unlockedBuildingIds: ['oil-refinery'],
    unlockedMilestoneIds: [], beltId: p.settings.beltId, pipeId: p.settings.pipeId, overclockUnlocked: true };
  expect(analyzeOil(p).routes.every(r => r.result.surplus.length === 0 && !r.plan.settings.allowSink)).toBe(true);
  delete p.world;
  p.settings.enabledBuildingIds = ['oil-refinery'];
  expect(analyzeOil(p).routes.every(r => r.result.surplus.length === 0)).toBe(true);
  const plates = createDefaultPlan(catalog);
  plates.targets[0].itemId = 'iron-plate';
  plates.settings.enabledRecipeIds = ['iron-plate', 'iron-ingot'];
  expect(residueCandidates(catalog, plates, solve(catalog, plates, highs))).toEqual([]);
});

it('предлагает прямую утилизацию только для принимаемого твёрдого остатка и сохраняет лимиты', () => {
  const plan = oil();
  plan.targets[0].itemId = 'fuel';
  plan.settings.enabledRecipeIds = ['fuel'];
  const request = { kind: 'residues' as const, itemId: 'polymer-resin', receiver: '', limit: 15 };
  const compare = () => analyze(catalog, plan, highs, request).residues!;
  const route = compare().routes.find(r => r.id === 'sink')!;
  expect(route.result.surplus[0]).toEqual({ itemId: 'polymer-resin', rate: expect.closeTo(15) });
  expect(route.result.sinkPower).toBe(30);
  expect(plan.settings.allowSink).toBe(false);
  plan.settings.buildingLimits = { 'awesome-sink': 0 };
  expect(compare().routes.some(r => r.result.sinkPower > 0)).toBe(false);
});
