import type loadHighs from 'highs';
import type { Catalog, Plan, Result } from '../domain/types';
import { parsePlan } from '../domain/validation';
import { buildModel } from './build';
import { dot, type Expression } from './model';
import { validateResult } from './validate';
type Highs = Awaited<ReturnType<typeof loadHighs>>;
const tolerance = (value: number) => 1e-8 + Math.abs(value) * 1e-9;
const clean = (value: number) => Math.max(0, value);
const physicalCount = (equivalent: number) => Math.max(1, Math.ceil(equivalent - 1e-7));
export function emptyResult(status: Result['status'], message: string): Result {
  return { status, message, products: [], steps: [], resources: [], surplus: [], power: 0, productionPower: 0, extractionPower: 0, sinkPower: 0, installedPower: 0, objectiveValue: 0, warnings: [], diagnostics: [], maxBalanceError: 0 };
}
export function solve(catalog: Catalog, input: Plan, highs: Highs, deadline = performance.now() + 20000): Result {
  try {
    const plan = parsePlan(input);
    const built = buildModel(catalog, plan);
    const { model } = built;
    let values: Record<string, number> = {};
    function optimize(objective: Expression, maximize = false): number {
      const remaining = (deadline - performance.now()) / 1000;
      if (remaining <= 0) throw new SolveFailure('timeout');
      const solution = highs.solve(model.serialize(objective, maximize), {
        time_limit: remaining, output_flag: false, log_to_console: false,
        primal_feasibility_tolerance: 1e-8, dual_feasibility_tolerance: 1e-8,
        mip_rel_gap: 1e-9, mip_abs_gap: 1e-8,
        mip_feasibility_tolerance: 1e-9,
      });
      if (solution.Status !== 'Optimal') {
        if (solution.Status === 'Primal infeasible or unbounded') {
          const checked = highs.solve(model.serialize(objective, maximize), { presolve: 'off', time_limit: Math.max(0.01, (deadline - performance.now()) / 1000), output_flag: false, primal_feasibility_tolerance: 1e-8, mip_feasibility_tolerance: 1e-9 });
          if (checked.Status !== 'Optimal') throw new SolveFailure(statusOf(checked.Status));
          values = Object.fromEntries(Object.entries(checked.Columns).map(([name, c]) => [name, c.Primal]));
        } else throw new SolveFailure(statusOf(solution.Status));
      } else values = Object.fromEntries(Object.entries(solution.Columns).map(([name, c]) => [name, c.Primal]));
      return dot(objective, values);
    }
    const locksStart = model.constraints.length;
    const outputGoals: { expression: Expression; optimum: number }[] = [];
    let objectiveValue = 0;
    if (plan.mode === 'maximize') {
      const goals = plan.policy === 'proportional'
        ? [new Map([[built.ratio!, 1]])]
        : plan.policy === 'priority' ? built.targets.map(t => new Map([[t.variable, 1]]))
          : [normalize(new Map(built.targets.map(t => [t.variable, t.target.weight / t.target.scale])))];
      for (const expression of goals) {
        const optimum = optimize(expression, true);
        if (!outputGoals.length) objectiveValue = optimum;
        outputGoals.push({ expression, optimum });
        model.constrain(expression, '>=', Math.max(0, optimum - tolerance(optimum)));
      }
      // Relax only after computing the original lexicographic output optimum.
      model.constraints.length = locksStart;
      for (const { expression, optimum } of outputGoals) {
        model.constrain(expression, '>=', Math.max(0, optimum * (1 - plan.settings.outputSlack / 100) - tolerance(optimum)));
      }
    }
    for (const expression of plan.settings.objective === 'power' ? [built.power, normalize(built.resources)] : [normalize(built.resources), built.power]) {
      const optimum = optimize(expression);
      model.constrain(expression, '<=', optimum + tolerance(optimum));
    }
    optimize(built.activity);
    // Remove numerical trace recipes by resolving with them fixed to zero, never by
    // deleting their flows from the result. Scale pruning to the smallest output.
    const positiveOutputs = built.targets.map(t => values[t.variable] ?? 0).filter(v => v > 0);
    const traceThreshold = Math.min(1e-6, positiveOutputs.length ? Math.min(...positiveOutputs) * 1e-6 : 1e-6);
    const traces = built.recipeVariables.filter(r => {
      const cycles = values[r.variable] ?? 0;
      return cycles > 0 && Math.max(cycles * r.powerPerCycle, ...[...r.recipe.inputs, ...r.recipe.outputs].map(i => cycles * i.amount)) < traceThreshold;
    });
    if (traces.length && performance.now() < deadline - 100) {
      const previous = values; const constraintCount = model.constraints.length;
      for (const trace of traces) model.constrain(new Map([[trace.variable, 1]]), '=', 0);
      try { optimize(built.activity); } catch { values = previous; }
      model.constraints.length = constraintCount;
    }
    const result = emptyResult('optimal', 'Оптимальная схема найдена в модели заданных частот.');
    result.objectiveValue = objectiveValue;
    result.products = built.targets.map(t => ({ itemId: t.target.itemId, rate: clean(values[t.variable] ?? 0) }));
    result.steps = built.recipeVariables.filter(r => (values[r.variable] ?? 0) > 1e-12).map(r => {
      const cycles = values[r.variable]; const machines = cycles / r.capacity;
      return { recipeId: r.recipe.id, cycles, machines, installedMachines: physicalCount(machines),
        power: cycles * r.powerPerCycle, powerMax: physicalCount(machines) * r.powerMax,
        inputs: r.recipe.inputs.map(i => ({ itemId: i.itemId, rate: cycles * i.amount })),
        outputs: r.recipe.outputs.map(i => ({ itemId: i.itemId, rate: cycles * i.amount })),
      };
    });
    result.resources = built.sourceVariables.map(s => ({ sourceId: s.source.id, itemId: s.source.itemId, rate: clean(values[s.variable] ?? 0), limit: s.limit, power: clean((values[s.variable] ?? 0) * s.powerPerUnit) }));
    result.surplus = built.disposal.filter(d => (values[d.variable] ?? 0) > 1e-12).map(d => ({ itemId: d.itemId, rate: values[d.variable] }));
    result.productionPower = result.steps.reduce((s, r) => s + r.power, 0);
    result.extractionPower = result.resources.reduce((s, r) => s + r.power, 0);
    result.sinkPower = built.sinkCount ? clean((values[built.sinkCount] ?? 0) * built.sinkPower) : 0;
    result.power = result.productionPower + result.extractionPower + result.sinkPower;
    result.installedPower = result.steps.reduce((s, r) => s + r.powerMax, 0) + result.sinkPower
      + built.sourceVariables.filter(s => (values[s.variable] ?? 0) > 1e-12).reduce((sum, s) => sum + s.installedPower, 0);
    result.warnings.push('Средняя мощность рассчитана по доле времени работы на заданной частоте. Простой и пусковые процессы не учитываются; установленная мощность показана отдельно.');
    if (built.sourceVariables.some(s => s.source.kind === 'flow' && (values[s.variable] ?? 0) > 1e-7)) result.warnings.push('Энергия получения внешних потоков не включена в расчёт. Для учёта добычи укажите месторождения.');
    if (built.recipeVariables.some(r => (values[r.variable] ?? 0) > 1e-7 && (r.recipe.powerEstimated || catalog.buildings.find(b => b.id === r.recipe.buildingId)?.powerEstimated))) result.warnings.push('Для некоторых зданий мощность оценочная: см. отчёт каталога. Оптимум относится к этим коэффициентам.');
    if (!catalog.provenance.verified) result.warnings.push('Каталог содержит непроверенные данные. Подробности — в сведениях об источнике.');
    if (plan.settings.allowSink && !plan.settings.enabledBuildingIds.includes('awesome-sink')) result.warnings.push('Утилизация включена, но Умный утилизатор недоступен в технологиях.');
    if (plan.policy === 'weighted' && plan.mode === 'maximize') result.warnings.push('Взвешенный выпуск может выделить все ресурсы одному продукту; минимум для каждого продукта не задан.');
    if (result.products.every(p => p.rate < 1e-7)) result.diagnostics.push('Доступные источники и рецепты не обеспечивают положительный выпуск выбранных продуктов.');
    for (const r of result.resources) if (r.limit !== null && r.limit > 0 && r.limit - r.rate < 1e-5) result.diagnostics.push(`Исчерпан источник: ${catalog.items.find(i => i.id === r.itemId)?.name ?? r.itemId} (${r.sourceId}).`);
    if (plan.settings.powerLimit !== null && Math.abs(result.power - plan.settings.powerLimit) < 1e-5) result.diagnostics.push('Достигнут лимит средней мощности.');
    const validation = validateResult(catalog, plan, result);
    result.maxBalanceError = validation.maxBalanceError;
    if (validation.errors.length) return { ...emptyResult('error', 'Результат не прошёл проверку баланса или ограничений.'), diagnostics: validation.errors };
    return result;
  } catch (error) {
    if (error instanceof SolveFailure) {
      const result = emptyResult(error.status, {
        infeasible: 'Заказ невыполним при текущих ресурсах, рецептах, технологиях и лимите мощности.',
        unbounded: 'Выпуск не ограничен. Задайте конечные источники или лимит мощности.',
        timeout: 'Время расчёта истекло. Уменьшите число целей или доступных альтернатив.',
        error: 'Решатель не смог подтвердить результат.', optimal: '',
      }[error.status]);
      if (error.status === 'infeasible') {
        result.diagnostics.push('Проверьте необходимые ресурсы, выключенные здания и рецепты, побочные продукты и возможность утилизации. Ограничения не были изменены.');
        if (input.mode === 'target' && performance.now() < deadline) {
          const alternative = solve(catalog, { ...input, mode: 'maximize', policy: 'proportional', settings: { ...input.settings, outputSlack: 0 } }, highs, deadline);
          if (alternative.status === 'optimal') {
            const fraction = Math.min(...input.targets.map(t => (alternative.products.find(p => p.itemId === t.itemId)?.rate ?? 0) / t.rate));
            result.feasibleAlternative = { products: alternative.products, fraction, power: alternative.power, bottlenecks: alternative.diagnostics };
          } else result.diagnostics.push('Дополнительная оценка достижимого выпуска не завершена.');
        }
      }
      return result;
    }
    return emptyResult('error', error instanceof Error ? error.message : 'Неизвестная ошибка расчёта.');
  }
}
class SolveFailure extends Error { constructor(public status: Result['status']) { super(status); } }
function statusOf(status: string): Result['status'] {
  if (status.toLowerCase().includes('unbounded')) return 'unbounded';
  if (status.toLowerCase().includes('infeasible')) return 'infeasible';
  if (status.toLowerCase().includes('time') || status.toLowerCase().includes('limit')) return 'timeout';
  return 'error';
}
function normalize(expression: Expression): Expression {
  const nonzero = [...expression.values()].filter(v => v !== 0).map(Math.abs);
  if (!nonzero.length) return expression;
  const scale = Math.max(...nonzero);
  if (Math.min(...nonzero) / scale < 1e-8) throw new Error('Веса или энергетические коэффициенты отличаются более чем в 100 миллионов раз. Уменьшите диапазон.');
  return new Map([...expression].map(([variable, coefficient]) => [variable, coefficient / scale]));
}
