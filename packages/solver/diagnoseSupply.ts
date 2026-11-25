import type loadHighs from 'highs';
import type { Catalog, Plan, ProductionVariants } from '../domain/types';
import type { SupplyGap } from '../domain/supplyGap';
import { parsePlan } from '../domain/validation';
import { effectivePlan } from '../domain/availability';
import { applyBatch } from '../domain/batch';
import { productionConfigurations } from '../domain/production';
import { sourceCapacity } from '../domain/sourceCapacity';
import { Model, add, type Expression } from './model';

/** Necessary material conditions. Free disposal and fractional, unbounded production
 * deliberately relax the factory: a positive individual lower bound is a real shortage,
 * while covering it can still leave a machine, power or by-product constraint. */
export function diagnoseSupply(catalog: Catalog, input: Plan, highs: Awaited<ReturnType<typeof loadHighs>>, deadline = performance.now() + 800): SupplyGap[] {
  try {
    const plan = effectivePlan(catalog, applyBatch(parsePlan(input)));
    const model = new Model();
    const balances = new Map(catalog.items.map(i => [i.id, new Map<string, number>()]));
    const slots = productionConfigurations(catalog, plan);
    const recipes = slots.filter(s => s.duty !== 0).map(s => {
      const variable = model.variable();
      for (const i of s.recipe.inputs) add(balances.get(i.itemId)!, variable, -i.amount);
      for (const o of s.recipe.outputs) add(balances.get(o.itemId)!, variable, o.amount * s.boost);
      return { recipe: s.recipe, variable };
    });
    const supplied = new Map<string, number>();
    for (const s of plan.sources) supplied.set(s.itemId, (supplied.get(s.itemId) ?? 0) + (sourceCapacity(catalog, plan, s).limit ?? Infinity));
    const capacity = new Map<string, number>(), extras = new Map<string, string>(), cost: Expression = new Map();
    for (const item of catalog.items) {
      const available = Math.min(plan.settings.inputLimits?.[item.id] ?? Infinity, supplied.get(item.id) ?? (item.raw && plan.settings.resourcePolicy === 'unlimited-unlisted' ? Infinity : 0));
      capacity.set(item.id, available);
      const balance = balances.get(item.id)!;
      if (available > 0) add(balance, model.variable(Number.isFinite(available) ? available : null), 1);
      if (item.raw && Number.isFinite(available)) {
        const extra = model.variable();
        extras.set(item.id, extra);
        add(balance, extra, 1);
        // Count equivalent incoming belts/pipes to compare unlike flow units.
        const transport = item.fluid ? catalog.pipes.find(t => t.id === plan.settings.pipeId) : catalog.belts.find(t => t.id === plan.settings.beltId);
        cost.set(extra, 1 / (transport?.rate ?? 1));
      }
    }
    if (!extras.size) return [];
    const targets = new Map(plan.targets.map(t => [t.itemId, plan.mode === 'target' ? t.rate : Math.max(t.minRate ?? 0, Math.min(t.rate, t.maxRate ?? Infinity))]));
    for (const [id, balance] of balances) model.constrain(balance, '>=', targets.get(id) ?? 0);
    const run = (goal: Expression) => highs.solve(model.serialize(goal), { output_flag: false, time_limit: Math.max(.001, (deadline - performance.now()) / 1000), primal_feasibility_tolerance: 1e-9 });
    const solution = run(cost);
    if (solution.Status !== 'Optimal') return [];
    const gaps: SupplyGap[] = [];
    for (const [itemId, variable] of extras) {
      const extra = solution.Columns[variable]?.Primal ?? 0;
      if (extra < 1e-7) continue;
      const consumers = recipes.filter(r => (solution.Columns[r.variable]?.Primal ?? 0) > 1e-9 && r.recipe.inputs.some(i => i.itemId === itemId));
      // Other raw inputs remain independently extensible during this check.
      const minimum = performance.now() < deadline ? run(new Map([[variable, 1]])) : undefined;
      gaps.push({ itemId, available: capacity.get(itemId)!, extra, minimumExtra: minimum?.Status === 'Optimal' ? Math.max(0, minimum.Columns[variable]?.Primal ?? 0) : null,
        consumers: [...new Set(consumers.map(r => r.recipe.id))] });
    }
    return gaps;
  } catch {
    // The calculation's own validation error takes precedence over optional suggestions.
    return [];
  }
}

export function attachSupplyDiagnosis(catalog: Catalog, plan: Plan, highs: Awaited<ReturnType<typeof loadHighs>>, report: ProductionVariants) {
  if (report.workingPlans?.length || report.variants.some(v => v.result.products.some(p => p.rate > 0))) return;
  const gaps = diagnoseSupply(catalog, plan, highs);
  if (!gaps.length) return;
  report.supplyGaps = gaps;
  if (!plan.batch && plan.mode !== 'target') return;
  const required = gaps.filter(g => (g.minimumExtra ?? 0) > 1e-7);
  const message = required.length
    ? 'Для заданного выпуска недостаточно сырья: ' + required.map(g => catalog.items.find(i => i.id === g.itemId)?.name ?? g.itemId).join(', ') + '.'
    : 'Для заданного выпуска требуется дополнительное снабжение. Возможный набор источников показан выше.';
  for (const result of [...report.variants.map(v => v.result), ...report.pareto?.failures ?? []]) {
    if (result.status === 'infeasible' || result.status === 'timeout' || result.message.startsWith('В консервативной модели')) {
      result.status = 'infeasible';
      result.message = message;
    }
  }
}
