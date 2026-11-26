import { usesPareto } from '../domain/searchDuration';
import type { Catalog, Plan, ProductionVariant, ProductionVariants, Result } from '../domain/types';
import { hasSolution } from '../domain/types';
import { parsePlan } from '../domain/validation';
import { emptyResult, solve } from './solve';
import { solvePareto } from './pareto';
import { findWorkingPlans } from './workingPlans';

export type { ProductionVariant, ProductionVariants } from '../domain/types';
export type VariantProgress = (report: ProductionVariants, pending: ProductionVariant['id'][]) => void;
export interface VariantsMessage { report: ProductionVariants; pending: ProductionVariant['id'][]; done: boolean; requestId: string; error?: string }

/** Все решения используют исходные ограничения; бюджет машин и порядок затрат не меняют максимум выпуска. */
export function solveVariants(catalog: Catalog, input: Plan, highs: Parameters<typeof solve>[2], deadline = performance.now() + 25000, onProgress?: VariantProgress, previous?: ProductionVariants): ProductionVariants {
  if (usesPareto(input)) return solvePareto(catalog, input, highs, deadline, onProgress && (report => onProgress(report, [])), previous);
  const maximum = structuredClone(input);
  const economy = structuredClone(input);
  const resources = structuredClone(input);
  const simple = structuredClone(input);
  const variants: ProductionVariant[] = [
    { id: 'maximum', label: input.mode === 'maximize' && !input.batch ? 'Максимальный выпуск' : 'Компактный план', plan: maximum, result: emptyResult('timeout', 'Время расчёта истекло.') },
    { id: 'economy', label: 'Экономия энергии', plan: economy, result: emptyResult('timeout', 'Время расчёта истекло.') },
    { id: 'resources', label: 'Экономия редкого сырья', plan: resources, result: emptyResult('timeout', 'Время расчёта истекло.') },
    { id: 'simple', label: 'Проще построить', plan: simple, result: emptyResult('timeout', 'Время расчёта истекло.') },
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
  delete maximum.settings.recipesFirst;
  economy.settings.objective = 'smooth-power';
  economy.settings.outputSlack = input.mode === 'maximize' && !input.batch ? input.settings.variantOptions?.outputLoss ?? 10 : 0;
  economy.settings.smoothPowerExtraMachines = input.settings.variantOptions?.extraMachines ?? 0;
  delete economy.settings.resourcesFirst;
  delete economy.settings.recipesFirst;
  resources.settings.objective = 'smooth-power';
  resources.settings.outputSlack = economy.settings.outputSlack;
  resources.settings.resourcesFirst = true;
  delete resources.settings.smoothPowerExtraMachines;
  delete resources.settings.recipesFirst;
  simple.settings.objective = 'smooth-power';
  simple.settings.outputSlack = economy.settings.outputSlack;
  simple.settings.recipesFirst = { extraPercent: input.settings.variantOptions?.simplerExtraPercent ?? 10 };
  delete simple.settings.smoothPowerExtraMachines;
  delete simple.settings.resourcesFirst;
  // Варианты решаются по очереди; неиспользованное время предыдущих
  // переходит следующим; ошибка одного варианта не стирает остальные.
  if (previous && (previous.variants.length !== variants.length || variants.some((v, i) => JSON.stringify(v.plan) !== JSON.stringify(previous!.variants[i].plan)))) previous = undefined;
  if (previous) for (const [i, v] of variants.entries()) v.result = previous.variants[i].result;
  const report: ProductionVariants = { variants, equivalent: false, pass: (previous?.pass ?? 0) + 1 };
  if (previous?.workingPlans) report.workingPlans = structuredClone(previous.workingPlans);
  const remaining = variants.filter(v => !previous || !hasSolution(v.result) || v.result.searchProgress);
  const refresh = (pending: string[]) => {
    for (const [i, variant] of variants.entries()) {
      variant.sameAs = variants.slice(0, i).find(other => !other.sameAs && !other.result.searchProgress
        && !variant.result.searchProgress && equivalentResults(other.result, variant.result))?.id;
    }
    report.equivalent = !pending.length && variants.slice(1).every(v => v.sameAs === 'maximum');
    onProgress?.(structuredClone(report), pending);
  };
  if (!report.workingPlans?.length) {
    const now = performance.now();
    findWorkingPlans(catalog, maximum, highs, now + Math.min(4500, (deadline - now) * .18), working => {
      (report.workingPlans ??= []).push(working);
      refresh(remaining.map(v => v.id));
    });
  }
  const start = performance.now(), span = Math.max(0, deadline - start);
  for (const [index, variant] of remaining.entries()) {
    const until = index === remaining.length - 1 ? deadline : start + span * (index + 1) / remaining.length;
    const result = solve(catalog, variant.plan, highs, until, { retainOnTimeout: true });
    const last = variant.result.searchProgress, next = result.searchProgress;
    if (!hasSolution(variant.result) || hasSolution(result) && (!next || !last
      || next.completedTiers > last.completedTiers
      || next.completedTiers === last.completedTiers && (next.currentCost ?? Infinity) < (last.currentCost ?? Infinity))) variant.result = result;
    if (variant.id !== 'maximum') variant.result = enforceVariantOutputLoss(input, variants[0].result, variant.result);
    refresh(remaining.slice(index + 1).map(v => v.id));
  }
  if (!remaining.length) refresh([]);
  return report;
}

export function enforceVariantOutputLoss(input: Plan, maximum: Result, economy: Result): Result {
  if (!input.settings.beltRouting?.enabled || input.mode !== 'maximize' || input.batch || !hasSolution(maximum) || !hasSolution(economy)) return economy;
  const weights = input.targets.map(target => target.weight / target.scale);
  const weightScale = Math.max(...weights), proportionScale = Math.max(...input.targets.map(target => target.rate));
  const scores = (result: Result) => {
    const rates = input.targets.map(target => result.products.find(product => product.itemId === target.itemId)?.rate ?? 0);
    if (input.policy === 'weighted') return [rates.reduce((sum, rate, i) => sum + rate * (weights[i] / weightScale), 0)];
    if (input.policy === 'proportional') return [Math.min(...rates.map((rate, i) => rate * (proportionScale / input.targets[i].rate)))];
    return rates;
  };
  const baseline = scores(maximum), actual = scores(economy), fraction = 1 - (input.settings.variantOptions?.outputLoss ?? 10) / 100;
  // Recheck against the displayed maximum, independently of any weaker baseline
  // found by a variant's bounded topology search. The tolerance follows the
  // scale of solver goal locks and cannot swallow a positive 1e-6/min output.
  if (baseline.some((value, i) => !Number.isFinite(value + actual[i]) || actual[i] < value * fraction - (1e-8 + Math.abs(value) * 1e-8))) {
    return emptyResult('timeout', 'Не удалось подтвердить вариант в пределах допустимой потери выпуска относительно максимального варианта. Найденный выпуск ниже разрешённой границы; повторите расчёт или измените ограничения.');
  }
  return economy;
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
