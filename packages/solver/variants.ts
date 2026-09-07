import type { Catalog, Plan, ProductionVariant, ProductionVariants, Result } from '../domain/types';
import { hasSolution } from '../domain/types';
import { parsePlan } from '../domain/validation';
import { emptyResult, solve } from './solve';

export type { ProductionVariant, ProductionVariants } from '../domain/types';

/** Оба решения используют исходные ограничения; бюджет машин не меняет максимум выпуска. */
export function solveVariants(catalog: Catalog, input: Plan, highs: Parameters<typeof solve>[2], deadline = performance.now() + 25000): ProductionVariants {
  const maximum = structuredClone(input);
  const economy = structuredClone(input);
  const variants: ProductionVariant[] = [
    { id: 'maximum', label: input.mode === 'maximize' && !input.batch ? 'Максимальный выпуск' : 'Компактный план', plan: maximum, result: emptyResult('timeout', 'Время расчёта истекло.') },
    { id: 'economy', label: 'Экономия энергии', plan: economy, result: emptyResult('timeout', 'Время расчёта истекло.') },
  ];
  try { parsePlan(input); }
  catch (error) {
    for (const variant of variants) variant.result = emptyResult('error', error instanceof Error ? error.message : 'Некорректный план.');
    return { variants, equivalent: false };
  }
  maximum.settings.objective = 'smooth-power';
  maximum.settings.outputSlack = 0;
  delete maximum.settings.smoothPowerExtraMachines;
  economy.settings.objective = 'smooth-power';
  economy.settings.outputSlack = input.mode === 'maximize' && !input.batch ? input.settings.variantOptions?.outputLoss ?? 10 : 0;
  economy.settings.smoothPowerExtraMachines = input.settings.variantOptions?.extraMachines ?? 0;
  // Оставляем экономичному варианту больше половины общего времени: у него
  // дополнительная цель и больший выбор числа машин. Неиспользованное время
  // первого решения доступно второму; его ошибка не стирает первый результат.
  const start = performance.now();
  variants[0].result = solve(catalog, maximum, highs, start + Math.max(0, deadline - start) * 0.45);
  variants[1].result = solve(catalog, economy, highs, deadline);
  return { variants, equivalent: equivalentResults(variants[0].result, variants[1].result) };
}

function equivalentResults(a: Result, b: Result): boolean {
  if (!hasSolution(a) || !hasSolution(b)) return false;
  // Сравниваем реальные конфигурации, потоки и мощности, а не только сумму МВт.
  const actual = (result: Result) => ({
    products: result.products, steps: result.steps, resources: result.resources,
    surplus: result.surplus, exports: result.exports ?? [], somersloops: result.somersloops ?? 0,
    power: result.power, installedPower: result.installedPower, sinkPower: result.sinkPower,
  });
  return close(actual(a), actual(b));
}

function close(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-6 + Math.max(Math.abs(a), Math.abs(b)) * 1e-8;
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, i) => close(value, b[i]));
  const left = Object.entries(a); const right = b as Record<string, unknown>;
  return left.length === Object.keys(right).length && left.every(([key, value]) => Object.hasOwn(right, key) && close(value, right[key]));
}
