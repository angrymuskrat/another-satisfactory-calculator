import type { Catalog, Plan, Recipe } from '../../../packages/domain/types';

export type SearchScope = 'all' | 'produces' | 'uses';
export type QuantityMode = 'cycle' | 'minute' | 'unit';
const normalize = (text: string) => text.toLocaleLowerCase('ru').replaceAll('ё', 'е');
export function matchesRecipe(catalog: Catalog, recipe: Recipe, query: string, scope: SearchScope): boolean {
  const ingredients = scope === 'produces' ? recipe.outputs : scope === 'uses' ? recipe.inputs : [...recipe.inputs, ...recipe.outputs];
  const text = [...(scope === 'all' ? [recipe.name, recipe.nameEn] : []), ...ingredients.flatMap(i => {
    const item = catalog.items.find(item => item.id === i.itemId); return [item?.name ?? '', item?.nameEn ?? ''];
  })].join(' ');
  return normalize(text).includes(normalize(query.trim()));
}
export function recipeAvailability(catalog: Catalog, plan: Plan, recipe: Recipe) {
  const opened = !plan.world || plan.world.unlockedRecipeIds.includes(recipe.id);
  const buildingOpened = !plan.world || plan.world.unlockedBuildingIds.includes(recipe.buildingId);
  const enabled = plan.settings.enabledRecipeIds.includes(recipe.id);
  const buildingEnabled = plan.settings.enabledBuildingIds.includes(recipe.buildingId);
  const building = catalog.buildings.find(b => b.id === recipe.buildingId);
  const unlocks = catalog.unlocks?.filter(u => u.recipeIds.includes(recipe.id) && !plan.world?.unlockedMilestoneIds.includes(u.id)) ?? [];
  const reasons: string[] = [];
  if (!opened) reasons.push(unlocks.length ? `Открыть в мире: ${unlocks.map(u => u.name).join(' / ')}` : 'Рецепт не открыт в мире. Данные о конкретном исследовании отсутствуют.');
  if (!buildingOpened) reasons.push(`Здание не открыто в мире: ${building?.name ?? recipe.buildingId}`);
  if (!enabled) reasons.push('Рецепт выключен в плане');
  if (!buildingEnabled) reasons.push(`Здание отключено в плане: ${building?.name ?? recipe.buildingId}`);
  return { opened, buildingOpened, enabled, buildingEnabled, usable: opened && buildingOpened && enabled && buildingEnabled, reasons };
}
/** Categories are manual. Preserve imported product order, then place alternatives next to the base output. */
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
  const power = (recipe.power ?? building?.power ?? 0) * (clock / 100) ** Math.log2(2.5);
  const factor = mode === 'cycle' ? 1 : mode === 'minute' ? cycles : 1 / output.amount;
  return { inputs: recipe.inputs.map(i => ({ ...i, amount: i.amount * factor })), outputs: recipe.outputs.map(i => ({ ...i, amount: i.amount * factor })),
    power, energyPerUnit: power / (cycles * output.amount), outputId: output.itemId,
    estimated: !!(recipe.powerEstimated || building?.powerEstimated) };
}
