import { expect, it } from 'vitest';
import { enforceVariantOutputLoss } from '../packages/solver/variants';
import { emptyResult } from '../packages/solver/solve';
import type { Plan, Result } from '../packages/domain/types';

function plan(policy: Plan['policy']): Plan {
  return { schemaVersion: 1, catalogVersion: 'test', name: 'Контроль вариантов', mode: 'maximize', policy,
    targets: [{ itemId: 'a', rate: 1, weight: 2, scale: 1 }, { itemId: 'b', rate: 2, weight: 1, scale: 1 }], sources: [],
    settings: { enabledRecipeIds: [], enabledBuildingIds: [], beltId: 'belt', pipeId: 'pipe', clock: 100, resourcePolicy: 'listed-only', objective: 'smooth-power', powerLimit: null, outputSlack: 0, allowSink: false, resourceWeights: {}, beltRouting: { enabled: true, maxDepth: 2 }, variantOptions: { outputLoss: 10, extraMachines: 1 } } };
}
const result = (a: number, b: number): Result => ({ ...emptyResult('approximate', 'Проверенное решение'), products: [{ itemId: 'a', rate: a }, { itemId: 'b', rate: b }] });

it.each(['proportional', 'priority', 'weighted'] as const)('отклоняет более слабую внутреннюю базу экономии при политике %s', policy => {
  const input = plan(policy), maximum = result(100, 200), weakEconomy = result(80, 160), before = structuredClone(maximum);
  const checked = enforceVariantOutputLoss(input, maximum, weakEconomy);
  expect(checked.status).toBe('timeout'); expect(checked.message).toMatch(/потер/);
  expect(checked.products).toEqual([]); expect(checked.beltRouting).toBeUndefined();
  expect(maximum).toEqual(before); expect(weakEconomy.status).toBe('approximate');
});
it.each(['proportional', 'priority', 'weighted'] as const)('сохраняет допустимую границу потери 10%% при политике %s', policy => {
  const economy = result(90, 180);
  expect(enforceVariantOutputLoss(plan(policy), result(100, 200), economy)).toBe(economy);
});
it('взвешенный выпуск допускает снижение одного продукта при сохранении общей цели', () => {
  const input = plan('weighted'), economy = result(80, 200);
  expect(enforceVariantOutputLoss(input, result(100, 200), economy)).toBe(economy);
  expect(enforceVariantOutputLoss(input, result(100, 200), result(79, 200)).status).toBe('timeout');
  input.targets.forEach(target => { target.weight *= 1000000; });
  expect(enforceVariantOutputLoss(input, result(100, 200), economy)).toBe(economy);
});
it('приоритеты проверяют каждую позицию без компенсации избытком другого продукта', () => {
  expect(enforceVariantOutputLoss(plan('priority'), result(100, 200), result(89, 300)).status).toBe('timeout');
  expect(enforceVariantOutputLoss(plan('priority'), result(100, 200), result(200, 179)).status).toBe('timeout');
});
it('взвешенная цель учитывает масштаб каждого продукта', () => {
  const input = plan('weighted'); input.targets[0].scale = 2;
  const economy = result(60, 210);
  expect(enforceVariantOutputLoss(input, result(100, 200), economy)).toBe(economy);
});
it('потеря рассчитывается по предметам, а не порядку строк результата', () => {
  const economy = result(90, 180); economy.products.reverse();
  expect(enforceVariantOutputLoss(plan('priority'), result(100, 200), economy)).toBe(economy);
});
it.each([false, true])('не применяет сравнение к заданному заказу или партии: batch=%s', batch => {
  const input = plan('weighted');
  if (batch) input.batch = { minutes: 1, items: [{ itemId: 'a', required: 10, stock: 0 }] };
  else input.mode = 'target';
  const economy = result(10, 0);
  expect(enforceVariantOutputLoss(input, result(100, 200), economy)).toBe(economy);
});
it('не стирает исходную ошибку и не использует неуспешный максимум как базу', () => {
  const failed = emptyResult('error', 'Исходная ошибка'), economy = result(90, 180);
  expect(enforceVariantOutputLoss(plan('weighted'), result(100, 200), failed)).toBe(failed);
  expect(enforceVariantOutputLoss(plan('weighted'), failed, economy)).toBe(economy);
});
it('малый положительный выпуск не может исчезнуть в абсолютном допуске', () => {
  expect(enforceVariantOutputLoss(plan('priority'), result(0.000001, 0.000002), result(0, 0)).status).toBe('timeout');
});
it.each([false, undefined])('сохраняет прежний путь расчёта без активного учёта: enabled=%s', enabled => {
  const input = plan('priority');
  if (enabled === undefined) delete input.settings.beltRouting;
  else input.settings.beltRouting!.enabled = enabled;
  const economy = result(80, 160);
  expect(enforceVariantOutputLoss(input, result(100, 200), economy)).toBe(economy);
});
