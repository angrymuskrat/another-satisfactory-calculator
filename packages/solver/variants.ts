import type { Catalog, Plan, ProductionVariant, ProductionVariants, Result } from '../domain/types';
import { hasSolution } from '../domain/types';
import { parsePlan } from '../domain/validation';
import { emptyResult, solve } from './solve';

export type { ProductionVariant, ProductionVariants } from '../domain/types';

/** Все решения используют исходные ограничения; бюджет машин и порядок затрат не меняют максимум выпуска. */
export function solveVariants(catalog: Catalog, input: Plan, highs: Parameters<typeof solve>[2], deadline = performance.now() + 25000): ProductionVariants {
  const maximum = structuredClone(input);
  const economy = structuredClone(input);
  const resources = structuredClone(input);
  const variants: ProductionVariant[] = [
    { id: 'maximum', label: input.mode === 'maximize' && !input.batch ? 'Максимальный выпуск' : 'Компактный план', plan: maximum, result: emptyResult('timeout', 'Время расчёта истекло.') },
    { id: 'economy', label: 'Экономия энергии', plan: economy, result: emptyResult('timeout', 'Время расчёта истекло.') },
    { id: 'resources', label: 'Экономия редкого сырья', plan: resources, result: emptyResult('timeout', 'Время расчёта истекло.') },
  ];
  try { parsePlan(input); }
  catch (error) {
    for (const variant of variants) variant.result = emptyResult('error', error instanceof Error ? error.message : 'Некорректный план.');
    return { variants, equivalent: false };
  }
  maximum.settings.objective = 'smooth-power';
  maximum.settings.outputSlack = 0;
  delete maximum.settings.smoothPowerExtraMachines;
  delete maximum.settings.resourcesFirst;
  economy.settings.objective = 'smooth-power';
  economy.settings.outputSlack = input.mode === 'maximize' && !input.batch ? input.settings.variantOptions?.outputLoss ?? 10 : 0;
  economy.settings.smoothPowerExtraMachines = input.settings.variantOptions?.extraMachines ?? 0;
  delete economy.settings.resourcesFirst;
  resources.settings.objective = 'smooth-power';
  resources.settings.outputSlack = economy.settings.outputSlack;
  resources.settings.resourcesFirst = true;
  delete resources.settings.smoothPowerExtraMachines;
  // Экономия энергии получает больше времени: у неё дополнительная цель и
  // больший выбор числа машин. Неиспользованное время предыдущих решений
  // переходит следующим; ошибка одного варианта не стирает остальные.
  const start = performance.now(), span = Math.max(0, deadline - start);
  variants[0].result = solve(catalog, maximum, highs, start + span * 0.3);
  variants[1].result = solve(catalog, economy, highs, start + span * 0.7);
  variants[2].result = solve(catalog, resources, highs, deadline);
  for (const [index, variant] of variants.entries()) {
    variant.sameAs = variants.slice(0, index).find(other => !other.sameAs && equivalentResults(other.result, variant.result))?.id;
  }
  return { variants, equivalent: variants.slice(1).every(v => v.sameAs === 'maximum') };
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
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-9 + Math.max(Math.abs(a), Math.abs(b)) * 1e-8;
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, i) => close(value, b[i]));
  const left = Object.entries(a); const right = b as Record<string, unknown>;
  return left.length === Object.keys(right).length && left.every(([key, value]) => Object.hasOwn(right, key) && close(value, right[key]));
}
