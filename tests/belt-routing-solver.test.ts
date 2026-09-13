import { beforeAll, expect, it } from 'vitest';
import { createHighs } from '../packages/solver/highs';
import { solve } from '../packages/solver/solve';
import { validateResult } from '../packages/solver/validate';
import type { Catalog, Plan } from '../packages/domain/types';
let highs: Awaited<ReturnType<typeof createHighs>>;
beforeAll(async () => { highs = await createHighs(); });
function fixture(depth: 1 | 2 = 1): { catalog: Catalog; plan: Plan } {
  const catalog: Catalog = { version: 'routing-test', provenance: { source: 'test', commit: '', importedAt: '', verified: true, notes: [] },
    items: ['ore', 'a', 'b'].map(id => ({ id, name: id, nameEn: id, category: 'test', raw: id === 'ore', fluid: false, sinkable: false })),
    buildings: [{ id: 'machine', name: 'machine', nameEn: 'machine', power: 4 }],
    recipes: ['a', 'b'].map(id => ({ id, name: id, nameEn: id, category: 'test', alternate: false, buildingId: 'machine', seconds: .5, inputs: [{ itemId: 'ore', amount: 1 }], outputs: [{ itemId: id, amount: 1 }] })),
    miners: [], belts: [{ id: 'belt', name: 'belt', rate: 120 }], pipes: [{ id: 'pipe', name: 'pipe', rate: 300 }], categories: ['test'] };
  const plan: Plan = { name: 'routing', schemaVersion: 1, catalogVersion: catalog.version, mode: 'maximize', policy: 'weighted',
    targets: [{ itemId: 'a', rate: 1, weight: 1, scale: 1, minRate: 1, maxRate: 80 }, { itemId: 'b', rate: 1, weight: 1, scale: 1, minRate: 1, maxRate: 50 }],
    sources: [{ id: 'ore', itemId: 'ore', kind: 'flow', limit: 120, count: 1, purity: 1, minerId: '', clock: 100 }],
    settings: { enabledRecipeIds: ['a', 'b'], enabledBuildingIds: ['machine'], buildingLimits: { machine: 2 }, resourcePolicy: 'listed-only', clock: 100, objective: 'smooth-power', outputSlack: 0, powerLimit: null, resourceWeights: {}, allowSink: false, beltId: 'belt', pipeId: 'pipe', beltRouting: { enabled: true, maxDepth: depth } } };
  return { catalog, plan };
}
it('disabled routing preserves the original model and has no routing witness', () => {
  const { catalog, plan } = fixture(); plan.settings.beltRouting!.enabled = false;
  const before = solve(catalog, plan, highs); delete plan.settings.beltRouting;
  expect(before).toEqual(solve(catalog, plan, highs)); expect(before.beltRouting).toBeUndefined();
});
it('one level changes weighted production to an actually equal split', () => {
  const { catalog, plan } = fixture(); const result = solve(catalog, plan, highs);
  expect(result.status, result.message).toBe('approximate');
  expect(result.products.map(p => p.rate)).toEqual([expect.closeTo(50, 5), expect.closeTo(50, 5)]);
  expect(result.beltRouting!.networks.some(n => n.nodes.some(node => node.kind === 'split'))).toBe(true);
  expect(validateResult(catalog, plan, result).errors).toEqual([]);
});
it('depth two admits a different split without changing material balance', () => {
  const { catalog, plan } = fixture(2); const result = solve(catalog, plan, highs);
  expect(result.status, result.message).toBe('approximate');
  expect(result.products.reduce((s, p) => s + p.rate, 0)).toBeCloseTo(120, 4);
  expect(validateResult(catalog, plan, result).errors).toEqual([]);
});
it('missing or forged routing witness is independently rejected', () => {
  const { catalog, plan } = fixture(); const result = solve(catalog, plan, highs);
  const missing = structuredClone(result); delete missing.beltRouting;
  expect(validateResult(catalog, plan, missing).errors.join(' ')).toMatch(/схем/);
  result.beltRouting!.networks[0].edges[0].rate += 1;
  expect(validateResult(catalog, plan, result).errors.length).toBeGreaterThan(0);
});
it('counts the selected physical miners in peak power even after lowering output', () => {
  const { catalog, plan } = fixture();
  catalog.miners = [{ id: 'miner', name: 'Miner', rate: 100, power: 5, resourceIds: ['ore'] }];
  plan.sources[0] = { ...plan.sources[0], kind: 'node', count: 2, minerId: 'miner' };
  const result = solve(catalog, plan, highs, performance.now() + 4000);
  expect(result.status, result.message).toBe('approximate');
  expect(validateResult(catalog, plan, result).errors).toEqual([]);
  expect(result.installedPower).toBeCloseTo(result.steps.reduce((n, s) => n + s.powerMax, 0) + result.resources[0].installedMachines! * 5, 6);
});
it.each(['proportional', 'priority', 'weighted'] as const)('preserves policy and hard minimums with output loss: %s', policy => {
  const { catalog, plan } = fixture(2); plan.policy = policy;
  plan.settings.outputSlack = 10; plan.settings.smoothPowerExtraMachines = 0;
  const result = solve(catalog, plan, highs, performance.now() + 5000);
  expect(result.status, result.message).toBe('approximate');
  expect(validateResult(catalog, plan, result).errors).toEqual([]);
  expect(result.machineBudget!.used).toBeLessThanOrEqual(result.machineBudget!.limit);
  expect(result.products.every(p => p.rate >= 1)).toBe(true);
  if (policy === 'proportional') expect(result.products[0].rate).toBeCloseTo(result.products[1].rate, 6);
  if (policy === 'weighted') expect(result.products.reduce((n, p) => n + p.rate, 0)).toBeGreaterThanOrEqual(108 - 1e-5);
});
it('keeps target orders exact with loss settings enabled', () => {
  const { catalog, plan } = fixture(2); plan.mode = 'target'; plan.targets.forEach(t => t.rate = 30);
  plan.settings.outputSlack = 50; plan.settings.smoothPowerExtraMachines = 0;
  const result = solve(catalog, plan, highs, performance.now() + 5000);
  expect(result.status, result.message).toBe('approximate');
  expect(result.products.map(p => p.rate)).toEqual([expect.closeTo(30, 5), expect.closeTo(30, 5)]);
  expect(validateResult(catalog, plan, result).errors).toEqual([]);
});
