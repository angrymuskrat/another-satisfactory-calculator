import type { Catalog, Plan } from './types';
import { parsePlan } from './validation';
import { validateWorldCatalog } from './worlds';

export function parseCatalogPlan(value: unknown, catalog: Catalog): Plan {
  const plan = parsePlan(value);
  if (plan.catalogVersion !== catalog.version) throw new Error('Версия каталога плана отличается от текущей. Требуется миграция профиля.');
  const items = new Set(catalog.items.map(item => item.id));
  const recipes = new Set(catalog.recipes.map(recipe => recipe.id));
  const buildings = new Set(catalog.buildings.map(building => building.id));
  if (plan.targets.some(target => !items.has(target.itemId)) || plan.sources.some(source => !items.has(source.itemId)) || plan.settings.enabledRecipeIds.some(id => !recipes.has(id)) || plan.settings.enabledBuildingIds.some(id => !buildings.has(id)) || Object.keys(plan.settings.resourceWeights).some(id => !catalog.items.some(item => item.id === id && item.raw))) throw new Error('В плане есть неизвестные предметы, рецепты, здания или веса сырья.');
  if (!catalog.belts.some(belt => belt.id === plan.settings.beltId) || !catalog.pipes.some(pipe => pipe.id === plan.settings.pipeId)) throw new Error('План содержит неизвестный транспорт.');
  if (plan.sources.some(source => source.kind === 'node' && !catalog.miners.some(miner => miner.id === source.minerId && miner.resourceIds.includes(source.itemId)))) throw new Error('Добытчик в плане не поддерживает выбранный ресурс.');
  if (plan.world) validateWorldCatalog(plan.world, catalog);
  return plan;
}
