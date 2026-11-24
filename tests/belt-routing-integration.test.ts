import { beforeAll, expect, it } from 'vitest';
import { createHighs } from '../packages/solver/highs';
import { solve } from '../packages/solver/solve';
import { solveVariants } from '../packages/solver/variants';
import { validateResult } from '../packages/solver/validate';
import { createDefaultPlan } from '../packages/domain/defaults';
import { buildConstruction } from '../packages/domain/construction';
import type { Catalog, Plan, Result } from '../packages/domain/types';
import gameCatalog from '../packages/game-data/catalog.json';

let highs: Awaited<ReturnType<typeof createHighs>>;
beforeAll(async () => { highs = await createHighs(); });
function fixture(depth: 1 | 2 = 1): { catalog: Catalog; plan: Plan } {
  const catalog: Catalog = { version: 'routing-integration', provenance: { source: 'test', commit: '', importedAt: '', verified: true, notes: [] },
    items: ['ore', 'part', 'waste'].map(id => ({ id, name: id, nameEn: id, category: 'test', raw: id === 'ore', fluid: false, sinkable: id === 'waste' })),
    buildings: [{ id: 'machine', name: 'machine', nameEn: 'machine', power: 4 }, { id: 'awesome-sink', name: 'Утилизатор', nameEn: 'Sink', power: 30 }],
    recipes: [{ id: 'part', name: 'Деталь', nameEn: 'Part', category: 'test', alternate: false, buildingId: 'machine', seconds: 1, inputs: [{ itemId: 'ore', amount: 1 }], outputs: [{ itemId: 'part', amount: 1 }] }],
    miners: [{ id: 'miner', name: 'Miner', rate: 60, power: 5, resourceIds: ['ore'] }],
    belts: [{ id: 'belt', name: 'belt', rate: 120 }], pipes: [{ id: 'pipe', name: 'pipe', rate: 300 }], categories: ['test'] };
  const plan: Plan = { name: 'Проверка конвейеров', schemaVersion: 1, catalogVersion: catalog.version, mode: 'maximize', policy: 'proportional',
    targets: [{ itemId: 'part', rate: 1, weight: 1, scale: 1 }],
    sources: [{ id: 'ore', itemId: 'ore', kind: 'flow', limit: 60, count: 1, purity: 1, minerId: 'miner', clock: 100 }],
    settings: { enabledRecipeIds: ['part'], enabledBuildingIds: ['machine', 'awesome-sink'], resourcePolicy: 'listed-only', clock: 100, objective: 'smooth-power', outputSlack: 0, powerLimit: null, resourceWeights: {}, allowSink: false, beltId: 'belt', pipeId: 'pipe', beltRouting: { enabled: true, maxDepth: depth } } };
  return { catalog, plan };
}
function checked(catalog: Catalog, plan: Plan, result: Result) {
  expect(result.status, result.message).toBe('approximate');
  expect(validateResult(catalog, plan, result).errors).toEqual([]);
  expect(result.beltRouting?.depth).toBe(plan.settings.beltRouting!.maxDepth);
  expect(result.beltRouting!.networks.length).toBeGreaterThan(0);
  const capacity = catalog.belts.find(b => b.id === plan.settings.beltId)!.rate;
  for (const network of result.beltRouting!.networks) {
    expect(network.edges.length).toBeGreaterThan(0);
    expect(network.edges.every(edge => edge.rate > 0 && edge.rate <= capacity + 1e-5)).toBe(true);
  }
}

it('строит стандартную фабрику пластин с реальными устройствами за один состав', () => {
  const catalog = gameCatalog as Catalog, plan = createDefaultPlan(catalog);
  plan.settings.beltRouting = { enabled: true, maxDepth: 4 };
  const result = solve(catalog, plan, highs, performance.now() + 10000);
  checked(catalog, plan, result);
  expect(result.products[0].rate).toBeCloseTo(10, 5);
  expect(result.beltRouting!.searchedConfigurations).toBe(1);
  expect(result.beltRouting!.networks.some(n => n.nodes.some(node => node.kind === 'merge'))).toBe(true);
}, 15000);

it('отправляет побочный продукт в физический Sink и сохраняет мощность и баланс', () => {
  const { catalog, plan } = fixture();
  catalog.recipes[0].outputs.push({ itemId: 'waste', amount: 1 }); plan.settings.allowSink = true;
  const result = solve(catalog, plan, highs, performance.now() + 4000); checked(catalog, plan, result);
  expect(result.products[0].rate).toBeCloseTo(60, 5);
  expect(result.surplus).toEqual([{ itemId: 'waste', rate: expect.closeTo(60, 5) }]);
  expect(result.sinkPower).toBeCloseTo(30, 5); expect(result.beltRouting!.sinkCounts.waste).toBe(1);
  const waste = result.beltRouting!.networks.find(n => n.itemId === 'waste')!;
  expect(waste.nodes.some(n => n.kind === 'demand' && n.id.includes('sink:waste'))).toBe(true);
}, 7000);

