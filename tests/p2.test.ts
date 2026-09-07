import { beforeAll, expect, it } from 'vitest';
import { createHighs } from '../packages/solver/highs';
import { solve } from '../packages/solver/solve';
import { validateResult } from '../packages/solver/validate';
import { buildConstruction } from '../packages/domain/construction';
import { analyze } from '../packages/solver/analysis';
import type { Catalog, Plan } from '../packages/domain/types';
import gameCatalog from '../packages/game-data/catalog.json';
import { createDefaultPlan } from '../packages/domain/defaults';
let highs: Awaited<ReturnType<typeof createHighs>>;
beforeAll(async () => { highs = await createHighs(); });
it('плавильня использует общий слот подсистемы: один Somersloop, 60 слитков из 30 руды, 16 МВт', () => {
  const catalog = gameCatalog as Catalog, plan = createDefaultPlan(catalog); plan.settings.objective = 'power';
  plan.targets = [{ itemId: 'iron-ingot', rate: 1, weight: 1, scale: 1 }];
  plan.sources = [{ id: 'ore', itemId: 'iron-ore', kind: 'flow', limit: 30, count: 1, purity: 1, minerId: '', clock: 100 }];
  plan.settings.enabledRecipeIds = ['iron-ingot']; plan.somersloopBudget = 1;
  const result = solve(catalog, plan, highs);
  expect(result.status).toBe('optimal'); expect(result.products[0].rate).toBeCloseTo(60, 5);
  expect(result.somersloops).toBe(1); expect(result.power).toBeCloseTo(16, 5);
  expect(result.steps[0].installedMachines).toBe(1);
  expect(buildConstruction(catalog, plan, result).production[0].activeOutputs[0].rate).toBe(60);
  expect(validateResult(catalog, plan, result).errors).toEqual([]);
});
export function fixture() {
  const catalog: Catalog = { version: 'test', provenance: { source: 'test', commit: '', importedAt: '', verified: true, notes: [] },
    items: ['ore', 'plate', 'water'].map(id => ({ id, name: id, nameEn: id, category: '', raw: id !== 'plate', fluid: id === 'water', sinkable: id !== 'water' })),
    buildings: [{ id: 'constructor', name: 'Конструктор', nameEn: 'Constructor', power: 4, buildCost: [{ itemId: 'plate', amount: 2 }] }],
    recipes: [{ id: 'plate', name: 'Пластина', nameEn: 'Plate', category: '', buildingId: 'constructor', seconds: 6, inputs: [{ itemId: 'ore', amount: 3 }], outputs: [{ itemId: 'plate', amount: 2 }], alternate: false }],
    miners: [], belts: [{ id: 'belt', name: 'Лента', rate: 120 }], pipes: [{ id: 'pipe', name: 'Труба', rate: 300 }], categories: [] };
  const plan: Plan = { schemaVersion: 1, catalogVersion: 'test', name: 'P2', mode: 'maximize', policy: 'proportional', targets: [{ itemId: 'plate', rate: 1, weight: 1, scale: 1 }],
    sources: [{ id: 'ore', itemId: 'ore', kind: 'flow', limit: 30, count: 1, purity: 1, minerId: '', clock: 100 }],
    settings: { enabledRecipeIds: ['plate'], enabledBuildingIds: ['constructor'], beltId: 'belt', pipeId: 'pipe', clock: 100, resourcePolicy: 'listed-only', objective: 'power', powerLimit: null, outputSlack: 0, allowSink: false, resourceWeights: {} } };
  return { catalog, plan };
}
it('усилитель ограничен бюджетом физических машин и удваивает выход при ×4 MW', () => {
  const { catalog, plan } = fixture(); plan.somersloopBudget = 1;
  const r = solve(catalog, plan, highs);
  expect(r.status).toBe('optimal'); expect(r.products[0].rate).toBeCloseTo(40, 5);
  expect(r.power).toBeCloseTo(16, 5); expect(r.somersloops).toBe(1);
  const c = buildConstruction(catalog, plan, r); expect(c.averagePower).toBeCloseTo(16, 5);
  expect(c.production[0].activeOutputs[0].rate).toBeCloseTo(40, 5);
  expect(validateResult(catalog, { ...plan, somersloopBudget: 0 }, r).errors.length).toBeGreaterThan(0);
});
it('один усилитель нельзя распределить на две полные машины', () => {
  const { catalog, plan } = fixture(); plan.somersloopBudget = 1; plan.sources[0].limit = 60;
  const r = solve(catalog, plan, highs); expect(r.status).toBe('optimal'); expect(r.products[0].rate).toBeCloseTo(60, 5); expect(r.somersloops).toBe(1);
});
it('закреплённая линия сохраняет частоту, количество и выпуск при расширении', () => {
  const { catalog, plan } = fixture(); plan.sources[0].limit = 60;
  plan.lines = [{ id: 'old', name: 'Первый цех', recipeId: 'plate', count: 2, clock: 50, somersloops: 0, duty: 0.5, locked: true }]; plan.expansion = 'add';
  const r = solve(catalog, plan, highs); expect(r.status).toBe('optimal'); expect(r.products[0].rate).toBeCloseTo(40, 5);
  const old = r.steps.find(s => s.configurationId === 'line:old')!;
  expect(old.cycles).toBeCloseTo(5, 6); expect(old.installedMachines).toBe(2);
  const c = buildConstruction(catalog, plan, r); expect(c.production.find(g => g.id === 'line:old')?.clock).toBe(50);
  expect(validateResult(catalog, plan, { ...r, steps: r.steps.filter(s => s !== old) }).errors.length).toBeGreaterThan(0);
});
it('оставить использует свободную мощность, но не строит новые машины', () => {
  const { catalog, plan } = fixture(); plan.sources[0].limit = 60; plan.expansion = 'keep';
  plan.lines = [{ id: 'old', name: '', recipeId: 'plate', count: 1, clock: 100, somersloops: 0, duty: 0.5, locked: false }];
  const r = solve(catalog, plan, highs); expect(r.status).toBe('optimal'); expect(r.products[0].rate).toBeCloseTo(20, 5);
  expect(r.steps.reduce((s, x) => s + x.installedMachines, 0)).toBe(1);
});
it('резерв вычитается из доступного источника и учитывается заданная энергия импорта', () => {
  const { catalog, plan } = fixture(); plan.sources[0].reserve = 15; plan.sources[0].importPower = 2;
  const r = solve(catalog, plan, highs); expect(r.status).toBe('optimal'); expect(r.products[0].rate).toBeCloseTo(10, 5); expect(r.power).toBeCloseTo(32, 5);
});
it('полезный побочный продукт получает конечную отгрузку вместо исчезновения', () => {
  const { catalog, plan } = fixture(); catalog.recipes[0].outputs.push({ itemId: 'water', amount: 1 });
  plan.exports = [{ itemId: 'water', name: 'В соседнюю фабрику', limit: 5 }];
  const r = solve(catalog, plan, highs); expect(r.status).toBe('optimal'); expect(r.products[0].rate).toBeCloseTo(10, 5); expect(r.exports?.[0].rate).toBeCloseTo(5, 5);
  expect(validateResult(catalog, plan, { ...r, exports: [] }).errors.length).toBeGreaterThan(0);
});
it('скважина с двумя спутниками требует один компенсатор даже при малом потоке', () => {
  const { catalog, plan } = fixture(); plan.targets[0].itemId = 'water'; plan.mode = 'target'; plan.targets[0].rate = 10;
  plan.sources = [{ id: 'well', itemId: 'water', kind: 'well', limit: null, count: 1, purity: 1, minerId: '', clock: 100, well: { satellites: [{ purity: 1, count: 2 }] } }];
  const r = solve(catalog, plan, highs); expect(r.status).toBe('optimal'); expect(r.extractionPower).toBeCloseTo(150, 5); expect(r.installedPower).toBeCloseTo(150, 5);
  plan.settings.peakPowerLimit = 149; expect(solve(catalog, plan, highs).status).toBe('infeasible');
});
it('пропускная способность скважины ограничена отдельно на каждый спутник', () => {
  const { catalog, plan } = fixture(); plan.targets[0].itemId = 'water'; catalog.pipes[0].rate = 100;
  plan.sources = [{ id: 'well', itemId: 'water', kind: 'well', limit: null, count: 1, purity: 1, minerId: '', clock: 250, well: { satellites: [{ purity: 2, count: 2 }] } }];
  const r = solve(catalog, plan, highs); expect(r.status).toBe('optimal'); expect(r.products[0].rate).toBeCloseTo(200, 5);
});
it('партия вычитает запас один раз, включая готовые позиции', () => {
  const { catalog, plan } = fixture(); plan.batch = { minutes: 30, items: [{ itemId: 'plate', required: 100, stock: 40 }, { itemId: 'water', required: 50, stock: 60 }] };
  const r = solve(catalog, plan, highs); expect(r.status).toBe('optimal'); expect(r.products.map(p => p.rate)).toEqual([2, 0]);
  expect(validateResult(catalog, plan, r).errors).toEqual([]);
  plan.batch.items[0].stock = 100;
  const ready = solve(catalog, plan, highs); expect(ready.status).toBe('optimal'); expect(ready.steps).toEqual([]); expect(ready.power).toBe(0);
});
it('недостижимая партия показывает долю без рекурсии и деления на готовые позиции', () => {
  const { catalog, plan } = fixture(); plan.batch = { minutes: 1, items: [{ itemId: 'plate', required: 100, stock: 0 }, { itemId: 'water', required: 1, stock: 1 }] };
  const r = solve(catalog, plan, highs); expect(r.status).toBe('infeasible'); expect(r.feasibleAlternative?.fraction).toBeCloseTo(0.2, 5);
});
it('сравнение оставить / добавить / перестроить решает копии плана', () => {
  const { catalog, plan } = fixture(); plan.sources[0].limit = 60;
  plan.lines = [{ id: 'old', name: '', recipeId: 'plate', count: 1, clock: 100, somersloops: 0, duty: 0.5, locked: true }];
  const before = structuredClone(plan);
  const report = analyze(catalog, plan, highs, { kind: 'expansion' });
  expect(report.variants.map(v => v.result.status)).toEqual(['optimal', 'optimal', 'optimal']);
  expect(report.variants[0].result.products[0].rate).toBeCloseTo(10, 5);
  expect(report.variants[1].result.products[0].rate).toBeCloseTo(40, 5);
  expect(report.variants[2].result.products[0].rate).toBeCloseTo(40, 5); expect(plan).toEqual(before);
});
it('перестройка не требует открытий частоты и усилителей демонтируемой линии', () => {
  const { catalog, plan } = fixture(); plan.expansion = 'rebuild';
  plan.lines = [{ id: 'old', name: '', recipeId: 'plate', count: 1, clock: 250, duty: 1, somersloops: 1, locked: true }];
  plan.world = { id: 'w', revision: 1, unlockedRecipeIds: ['plate'], unlockedBuildingIds: ['constructor'], unlockedMilestoneIds: [], beltId: 'belt', pipeId: 'pipe', overclockUnlocked: false };
  const r = solve(catalog, plan, highs); expect(r.status).toBe('optimal'); expect(r.products[0].rate).toBeCloseTo(20, 5);
});
