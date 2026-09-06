import type { Catalog, Plan } from './types';

/** A world snapshot only restricts local choices; it cannot silently unlock them. */
export function effectivePlan(catalog: Catalog, plan: Plan): Plan {
  if (!plan.world) return plan;
  const world = plan.world;
  const transport = (kind: 'belts' | 'pipes', localId: string, worldId: string) => {
    const local = catalog[kind].find(t => t.id === localId);
    const unlocked = catalog[kind].find(t => t.id === worldId);
    if (!local || !unlocked) throw new Error('Транспорт мира отсутствует в каталоге.');
    return local.rate <= unlocked.rate ? local.id : unlocked.id;
  };
  if (!world.overclockUnlocked && (plan.settings.clock > 100 || plan.sources.some(s => s.kind === 'node' && s.clock > 100))) {
    throw new Error('Разгон не открыт в мире. Откройте исследование или установите частоты не выше 100%.');
  }
  if (world.unlockedRecipeIds.some(id => !catalog.recipes.some(r => r.id === id))
    || world.unlockedBuildingIds.some(id => !catalog.buildings.some(b => b.id === id) && !catalog.miners.some(m => m.id === id))) {
    throw new Error('Открытия мира отсутствуют в каталоге. Проверьте совместимость.');
  }
  return { ...plan,
    sources: plan.sources.map(s => s.kind === 'node' && !world.unlockedBuildingIds.includes(s.minerId) ? { ...s, limit: 0 } : s),
    settings: { ...plan.settings,
    enabledRecipeIds: plan.settings.enabledRecipeIds.filter(id => world.unlockedRecipeIds.includes(id)),
    enabledBuildingIds: plan.settings.enabledBuildingIds.filter(id => world.unlockedBuildingIds.includes(id)),
    beltId: transport('belts', plan.settings.beltId, world.beltId),
    pipeId: transport('pipes', plan.settings.pipeId, world.pipeId),
  } };
}
