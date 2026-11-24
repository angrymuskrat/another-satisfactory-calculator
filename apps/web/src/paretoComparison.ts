import type { Catalog, ProductionVariant } from '../../../packages/domain/types';
import { buildConstruction } from '../../../packages/domain/construction';
import { coordinates } from '../../../packages/solver/pareto';
export function compareFactories(catalog: Catalog, before: ProductionVariant, after: ProductionVariant) {
  const a = coordinates(before.result), b = coordinates(after.result);
  const resourceIds = [...new Set([...before.result.resources, ...after.result.resources].map(r => r.itemId))];
  const machines = (v: ProductionVariant) => buildConstruction(catalog, v.plan, v.result).materials.totalMachines;
  const oldRecipes = new Set(before.result.steps.map(s => s.recipeId)), newRecipes = new Set(after.result.steps.map(s => s.recipeId));
  return { resources: resourceIds.map(itemId => ({ itemId, before: a[itemId] ?? 0, after: b[itemId] ?? 0, delta: (b[itemId] ?? 0) - (a[itemId] ?? 0) })),
    machines: machines(after) - machines(before), added: [...newRecipes].filter(id => !oldRecipes.has(id)), removed: [...oldRecipes].filter(id => !newRecipes.has(id)) };
}