it('усиленная плавильня передаёт 60 слитков из 30 руды и учитывает физический Somersloop', () => {
  const catalog = gameCatalog as Catalog, plan = createDefaultPlan(catalog);
  plan.targets = [{ itemId: 'iron-ingot', rate: 1, weight: 1, scale: 1 }];
  plan.sources = [{ id: 'ore', itemId: 'iron-ore', kind: 'flow', limit: 30, count: 1, purity: 1, minerId: '', clock: 100 }];
  plan.settings.enabledRecipeIds = ['iron-ingot']; plan.settings.beltRouting = { enabled: true, maxDepth: 1 }; plan.somersloopBudget = 1;
  const result = solve(catalog, plan, highs, performance.now() + 4000); checked(catalog, plan, result);
  expect(result.products[0].rate).toBeCloseTo(60, 5); expect(result.resources[0].rate).toBeCloseTo(30, 5);
  expect(result.somersloops).toBe(1); expect(result.power).toBeCloseTo(16, 5);
  expect(result.steps[0].installedMachines).toBe(1);
  expect(buildConstruction(catalog, plan, result).production[0].averageOutputs[0].rate).toBeCloseTo(60, 5);
}, 7000);

it('партия сохраняет точный остаток 100−40 за 30 минут при разрешённой потере', () => {
  const { catalog, plan } = fixture(2);
  plan.batch = { minutes: 30, items: [{ itemId: 'part', required: 100, stock: 40 }, { itemId: 'waste', required: 10, stock: 10 }] };
  plan.settings.outputSlack = 50; plan.settings.smoothPowerExtraMachines = 0;
  const original = structuredClone(plan);
  const result = solve(catalog, plan, highs, performance.now() + 4000); checked(catalog, plan, result);
  expect(result.products.map(p => p.rate)).toEqual([expect.closeTo(2, 5), 0]);
  expect(result.resources[0].rate).toBeCloseTo(2, 5); expect(plan).toEqual(original);
}, 7000);

it('оба варианта сохраняют потерю выпуска и общий бюджет производства, добычи и Sink', () => {
  const { catalog, plan } = fixture(2);
  catalog.recipes[0].outputs.push({ itemId: 'waste', amount: 1 });
  plan.sources[0].kind = 'node'; plan.settings.allowSink = true;
  plan.settings.variantOptions = { outputLoss: 10, extraMachines: 1 };
  const { variants } = solveVariants(catalog, plan, highs, performance.now() + 4500);
  for (const variant of variants) checked(catalog, variant.plan, variant.result);
  const [maximum, economy] = variants;
  expect(maximum.result.products[0].rate).toBeCloseTo(60, 5);
  expect(economy.result.products[0].rate).toBeGreaterThanOrEqual(54 - 1e-5);
  expect(economy.result.products[0].rate).toBeLessThanOrEqual(60 + 1e-5);
  expect(economy.result.machineBudget).toEqual({ minimum: 3, limit: 4, used: expect.any(Number) });
  const count = buildConstruction(catalog, economy.plan, economy.result).production.reduce((sum, g) => sum + g.count, 0)
    + economy.result.resources[0].installedMachines! + Object.values(economy.result.beltRouting!.sinkCounts).reduce((a, b) => a + b, 0);
  expect(economy.result.machineBudget!.used).toBe(count); expect(count).toBeLessThanOrEqual(4);
  expect(economy.result.power).toBeLessThan(maximum.result.power);
}, 8000);

it('сохраняет производственный цикл с возвратом катализатора без обратных лент внутри блока', () => {
  const { catalog, plan } = fixture(2);
  catalog.recipes[0].inputs.push({ itemId: 'waste', amount: 1 });
  catalog.recipes[0].outputs.push({ itemId: 'waste', amount: 1 });
  const result = solve(catalog, plan, highs, performance.now() + 4000); checked(catalog, plan, result);
  expect(result.products[0].rate).toBeCloseTo(60, 5); expect(result.surplus).toEqual([]);
  const recycled = result.beltRouting!.networks.find(n => n.itemId === 'waste')!;
  expect(recycled.edges.reduce((sum, edge) => sum + edge.rate, 0)).toBeCloseTo(60, 5);
  expect(result.steps[0].inputs.find(p => p.itemId === 'waste')!.rate).toBeCloseTo(60, 5);
  expect(result.steps[0].outputs.find(p => p.itemId === 'waste')!.rate).toBeCloseTo(60, 5);
}, 7000);

it('внешний поток выше одной ленты получает параллельные входы и не теряет расход', () => {
  const { catalog, plan } = fixture(); plan.sources[0].limit = 240;
  const result = solve(catalog, plan, highs, performance.now() + 4000); checked(catalog, plan, result);
  expect(result.products[0].rate).toBeCloseTo(240, 4); expect(result.resources[0].rate).toBeCloseTo(240, 4);
  expect(result.beltRouting!.externalLanes.ore).toBe(2); expect(result.beltRouting!.deliveryLanes['product:0']).toBe(2);
  const ore = result.beltRouting!.networks.find(n => n.itemId === 'ore')!;
  expect(ore.nodes.filter(n => n.kind === 'supply')).toHaveLength(2);
}, 7000);

it('число физических добытчиков сохраняется в конвейерных концах, потоке и пике', () => {
  const { catalog, plan } = fixture(); plan.sources[0].kind = 'node'; plan.sources[0].count = 2; plan.sources[0].limit = null;
  const result = solve(catalog, plan, highs, performance.now() + 4000); checked(catalog, plan, result);
  expect(result.products[0].rate).toBeCloseTo(120, 5); expect(result.resources[0].rate).toBeCloseTo(120, 5);
  expect(result.resources[0].installedMachines).toBe(2); expect(result.extractionPower).toBeCloseTo(10, 5);
  const ore = result.beltRouting!.networks.find(n => n.itemId === 'ore')!;
  expect(ore.nodes.filter(n => n.kind === 'supply')).toHaveLength(2);
  expect(result.installedPower).toBeCloseTo(result.steps.reduce((sum, step) => sum + step.powerMax, 0) + 10, 5);
}, 7000);
