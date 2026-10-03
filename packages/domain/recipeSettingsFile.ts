import { z } from 'zod';
import type { Catalog, Plan } from './types';
import { planSchema } from './validation';
import { prepareRecipeSetup, unlockOrigin, type RecipeSetup } from './recipeProgress';

export const RECIPE_SETTINGS_FORMAT = 'ficsit-recipe-settings';
const settings = planSchema.shape.settings.shape;
const recipeSettingsSchema = z.strictObject({
  format: z.literal(RECIPE_SETTINGS_FORMAT), version: z.literal(1),
  catalogVersion: planSchema.shape.catalogVersion, name: planSchema.shape.name, exportedAt: z.string().max(100),
  /** Отмеченные этапы HUB и исследования MAM. */
  progress: z.strictObject({ unlockIds: settings.enabledRecipeIds }),
  /** Включённые рецепты, в том числе альтернативные. */
  recipes: z.strictObject({ enabledRecipeIds: settings.enabledRecipeIds }),
  /** Доступное оборудование, транспорт и предел частоты. */
  technologies: z.strictObject({ enabledBuildingIds: settings.enabledBuildingIds, beltId: settings.beltId, pipeId: settings.pipeId,
    clock: settings.clock, buildingLimits: settings.buildingLimits }),
});
export type RecipeSettingsFile = z.infer<typeof recipeSettingsSchema>;

const unique = <T,>(values: T[]) => [...new Set(values)];
const selectableProgress = (catalog: Catalog) => new Set(catalog.unlocks?.filter(u => ['hub', 'mam'].includes(unlockOrigin(u))).map(u => u.id));

/** В мире экспортируется действующий набор: локальное разрешение без открытия в мире не попадает в файл. */
export function exportRecipeSettings(catalog: Catalog, plan: Plan, exportedAt = new Date()): RecipeSettingsFile {
  const selectable = selectableProgress(catalog);
  const opened = (ids: string[], world?: string[]) => world ? ids.filter(id => world.includes(id)) : [...ids];
  const { buildingLimits } = plan.settings;
  return {
    format: RECIPE_SETTINGS_FORMAT, version: 1, catalogVersion: catalog.version, name: plan.name, exportedAt: exportedAt.toISOString(),
    progress: { unlockIds: (plan.world?.unlockedMilestoneIds ?? plan.recipeProgress?.unlockIds ?? []).filter(id => selectable.has(id)) },
    recipes: { enabledRecipeIds: opened(plan.settings.enabledRecipeIds, plan.world?.unlockedRecipeIds) },
    technologies: { enabledBuildingIds: opened(plan.settings.enabledBuildingIds, plan.world?.unlockedBuildingIds),
      beltId: plan.settings.beltId, pipeId: plan.settings.pipeId, clock: plan.settings.clock,
      ...(buildingLimits ? { buildingLimits: { ...buildingLimits } } : {}) },
  };
}

/** Идентификаторы стабильны между версиями каталога, поэтому другая версия допустима, но неизвестные ID отклоняются целиком. */
export function parseRecipeSettings(value: unknown, catalog: Catalog): RecipeSettingsFile {
  if (typeof value !== 'object' || value === null || (value as { format?: unknown }).format !== RECIPE_SETTINGS_FORMAT) {
    throw new Error('Это не файл настройки рецептов. Файл плана или рабочего пространства импортируется в другом разделе.');
  }
  const parsed = recipeSettingsSchema.safeParse(value);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new Error(`Некорректный файл настройки рецептов: ${first.path.join('.') || 'структура файла'}. ${first.message}`);
  }
  const file = parsed.data;
  const unknown = (ids: string[], known: Set<string>) => ids.filter(id => !known.has(id));
  const recipes = new Set(catalog.recipes.map(r => r.id)), buildings = new Set(catalog.buildings.map(b => b.id));
  const limited = new Set([...buildings, ...catalog.miners.map(m => m.id)]);
  const problems = [
    [unknown(file.progress.unlockIds, selectableProgress(catalog)), 'этапы HUB или исследования MAM'],
    [unknown(file.recipes.enabledRecipeIds, recipes), 'рецепты'],
    [unknown(file.technologies.enabledBuildingIds, buildings), 'здания'],
    [unknown(Object.keys(file.technologies.buildingLimits ?? {}), limited), 'лимиты зданий'],
    [unknown([file.technologies.beltId], new Set(catalog.belts.map(t => t.id))), 'конвейер'],
    [unknown([file.technologies.pipeId], new Set(catalog.pipes.map(t => t.id))), 'труба'],
  ] as const;
  const found = problems.filter(([ids]) => ids.length);
  if (found.length) {
    throw new Error(`Файл содержит неизвестные для каталога ${catalog.version} ${found.map(([ids, what]) => `${what} (${ids.slice(0, 3).join(', ')}${ids.length > 3 ? ` и ещё ${ids.length - 3}` : ''})`).join('; ')}. Настройка не изменена.`);
  }
  return file;
}

/**
 * Импорт заменяет набор как «Заменить набор»: прогресс раскрывается теми же правилами,
 * затем рецепты, здания, транспорт, частота и лимиты берутся из файла. В мире включённые
 * в файле рецепты и здания считаются открытыми; изменения мира применяются после просмотра.
 */
export function prepareRecipeSettingsImport(catalog: Catalog, plan: Plan, file: RecipeSettingsFile): RecipeSetup {
  const setup = prepareRecipeSetup(catalog, plan, file.progress.unlockIds, 'replace', 'none');
  const next = setup.plan, t = file.technologies;
  next.settings.enabledRecipeIds = [...file.recipes.enabledRecipeIds];
  next.settings.enabledBuildingIds = [...t.enabledBuildingIds];
  next.settings.beltId = t.beltId; next.settings.pipeId = t.pipeId; next.settings.clock = t.clock;
  if (t.buildingLimits) next.settings.buildingLimits = { ...t.buildingLimits };
  else delete next.settings.buildingLimits;
  if (next.world) {
    const best = (kind: 'belts' | 'pipes', ids: string[]) => catalog[kind].filter(x => ids.includes(x.id)).sort((a, b) => b.rate - a.rate)[0].id;
    next.world.unlockedRecipeIds = unique([...next.world.unlockedRecipeIds, ...file.recipes.enabledRecipeIds]);
    next.world.unlockedBuildingIds = unique([...next.world.unlockedBuildingIds, ...t.enabledBuildingIds]);
    next.world.beltId = best('belts', [next.world.beltId, t.beltId]);
    next.world.pipeId = best('pipes', [next.world.pipeId, t.pipeId]);
    next.world.overclockUnlocked ||= t.clock > 100;
  }
  return { ...setup, plan: next, eligibleAlternatives: [], unknownAlternatives: [],
    importedFrom: { name: file.name, catalogVersion: file.catalogVersion, exportedAt: file.exportedAt } };
}
