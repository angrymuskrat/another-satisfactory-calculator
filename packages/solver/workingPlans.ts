import { effectivePlan } from '../domain/availability';
import { applyBatch } from '../domain/batch';
import { hasSolution, type Catalog, type Plan, type ProductionVariant } from '../domain/types';
import { buildModel } from './build';
import { solve } from './solve';
import { validateResult } from './validate';

/** Relaxation only selects recipes. Every published machine and flow comes from the integer model. */
export function findWorkingPlans(catalog: Catalog, input: Plan, highs: Parameters<typeof solve>[2],
  deadline: number, publish: (variant: ProductionVariant) => void) {
  if (input.settings.beltRouting?.enabled || (input.mode !== 'target' && !input.batch)
    || input.settings.enabledRecipeIds.length < 24 || performance.now() >= deadline) return;
  const physicalPlan: Plan = { ...input, settings: { ...input.settings, pareto: false, objective: 'smooth-power' } };
  delete physicalPlan.settings.smoothPowerExtraMachines;
  delete physicalPlan.settings.resourcesFirst;
  delete physicalPlan.settings.recipesFirst;
  if (input.settings.pareto) physicalPlan.settings.resourceWeights = {};
  let plan: Plan, built: ReturnType<typeof buildModel>;
  try {
    plan = effectivePlan(catalog, applyBatch(physicalPlan));
    built = buildModel(catalog, plan);
  } catch {
    // The full solve reports the original input/model error.
    return;
  }
  const seen = new Set<string>();
  const firstInput = built.inputResources.keys().next().value;
  const resourceSeed = input.settings.pareto && firstInput
    ? { objective: built.inputResources.get(firstInput)!, label: `Рабочий план · ${catalog.items.find(i => i.id === firstInput)?.name ?? firstInput}` }
    : { objective: built.resources, label: 'Рабочий план по расходу сырья' };
  const seeds = [
    { id: 'machines', objective: built.machineCount, label: 'Рабочий план по числу машин' },
    { id: 'resources', ...resourceSeed },
  ];
  for (const [i, seed] of seeds.entries()) {
    const now = performance.now();
    if (now >= deadline) break;
    const until = now + (deadline - now) / (seeds.length - i);
    const relaxed = highs.solve(built.model.serialize(seed.objective, false, true), {
      time_limit: (until - now) / 1000, output_flag: false, log_to_console: false,
      primal_feasibility_tolerance: 1e-8, dual_feasibility_tolerance: 1e-8,
    });
    if (relaxed.Status !== 'Optimal') continue;
    const active = new Set(built.recipeVariables.filter(r => r.configuration.existing || relaxed.Columns[r.variable]?.Primal > 0).map(r => r.recipe.id));
    const ids = plan.settings.enabledRecipeIds.filter(id => active.has(id));
    const key = JSON.stringify(ids);
    if (seen.has(key) || performance.now() >= until) continue;
    seen.add(key);
    const restricted: Plan = { ...physicalPlan, settings: { ...physicalPlan.settings, enabledRecipeIds: ids } };
    const result = solve(catalog, restricted, highs, until, { retainOnTimeout: true });
    if (!hasSolution(result)) continue;
    // A restricted minimum cannot certify the full machine budget, even if its integer solve finished.
    delete result.machineBudget;
    delete result.searchProgress;
    const checked = validateResult(catalog, input, result);
    if (checked.errors.length) continue;
    result.maxBalanceError = checked.maxBalanceError;
    result.status = 'approximate';
    result.message = 'Рабочий план проверен со всеми исходными рецептами и ограничениями. Оптимизация по полному набору рецептов выполняется отдельно.';
    result.modelNotes = [result.message];
    publish({ id: `working-${seed.id}`, label: seed.label, plan: structuredClone(input), result });
  }
}
