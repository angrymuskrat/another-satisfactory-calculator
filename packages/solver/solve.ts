import type loadHighs from 'highs';
import type { Catalog, Plan, Result } from '../domain/types';
import { parsePlan } from '../domain/validation';
import { effectivePlan } from '../domain/availability';
import { buildModel } from './build';
import { dot, type Expression } from './model';
import { validateResult } from './validate';
import { applyBatch } from '../domain/batch';
import { balancedClock } from '../domain/production';
import { hasSolution } from '../domain/types';
type Highs = Awaited<ReturnType<typeof loadHighs>>;
const tolerance = (value: number) => 1e-8 + Math.abs(value) * 1e-9;
const clean = (value: number) => Math.max(0, value);
const physicalCount = (equivalent: number) => Math.max(1, Math.ceil(equivalent - 1e-7));
export function emptyResult(status: Result['status'], message: string): Result {
  return { status, message, products: [], steps: [], resources: [], surplus: [], power: 0, productionPower: 0, extractionPower: 0, sinkPower: 0, installedPower: 0, objectiveValue: 0, warnings: [], diagnostics: [], maxBalanceError: 0 };
}
export function solve(catalog: Catalog, input: Plan, highs: Highs, deadline = performance.now() + 20000): Result {
  let requested = input;
  let approximatePower = false;
  try {
    const plan = effectivePlan(catalog, applyBatch(parsePlan(input)));
    requested = plan;
    if (plan.mode === 'maximize' && plan.targets.some(t => t.rate <= 0)) return emptyResult('error', 'Пропорция должна быть положительной.');
    if (plan.targets.some(t => (plan.mode === 'target' && t.rate > 0 && t.rate < 1e-6)
      || ((t.minRate ?? 0) > 0 && t.minRate! < 1e-6) || (t.maxRate != null && t.maxRate > 0 && t.maxRate < 1e-6))) {
      return emptyResult('error', 'Положительные границы и заданный выпуск должны быть не меньше 0,000001 в минуту. Увеличьте масштаб расчёта; ноль остаётся отдельным запретом.');
    }
    const built = buildModel(catalog, plan);
    approximatePower = built.recipeVariables.some(r => r.autoClock);
    const { model } = built;
    let values: Record<string, number> = {};
    let confirmed = false;
    const integerFlows = new Map<string, string[]>();
    for (const r of built.recipeVariables) if (r.countVariable) integerFlows.set(r.countVariable, [r.variable]);
    for (const s of built.sourceVariables) if (s.countVariable) integerFlows.set(s.countVariable, [s.variable]);
    if (built.sinkCount) integerFlows.set(built.sinkCount, built.disposal.map(d => d.variable));
    function optimizeRaw(objective: Expression, maximize = false): number {
      const remaining = (deadline - performance.now()) / 1000;
      if (remaining <= 0) throw new SolveFailure('timeout');
      const solution = highs.solve(model.serialize(objective, maximize), {
        time_limit: remaining, output_flag: false, log_to_console: false,
        primal_feasibility_tolerance: 1e-8, dual_feasibility_tolerance: 1e-8,
        mip_rel_gap: 1e-9, mip_abs_gap: 1e-8,
        mip_feasibility_tolerance: 1e-10,
      });
      if (solution.Status !== 'Optimal') {
        if (solution.Status.toLowerCase().includes('infeasible')) {
          const checked = highs.solve(model.serialize(objective, maximize), { presolve: 'off', time_limit: Math.max(0.01, (deadline - performance.now()) / 1000), output_flag: false, primal_feasibility_tolerance: 1e-8, dual_feasibility_tolerance: 1e-8, mip_feasibility_tolerance: 1e-10, mip_rel_gap: 1e-9, mip_abs_gap: 1e-8 });
          if (checked.Status !== 'Optimal') throw new SolveFailure(statusOf(checked.Status));
          values = Object.fromEntries(Object.entries(checked.Columns).map(([name, c]) => [name, c.Primal]));
        } else throw new SolveFailure(statusOf(solution.Status));
      } else values = Object.fromEntries(Object.entries(solution.Columns).map(([name, c]) => [name, c.Primal]));
      return dot(objective, values);
    }
    function optimize(objective: Expression, maximize = false): number {
      let optimum: number;
      try { optimum = optimizeRaw(objective, maximize); }
      catch (error) {
        if (confirmed && error instanceof SolveFailure && error.status === 'infeasible') throw new SolveFailure('error', 'Численный сбой уточнения уже найденного решения. Невыполнимость исходного заказа не доказана.');
        throw error;
      }
      if (integerFlows.size) {
        const constraints = model.constraints.length;
        const bounds = new Map([...model.variables].map(([id, v]) => [id, v.upper]));
        try {
          for (const [variable, flows] of integerFlows) {
            const count = Math.round(values[variable] ?? 0);
            model.constrain(new Map([[variable, 1]]), '=', count);
            if (count === 0) {
              model.variables.get(variable)!.upper = 0;
              for (const flow of flows) model.variables.get(flow)!.upper = 0;
            }
          }
          const physicalOptimum = optimizeRaw(objective, maximize);
          if ((maximize ? optimum - physicalOptimum : physicalOptimum - optimum) > 10 * tolerance(optimum)) {
            throw new SolveFailure('error', 'Не удалось подтвердить цель с физически целыми машинами. Увеличьте масштаб потоков и повторите расчёт.');
          }
          optimum = physicalOptimum;
        } catch (error) {
          if (error instanceof SolveFailure && error.status === 'infeasible') throw new SolveFailure('error', 'Численный допуск не позволил подтвердить физические количества машин. Увеличьте масштаб потоков; невыполнимость заказа не доказана.');
          throw error;
        } finally {
          model.constraints.length = constraints;
          for (const [id, upper] of bounds) model.variables.get(id)!.upper = upper;
        }
      }
      confirmed = true;
      return optimum;
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
    let machineBudget: Result['machineBudget'];
    if (plan.settings.objective === 'smooth-power' && plan.settings.smoothPowerExtraMachines !== undefined) {
      const minimum = Math.round(optimize(built.machineCount));
      const limit = minimum + plan.settings.smoothPowerExtraMachines;
      model.constrain(built.machineCount, '<=', limit);
      machineBudget = { minimum, limit, used: 0 };
    }
    const costGoals = machineBudget ? [built.power, normalize(built.resources), built.machineCount]
      : plan.settings.objective === 'buildings' || plan.settings.objective === 'smooth-power' ? [built.machineCount, built.power, normalize(built.resources)]
      : plan.settings.objective === 'power' ? [built.power, normalize(built.resources)] : [normalize(built.resources), built.power];
    const costLocks: { index: number; expression: Expression; optimum: number }[] = [];
    for (const expression of costGoals) {
      const optimum = optimize(expression);
      costLocks.push({ index: model.constraints.length, expression, optimum });
      model.constrain(expression, '<=', optimum + tolerance(optimum));
    }
    if (built.needsCounts && plan.settings.objective !== 'buildings' && plan.settings.objective !== 'smooth-power') {
      const optimum = optimize(built.machineCount);
      model.constrain(built.machineCount, '<=', Math.round(optimum));
    }
    {
      // Discrete tie-breaking needs room for propagated LP round-off. This changes
      // only objective locks, never source/target/grid/building constraints.
      for (const lock of costLocks) if (lock.expression !== built.machineCount) model.constraints[lock.index].rhs = lock.optimum + 10 * tolerance(lock.optimum);
      // Positive energy coefficients and the already locked energy budget provide
      // a proven upper bound; no arbitrary big-M restricts the solution space.
      const powerLock = costLocks.find(lock => lock.expression === built.power)!;
      const budget = model.constraints[powerLock.index].rhs; const recipeCount: Expression = new Map();
      const selections: { used: string; flow: string }[] = [];
      const recipeSelections = new Map<string, string>();
      for (const r of built.recipeVariables) {
        if (r.minimumPowerPerCycle <= 0) continue;
        const used = recipeSelections.get(r.recipe.id) ?? model.variable(1, true);
        recipeSelections.set(r.recipe.id, used);
        const upper = (budget + tolerance(budget)) / r.minimumPowerPerCycle;
        model.constrain(new Map([[r.variable, 1], [used, -upper]]), '<=', 0);
        recipeCount.set(used, 1);
        selections.push({ used, flow: r.variable });
        integerFlows.set(used, [...(integerFlows.get(used) ?? []), r.variable]);
      }
      optimize(recipeCount);
      for (const { used, flow } of selections) {
        const selected = Math.round(values[used] ?? 0);
        model.constrain(new Map([[used, 1]]), '=', selected);
        if (selected === 0) {
          model.variables.get(used)!.upper = 0;
          model.variables.get(flow)!.upper = 0;
        }
      }
    }
    optimize(built.activity);
    // A MIP feasibility tolerance may admit tiny positive integer counts. Pin the
    // selected physical configuration and solve again; never erase its flows.
    const fixCount = (variable: string, flows: string[]) => {
      const count = Math.round(values[variable] ?? 0);
      model.constrain(new Map([[variable, 1]]), '=', count);
      if (count === 0) {
        model.variables.get(variable)!.upper = 0;
        for (const flow of flows) model.variables.get(flow)!.upper = 0;
      }
    };
    if (built.sinkCount || built.needsCounts) {
      if (built.sinkCount) fixCount(built.sinkCount, built.disposal.map(d => d.variable));
      for (const r of built.recipeVariables) if (r.countVariable) fixCount(r.countVariable, [r.variable]);
      for (const s of built.sourceVariables) if (s.countVariable) fixCount(s.countVariable, [s.variable]);
      optimize(built.activity);
    }
    // Resolve trace recipes repeatedly: removing one can expose a different
    // degenerate trace in the next solution. Bounds are retained only on success.
    const positiveOutputs = built.targets.map(t => values[t.variable] ?? 0).filter(v => v > 0);
    const traceThreshold = Math.min(1e-6, positiveOutputs.length ? Math.min(...positiveOutputs) * 1e-6 : 1e-6);
    for (let pass = 0; pass < built.recipeVariables.length && performance.now() < deadline - 100; pass++) {
      const traces = built.recipeVariables.filter(r => {
        const cycles = values[r.variable] ?? 0;
        return cycles > 0 && model.variables.get(r.variable)!.upper !== 0
          && Math.max(cycles * r.powerPerCycle, ...[...r.recipe.inputs, ...r.recipe.outputs].map(i => cycles * i.amount)) < traceThreshold;
      });
      if (!traces.length) break;
      const previous = values;
      const previousBounds = traces.map(trace => model.variables.get(trace.variable)!.upper);
      for (const trace of traces) model.variables.get(trace.variable)!.upper = 0;
      try { optimize(built.activity); } catch {
        values = previous;
        traces.forEach((trace, i) => { model.variables.get(trace.variable)!.upper = previousBounds[i]; });
        break;
      }
    }
    const result = emptyResult('optimal', 'Оптимальная схема найдена в модели заданных частот.');
    if (approximatePower) {
      result.status = 'approximate';
      result.message = 'Подобраны число машин и рабочие частоты. Допустимый план с приближённой оптимизацией энергии; точные мощности проверены.';
    }
    result.objectiveValue = objectiveValue;
    if (machineBudget) result.machineBudget = { ...machineBudget, used: Math.round(dot(built.machineCount, values)) };
    result.products = built.targets.map(t => ({ itemId: t.target.itemId, rate: clean(values[t.variable] ?? 0) }));
    result.steps = built.recipeVariables.filter(r => r.configuration.existing || (values[r.variable] ?? 0) > 1e-12).map(r => {
      const cycles = values[r.variable];
      const installedMachines = r.autoClock ? Math.round(values[r.countVariable!] ?? 0) : r.configuration.existing || physicalCount(cycles / r.capacity);
      const clock = r.autoClock ? balancedClock(r.configuration, cycles, installedMachines) : r.configuration.clock;
      const clockRatio = clock / r.configuration.clock;
      const capacity = Math.min(r.capacity, r.cyclesAtClock * clockRatio);
      const machines = cycles / capacity;
      const machinePower = r.power * clockRatio ** Math.log2(2.5);
      const machineMax = r.powerMax * clockRatio ** Math.log2(2.5);
      return { recipeId: r.recipe.id, ...(r.configuration.id !== r.recipe.id ? { configurationId: r.configuration.id } : {}), cycles, machines, installedMachines,
        ...(r.autoClock ? { clock } : {}),
        power: cycles / (r.cyclesAtClock * clockRatio) * machinePower, powerMax: installedMachines * machineMax,
        inputs: r.recipe.inputs.map(i => ({ itemId: i.itemId, rate: cycles * i.amount })),
        outputs: r.recipe.outputs.map(i => ({ itemId: i.itemId, rate: cycles * i.amount })),
      };
    });
    result.resources = built.sourceVariables.map(s => ({ sourceId: s.source.id, itemId: s.source.itemId, rate: clean(values[s.variable] ?? 0), limit: s.limit,
      installedMachines: s.source.kind === 'well' ? Math.round(values[s.countVariable!] ?? 0) : s.source.kind === 'node' && (values[s.variable] ?? 0) > 1e-12 ? physicalCount(values[s.variable] / s.capacity) : 0,
      power: s.source.kind === 'well' ? Math.round(values[s.countVariable!] ?? 0) * s.installedPower : clean((values[s.variable] ?? 0) * s.powerPerUnit) }));
    result.exports = built.exports.filter(e => (values[e.variable] ?? 0) > 1e-12).map(e => ({ itemId: e.itemId, rate: values[e.variable] }));
    result.somersloops = Math.round(dot(built.loops, values));
    result.surplus = built.disposal.filter(d => (values[d.variable] ?? 0) > 1e-12).map(d => ({ itemId: d.itemId, rate: values[d.variable] }));
    result.productionPower = result.steps.reduce((s, r) => s + r.power, 0);
    result.extractionPower = result.resources.reduce((s, r) => s + r.power, 0);
    result.sinkPower = built.sinkCount ? Math.round(values[built.sinkCount] ?? 0) * built.sinkPower : 0;
    result.power = result.productionPower + result.extractionPower + result.sinkPower;
    result.installedPower = result.steps.reduce((s, r) => s + r.powerMax, 0) + result.sinkPower
      + built.sourceVariables.reduce((sum, s) => sum + (s.source.kind === 'well' ? Math.round(values[s.countVariable!] ?? 0) * s.installedPower : s.source.kind === 'flow' ? (values[s.variable] ?? 0) * s.powerPerUnit : (values[s.variable] ?? 0) > 1e-12 ? physicalCount(values[s.variable] / s.capacity) * s.installedPower : 0), 0);
    result.warnings.push('Средняя мощность рассчитана по доле времени работы на заданной частоте. Простой и пусковые процессы не учитываются; установленная мощность показана отдельно.');
    if (plan.settings.objective === 'smooth-power') result.warnings.push(`${machineBudget ? `После выпуска найден минимум ${machineBudget.minimum} физических машин; энергия минимизируется в бюджете до ${machineBudget.limit} машин.` : 'После выпуска минимизируется число машин, затем энергия.'} Частоты подбираются от 1% до заданного предела. Одинаковые машины группы получают равномерную нагрузку. Закреплённые линии сохраняются; ниже минимальной частоты возможны простои. Фазы циклов и фактический график сети не моделируются.`);
    if (approximatePower) result.warnings.push('Решатель использует консервативную кусочно-линейную оценку мощности. Показанные МВт пересчитаны по нелинейной формуле и проверены с исходными лимитами. Глобальный оптимум точной нелинейной модели не доказан.');
    if (built.sourceVariables.some(s => s.source.kind === 'flow' && s.source.importPower == null && (values[s.variable] ?? 0) > 1e-7)) result.warnings.push('Энергия получения внешних потоков с неизвестной стоимостью не включена в расчёт. Для учёта добычи укажите месторождения или стоимость импорта.');
    if (result.somersloops) result.warnings.push('Усиление рассчитано по среднему выходу за несколько циклов. Конечный бюджет занят физическими машинами, включая простаивающие закреплённые линии.');
    if (result.exports.length) result.warnings.push('Отгрузки требуют постоянного потребления в другой фабрике. Они не создают там источник автоматически.');
    if (built.recipeVariables.some(r => (values[r.variable] ?? 0) > 1e-7 && (r.recipe.powerEstimated || catalog.buildings.find(b => b.id === r.recipe.buildingId)?.powerEstimated))) result.warnings.push('Для некоторых зданий мощность оценочная: см. отчёт каталога. Оптимум относится к этим коэффициентам.');
    if (!catalog.provenance.verified) result.warnings.push('Полная сверка каталога не подтверждена. Статус рецептов, мощности, локализации и группировки указан отдельно в сведениях о данных.');
    if (plan.settings.allowSink && !plan.settings.enabledBuildingIds.includes('awesome-sink')) result.warnings.push('Утилизация включена, но Умный утилизатор недоступен в технологиях.');
    if (plan.policy === 'weighted' && plan.mode === 'maximize') result.warnings.push('После выполнения заданных минимумов взвешенный выпуск может выделить оставшиеся ресурсы одному продукту.');
    if (plan.batch && plan.targets.every(t => t.rate === 0)) result.message = 'Партия уже есть на складе. Новая выработка не требуется.';
    else if (result.products.every(p => p.rate < 1e-7)) result.diagnostics.push('Доступные источники и рецепты не обеспечивают положительный выпуск выбранных продуктов.');
    for (const r of result.resources) if (r.limit !== null && r.limit > 0 && r.limit - r.rate < 1e-5) result.diagnostics.push(`Исчерпан источник: ${catalog.items.find(i => i.id === r.itemId)?.name ?? r.itemId} (${plan.sources.find(s => s.id === r.sourceId)?.name || r.sourceId}). Это не доказывает пользу расширения — проверьте повторным расчётом.`);
    if (plan.settings.powerLimit !== null && Math.abs(result.power - plan.settings.powerLimit) < 1e-5) result.diagnostics.push('Достигнут лимит средней мощности.');
    const validation = validateResult(catalog, plan, result);
    result.maxBalanceError = validation.maxBalanceError;
    if (validation.errors.length) return { ...emptyResult('error', 'Результат не прошёл проверку баланса или ограничений.'), diagnostics: validation.errors };
    return result;
  } catch (error) {
    if (error instanceof SolveFailure) {
      if (approximatePower && error.status === 'infeasible') return emptyResult('error', 'В консервативной модели автоподбора частот допустимый план не найден. Невыполнимость точной нелинейной модели не доказана; проверьте ресурсы и лимиты мощности.');
      const result = emptyResult(error.status, {
        infeasible: 'Заказ невыполним при текущих ресурсах, рецептах, технологиях и лимите мощности.',
        unbounded: 'Выпуск не ограничен. Задайте конечные источники или лимит мощности.',
        timeout: 'Время расчёта истекло. Уменьшите число целей или доступных альтернатив.',
        error: 'Решатель не смог подтвердить результат.', optimal: '', approximate: '',
      }[error.status]);
      if (error.detail) result.message = error.detail;
      if (error.status === 'infeasible') {
        if (input.targets.some(t => (t.minRate ?? 0) > 0)) result.message = 'Заказ и заданные минимумы невыполнимы совместно с текущими ограничениями. Минимумы не были сняты.';
        result.diagnostics.push('Проверьте необходимые ресурсы, выключенные здания и рецепты, побочные продукты и возможность утилизации. Ограничения не были изменены.');
        if (requested.mode === 'target' && requested.targets.some(t => t.rate > 0) && performance.now() < deadline) {
          const targets = requested.targets.filter(t => t.rate > 0);
          const alternative = solve(catalog, { ...requested, batch: undefined, targets, mode: 'maximize', policy: 'proportional', settings: { ...requested.settings, outputSlack: 0 } }, highs, deadline);
          if (hasSolution(alternative)) {
            const fraction = Math.min(...targets.map(t => (alternative.products.find(p => p.itemId === t.itemId)?.rate ?? 0) / t.rate));
            result.feasibleAlternative = { products: alternative.products, fraction, power: alternative.power, bottlenecks: alternative.diagnostics };
          } else result.diagnostics.push('Дополнительная оценка достижимого выпуска не завершена.');
        }
      }
      return result;
    }
    return emptyResult('error', error instanceof Error ? error.message : 'Неизвестная ошибка расчёта.');
  }
}
class SolveFailure extends Error { constructor(public status: Result['status'], public detail?: string) { super(detail ?? status); } }
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
