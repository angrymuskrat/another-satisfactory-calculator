import { expect, it } from 'vitest';
import { parsePlan } from '../packages/domain/validation';
const valid = () => ({ schemaVersion: 1, catalogVersion: 'fixture', name: 'План', mode: 'maximize', policy: 'proportional', targets: [{ itemId: 'iron-plate', rate: 1, weight: 1, scale: 1 }], sources: [], settings: { enabledRecipeIds: [], enabledBuildingIds: [], beltId: 'belt1', pipeId: 'pipe1', clock: 100, resourcePolicy: 'listed-only', objective: 'power', powerLimit: null, outputSlack: 0, allowSink: false, resourceWeights: {} } });
it('accepts valid plans and rejects corrupted imported plans', () => {
  expect(parsePlan(valid()).name).toBe('План');
  expect(() => parsePlan({ ...valid(), userId: 'another-user' })).toThrow();
  expect(() => parsePlan({ ...valid(), targets: [] })).toThrow();
  expect(() => parsePlan({ ...valid(), targets: [{ itemId: 'iron-plate', rate: NaN, weight: 1, scale: 1 }] })).toThrow();
});
it('rejects duplicate targets and invalid clocks, caps and priority scales', () => {
  const plan = valid(); plan.targets.push(plan.targets[0]); expect(() => parsePlan(plan)).toThrow();
  for (const field of [{ clock: 0 }, { powerLimit: -1 }, { outputSlack: 101 }]) {
    expect(() => parsePlan({ ...valid(), settings: { ...valid().settings, ...field } })).toThrow();
  }
});
