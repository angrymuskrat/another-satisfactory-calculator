import type { Catalog, Plan, Recipe, Source } from './types';
import mechanics from '../game-data/p2-mechanics.json';

export const amplifierSlots = (buildingId: string): number => (mechanics.slots as Record<string, number>)[buildingId] ?? 0;
export interface ProductionConfiguration {
  id: string; recipe: Recipe; clock: number; somersloops: number; boost: number;
  existing: number; duty: number | null; name: string;
}
export const canOptimizeClock = (plan: Plan, configuration: ProductionConfiguration) => plan.settings.objective === 'smooth-power' && configuration.duty === null;

/** Balanced load per installed machine; below 1% the machine still needs idle time. */
export function balancedClock(configuration: ProductionConfiguration, cycles: number, count: number): number {
  return Math.min(configuration.clock, Math.max(1, cycles * configuration.recipe.seconds / (60 * count) * 100));
}
/** Finite configurations; clock is an input, never a post-solve correction. */
export function productionConfigurations(catalog: Catalog, plan: Plan): ProductionConfiguration[] {
  const configs: ProductionConfiguration[] = [];
  const available = (r: Recipe) => plan.settings.enabledRecipeIds.includes(r.id) && plan.settings.enabledBuildingIds.includes(r.buildingId);
  if (plan.expansion !== 'rebuild') for (const line of plan.lines ?? []) {
    const recipe = catalog.recipes.find(r => r.id === line.recipeId);
    if (!recipe || !available(recipe)) throw new Error(`Линия «${line.name || line.id}»: рецепт или здание недоступны.`);
    const slots = amplifierSlots(recipe.buildingId);
    if (line.somersloops > slots) throw new Error('Число усилителей линии превышает число слотов здания.');
    configs.push({ id: `line:${line.id}`, recipe, clock: line.clock, somersloops: line.somersloops,
      boost: 1 + (slots ? line.somersloops / slots : 0), existing: line.count, duty: line.locked ? line.duty : null, name: line.name || recipe.name });
  }
  if (plan.expansion !== 'keep') for (const recipe of catalog.recipes.filter(available)) {
    const slots = amplifierSlots(recipe.buildingId);
    for (let s = 0; s <= Math.min(slots, plan.somersloopBudget ?? 0); s++) configs.push({
      id: s ? `boost:${recipe.id}:${s}` : recipe.id, recipe, clock: plan.settings.clock, somersloops: s,
      boost: 1 + (slots ? s / slots : 0), existing: 0, duty: null, name: recipe.name,
    });
  }
  return configs;
}
export function wellConfiguration(catalog: Catalog, plan: Plan, source: Source) {
  if (!source.well || !mechanics.well.resourceIds.includes(source.itemId)) throw new Error('Скважина требует спутников и поддерживаемый ресурс: вода, нефть или азот.');
  const pipe = catalog.pipes.find(p => p.id === plan.settings.pipeId);
  if (!pipe) throw new Error('Труба отсутствует в каталоге.');
  const count = source.well.satellites.reduce((s, n) => s + n.count, 0);
  const capacity = source.well.satellites.reduce((s, n) => s + n.count * Math.min(pipe.rate, mechanics.well.rate * n.purity * source.clock / 100), 0);
  return { count, capacity, power: mechanics.well.power * (source.clock / 100) ** Math.log2(2.5) };
}
