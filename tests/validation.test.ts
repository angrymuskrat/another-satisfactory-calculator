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
it('сохраняет старый план и валидирует границы P1 без молчаливого исправления', () => {
  expect(parsePlan(valid())).toEqual(valid());
  const original = valid();
  const p1 = { ...original, targets: [{ ...original.targets[0], minRate: 5, maxRate: 20 }],
    settings: { ...original.settings, objective: 'buildings', peakPowerLimit: 70, powerReserve: 5, buildingLimits: { constructor: 3 } } };
  expect(parsePlan(p1)).toEqual(p1);
  for (const bounds of [{ minRate: -1 }, { maxRate: -1 }, { minRate: 6, maxRate: 5 }, { maxRate: Infinity }]) {
    expect(() => parsePlan({ ...p1, targets: [{ ...original.targets[0], ...bounds }] })).toThrow();
  }
  for (const fields of [{ peakPowerLimit: -1 }, { powerReserve: -1 }, { buildingLimits: { constructor: 1.5 } }]) {
    expect(() => parsePlan({ ...p1, settings: { ...p1.settings, ...fields } })).toThrow();
  }
});
