import type { Catalog, Plan, Result } from '../domain/types';
import { add, type Model, type Expression } from './model';
import type { RecipeVariable, SourceVariable } from './build';
import { productionConfigurations } from '../domain/production';

/** A certificate subflow of actual production: only approved carrier paths
 * can supply fuel, while unrelated production remains free to use converters.
 * Surplus certified material may leave this subflow into ordinary production. */
export function buildFuelProvenance(catalog: Catalog, plan: Plan, model: Model, recipes: RecipeVariable[], sources: SourceVariable[]) {
  const result = { sources: [] as { sourceId: string; variable: string }[], steps: [] as { configurationId: string; variable: string }[] };
  const family = plan.settings.selfSupply; if (!family) return result;
  const path = catalog.generationPaths?.[family]; if (!path) throw new Error('Не подтверждены пути производства выбранного топлива.');
  const balances = new Map<string, Expression>(path.itemIds.map(id => [id, new Map()]));
  for (const s of sources.filter(s => s.source.itemId === family)) {
    const variable = model.variable(); model.constrain(new Map([[variable, 1], [s.variable, -1]]), '<=', 0);
    add(balances.get(family)!, variable, 1); result.sources.push({ sourceId: s.source.id, variable });
  }
  for (const r of recipes) {
    if (!r.recipe.generation && !path.recipeIds.includes(r.recipe.id)) continue;
    const variable = r.recipe.generation ? r.variable : model.variable();
    if (!r.recipe.generation) {
      model.constrain(new Map([[variable, 1], [r.variable, -1]]), '<=', 0);
      result.steps.push({ configurationId: r.configuration.id, variable });
    }
    for (const [sign, flows] of [[-1, r.recipe.inputs], [1, r.recipe.outputs]] as const) for (const i of flows) {
      const b = balances.get(i.itemId); if (b) add(b, variable, sign * i.amount);
    }
  }
  for (const b of balances.values()) model.constrain(b, '>=', 0);
  return result;
}

export function validateFuelProvenance(catalog: Catalog, plan: Plan, result: Result): string[] {
  const family = plan.settings.selfSupply; if (!family) return result.fuelProvenance ? ['Не разрешён сертификат топлива.'] : [];
  const path = catalog.generationPaths?.[family], proof = result.fuelProvenance;
  if (!path || !proof) return ['Не подтверждено происхождение топлива.'];
  const errors: string[] = [], balances = new Map(path.itemIds.map(id => [id, 0]));
  const valid = (v: number, bound: number) => Number.isFinite(v) && v >= 0 && v <= bound + Math.min(1e-7, bound * 1e-7);
  const sourceIds = new Set<string>(), configIds = new Set<string>();
  for (const s of proof.sources) {
    const actual = result.resources.find(r => r.sourceId === s.sourceId);
    if (sourceIds.has(s.sourceId) || !actual || actual.itemId !== family || !valid(s.rate, actual.rate)) errors.push('Недопустимый источник топлива.');
    else balances.set(family, (balances.get(family) ?? 0) + s.rate);
    sourceIds.add(s.sourceId);
  }
  const configs = productionConfigurations(catalog, plan);
  const certified = [...proof.steps, ...result.steps.filter(s => catalog.recipes.find(r => r.id === s.recipeId)?.generation).map(s => ({ configurationId: s.configurationId ?? s.recipeId, cycles: s.cycles }))];
  for (const s of certified) {
    const config = configs.find(c => c.id === s.configurationId), actual = result.steps.find(r => (r.configurationId ?? r.recipeId) === s.configurationId);
    if (configIds.has(s.configurationId) || !config || !actual || (!config.recipe.generation && !path.recipeIds.includes(config.recipe.id)) || !valid(s.cycles, actual.cycles)) { errors.push('Недопустимый путь топлива.'); continue; }
    configIds.add(s.configurationId);
    for (const [sign, flows] of [[-1, config.recipe.inputs], [config.boost, config.recipe.outputs]] as const) for (const f of flows) if (balances.has(f.itemId)) balances.set(f.itemId, balances.get(f.itemId)! + sign * f.amount * s.cycles);
  }
  if ([...balances.values()].some(v => !Number.isFinite(v) || v < -1e-7)) errors.push('Топливо не обеспечено выбранным первичным сырьём.');
  return errors;
}
