import { CLOCK_POWER_EXPONENT } from '../../../packages/domain/gameMechanics';
import type { Catalog, Plan, Recipe } from '../../../packages/domain/types';
import { recipeResearchReasons } from '../../../packages/domain/research';
import type { Messages } from './i18n';
import { gameName, searchNames } from './i18n/gameNames';
import { normalize } from './controls';

export type SearchScope = 'all' | 'produces' | 'uses';
export type QuantityMode = 'cycle' | 'minute' | 'unit';
export function matchesRecipe(catalog: Catalog, recipe: Recipe, query: string, scope: SearchScope): boolean {
  const ingredients = scope === 'produces' ? recipe.outputs : scope === 'uses' ? recipe.inputs : [...recipe.inputs, ...recipe.outputs];
  const text = [...(scope === 'all' ? [recipe.name, recipe.nameEn, searchNames('recipe', recipe.id, recipe.name)] : []), ...ingredients.flatMap(i => {
    const item = catalog.items.find(item => item.id === i.itemId); return [item?.name ?? '', item?.nameEn ?? '', searchNames('item', i.itemId, item?.name ?? '')];
  })].join(' ');
  return normalize(text).includes(normalize(query.trim()));
}
export function recipeAvailability(catalog: Catalog, plan: Plan, recipe: Recipe, t: Messages) {
  const opened = !plan.world || plan.world.unlockedRecipeIds.includes(recipe.id);
  const buildingOpened = !plan.world || plan.world.unlockedBuildingIds.includes(recipe.buildingId);
  const enabled = plan.settings.enabledRecipeIds.includes(recipe.id);
  const buildingEnabled = plan.settings.enabledBuildingIds.includes(recipe.buildingId);
  const building = catalog.buildings.find(b => b.id === recipe.buildingId);
  const unlocks = catalog.unlocks?.filter(u => u.recipeIds.includes(recipe.id) && !plan.world?.unlockedMilestoneIds.includes(u.id)) ?? [];
  const buildingName = building ? gameName('building', building.id, building.name) : recipe.buildingId;
  const reasons: string[] = [];
  if (!opened) reasons.push(unlocks.length ? t.recipeCatalog.openInWorld(unlocks.map(u => gameName('schematic', u.id, u.name))) : t.recipeCatalog.recipeNotOpened);
  if (!opened && catalog.researchTrees?.length) {
    reasons.push(...recipeResearchReasons(catalog, recipe.id, plan.world?.unlockedMilestoneIds ?? []));
    reasons.push(t.recipeCatalog.referenceChain);
  }
  if (!buildingOpened) reasons.push(t.recipeCatalog.buildingNotOpened(buildingName));
  if (!enabled) reasons.push(t.recipeCatalog.recipeDisabled);
  if (!buildingEnabled) reasons.push(t.recipeCatalog.buildingDisabled(buildingName));
  return { opened, buildingOpened, enabled, buildingEnabled, usable: opened && buildingOpened && enabled && buildingEnabled, reasons };
}
/** Preserve imported category/product order, then place alternatives next to the base output. */
export function groupRecipes(recipes: Recipe[]) {
  const categories = new Map<string, { category: string; products: { itemId: string; recipes: Recipe[] }[] }>();
  for (const recipe of recipes) {
    let category = categories.get(recipe.category);
    if (!category) { category = { category: recipe.category, products: [] }; categories.set(recipe.category, category); }
    const itemId = recipe.outputs[0]?.itemId ?? recipe.id;
    let product = category.products.find(p => p.itemId === itemId);
    if (!product) { product = { itemId, recipes: [] }; category.products.push(product); }
    product.recipes.push(recipe);
  }
  for (const category of categories.values()) for (const product of category.products) product.recipes.sort((a, b) => Number(a.alternate) - Number(b.alternate));
  return [...categories.values()];
}
export function recipeMetrics(catalog: Catalog, recipe: Recipe, clock: number, mode: QuantityMode, outputId: string) {
  const output = recipe.outputs.find(i => i.itemId === outputId) ?? recipe.outputs[0];
  const cycles = 60 / recipe.seconds * clock / 100;
  const building = catalog.buildings.find(b => b.id === recipe.buildingId);
  const power = (recipe.power ?? building?.power ?? 0) * (clock / 100) ** CLOCK_POWER_EXPONENT;
  const factor = mode === 'cycle' ? 1 : mode === 'minute' ? cycles : 1 / output.amount;
  return { inputs: recipe.inputs.map(i => ({ ...i, amount: i.amount * factor })), outputs: recipe.outputs.map(i => ({ ...i, amount: i.amount * factor })),
    power, energyPerUnit: power / (cycles * output.amount), outputId: output.itemId,
    estimated: !!(recipe.powerEstimated || building?.powerEstimated) };
}
