import { beforeAll, expect, it } from 'vitest';
import catalogJson from '../packages/game-data/catalog.json';
import type { Catalog } from '../packages/domain/types';
import { createDefaultPlan } from '../packages/domain/defaults';
import { buildConstruction } from '../packages/domain/construction';
import { createHighs } from '../packages/solver/highs';
import { solve } from '../packages/solver/solve';
import { validateResult } from '../packages/solver/validate';

const catalog = catalogJson as Catalog;
let highs: Awaited<ReturnType<typeof createHighs>>;
beforeAll(async () => { highs = await createHighs(); });

it.each(['reinforced-iron-plate', 'motor', 'plastic', 'rubber', 'aluminum-ingot', 'battery', 'computer'])('инструкция %s совпадает с потоками и MW решателя', itemId => {
  const plan = createDefaultPlan(catalog); plan.mode = 'target';
  plan.targets = [{ itemId, rate: 1, weight: 1, scale: 1 }]; plan.sources = [];
  plan.settings.resourcePolicy = 'unlimited-unlisted'; plan.settings.allowSink = true;
  const result = solve(catalog, plan, highs);
  expect(result.status, result.message + result.diagnostics.join(';')).toBe('optimal');
  const construction = buildConstruction(catalog, plan, result);
  expect(construction.averagePower).toBeCloseTo(result.power, 5);
  expect(construction.peakPower).toBeCloseTo(result.installedPower, 5);
  expect(construction.materials.complete).toBe(true);
  for (const group of construction.production) {
    const step = result.steps.find(s => s.recipeId === group.recipeId)!;
    expect(group.averageInputs).toEqual(step.inputs);
    expect(group.averageOutputs).toEqual(step.outputs);
    expect(group.activeDuty).toBeLessThanOrEqual(1 + 1e-6);
  }
  expect(validateResult(catalog, plan, result).errors).toEqual([]);
});

it('контрольный заказ 7,5 пластин: 69,75 МВт в среднем, пик 89 МВт, заданные частоты', () => {
  const plan = createDefaultPlan(catalog); plan.mode = 'target'; plan.targets[0].rate = 7.5;
  const result = solve(catalog, plan, highs);
  expect(result.status).toBe('optimal'); expect(result.power).toBeCloseTo(69.75, 4);
  expect(result.installedPower).toBeCloseTo(89, 4);
  const construction = buildConstruction(catalog, plan, result);
  expect(construction.production.every(g => g.clock === 100)).toBe(true);
  const assemblers = construction.production.find(g => g.buildingId === 'assembler')!;
  expect(assemblers.count).toBe(2); expect(assemblers.activeDuty).toBeCloseTo(.75, 5);
  expect(assemblers.averagePower).toBeCloseTo(22.5, 4);
  plan.settings.peakPowerLimit = 70;
  expect(solve(catalog, plan, highs).status).toBe('infeasible');
});

it('10 алюминиевых слитков с минимумом зданий не получают ложную невыполнимость', () => {
  const plan = createDefaultPlan(catalog); plan.mode = 'target';
  plan.targets = [{ itemId: 'aluminum-ingot', rate: 10, weight: 1, scale: 1 }]; plan.sources = [];
  plan.settings.objective = 'buildings'; plan.settings.resourcePolicy = 'unlimited-unlisted'; plan.settings.allowSink = true;
  const result = solve(catalog, plan, highs);
  expect(result.status, result.message).toBe('optimal');
  expect(validateResult(catalog, plan, result).errors).toEqual([]);
});

it.each(['plastic', 'reinforced-iron-plate'])('не объявляет оптимумом неподдерживаемый масштаб выпуска %s', itemId => {
  const plan = createDefaultPlan(catalog); plan.mode = 'target'; plan.sources = [];
  plan.targets = [{ itemId, rate: 1e-9, minRate: 1e-9, maxRate: 1e-9, weight: 1, scale: 1 }];
  plan.settings.resourcePolicy = 'unlimited-unlisted'; plan.settings.allowSink = true;
  const result = solve(catalog, plan, highs);
  expect(result.status).toBe('error'); expect(result.message).toContain('0,000001');
});

it('поддерживаемый малый выпуск пластика учитывает целый Sink до фиксации энергии', () => {
  const plan = createDefaultPlan(catalog); plan.mode = 'target'; plan.sources = [];
  plan.targets = [{ itemId: 'plastic', rate: 1e-6, minRate: 1e-6, weight: 1, scale: 1 }];
  plan.settings.beltId = catalog.belts.at(-1)!.id;
  plan.settings.resourcePolicy = 'unlimited-unlisted'; plan.settings.allowSink = true;
  const result = solve(catalog, plan, highs);
  expect(result.status, result.message).toBe('optimal');
  expect(result.sinkPower).toBe(30); expect(result.power).toBeGreaterThan(30);
  expect(result.products[0].rate).toBeCloseTo(1e-6, 12);
});

it('независимый validator не поглощает полностью положительный минимум', () => {
  const plan = createDefaultPlan(catalog); plan.mode = 'target'; plan.targets[0].rate = 1e-9; plan.targets[0].minRate = 1e-9;
  const result = solve(catalog, createDefaultPlan(catalog), highs);
  result.products[0].rate = 0;
  expect(validateResult(catalog, plan, result).errors).toContain('Не выполнен минимум продукта.');
});
