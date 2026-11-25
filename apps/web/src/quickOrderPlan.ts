import { createDefaultPlan } from '../../../packages/domain/defaults';
import { orderDependencies } from '../../../packages/domain/dependencies';
import type { ConstructionGroup } from '../../../packages/domain/construction';
import type { Catalog, Item, Plan } from '../../../packages/domain/types';

export function quickOrderPlan(catalog: Catalog, product: Item, rate: number): Plan {
  const defaults = createDefaultPlan(catalog);
  return {
    ...defaults,
    name: product.name,
    mode: 'target',
    targets: [{ itemId: product.id, rate, weight: 1, scale: 1 }],
    sources: [],
    settings: { ...defaults.settings, resourcePolicy: 'unlimited-unlisted' },
  };
}

export function firstProductionBlock(production: ConstructionGroup[]) {
  const active = production.filter(group => group.activeDuty > 0);
  const [first] = orderDependencies(active.map(group => ({
    recipeId: group.id, inputs: group.averageInputs, outputs: group.averageOutputs,
  })));
  if (!first) return null;
  return { cyclic: first.cyclic, groups: active.filter(group => first.recipeIds.includes(group.id)) };
}
