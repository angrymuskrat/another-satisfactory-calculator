import type { Catalog, Plan, Unlock } from './types';
import { applyWorldUpdate, createWorld, grantWorldUnlocks, previewWorldUpdate, snapshotWorld, type Workspace } from './worlds';
import { phaseForTier } from './research';

export type RecipeOrigin = 'hub' | 'mam' | 'hard-drive' | 'other';
export type AlternativeMode = 'none' | 'keep' | 'all';
export type SetupOperation = 'replace' | 'add';
export interface RecipeProgress {
  sources: RecipeOrigin[]; treeIds: string[]; unlockIds: string[];
  section: string; groupKey: string; tier?: number; step: string; rank: number; order: number;
}
const unique = <T,>(values: T[]) => [...new Set(values)];
export const unlockOrigin = (u: Unlock): RecipeOrigin => u.sourceType === 'EST_Alternate' ? 'hard-drive' : u.id === 'Schematic_StartingRecipes_C' ? 'hub' : u.kind;
const origin = unlockOrigin;

/** Только прямые эффекты и дочерние схемы. Предпосылки не покупаются. */
export function selectedUnlocks(catalog: Catalog, ids: string[]): Unlock[] {
  const byId = new Map(catalog.unlocks?.map(u => [u.id, u]));
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id)) return;
    const u = byId.get(id);
    if (!u) throw new Error(`Схема открытия отсутствует в каталоге: ${id}`);
    seen.add(id); u.schematicIds?.forEach(visit);
  };
  ids.forEach(visit);
  return [...seen].map(id => byId.get(id)!);
}

export function buildRecipeProgress(catalog: Catalog): Map<string, RecipeProgress> {
  const unlocks = catalog.unlocks ?? [];
  const byId = new Map(unlocks.map(u => [u.id, u]));
  // Для дисков используем требования, не mTechTier схемы и не уровень выходного предмета.
  const earliestTier = (id: string, path = new Set<string>()): number => {
    const u = byId.get(id);
    if (!u || path.has(id)) return Infinity;
    if (origin(u) === 'hub' && u.tier !== undefined) return u.tier;
    if (origin(u) === 'other') {
      const parents = unlocks.filter(parent => parent.schematicIds?.includes(id));
      return Math.min(...parents.map(parent => earliestTier(parent.id, new Set(path).add(id))));
    }
    if (!u.selectionDependenciesKnown || u.kind === 'mam') return Infinity;
    const next = new Set(path).add(id);
    const groups = u.prerequisiteGroups;
    if (!groups) return Infinity;
    return Math.max(0, ...groups.map(group => Math.min(...group.map(ref => earliestTier(ref, next)))));
  };
  const routes = new Map<string, { root: Unlock; treeIds: string[]; order: number }[]>();
  // Глубина MAM служит только порядком справочника. AND/OR не превращаются в покупку предков.
  for (const root of unlocks) {
    const trees = catalog.researchTrees?.filter(t => !t.seasonal && t.nodes.some(n => n.schematicId === root.id)) ?? [];
    const depth = (id: string, path = new Set<string>()): number => {
      if (path.has(id)) return 10000;
      const node = trees.flatMap(t => t.nodes).find(n => n.schematicId === id);
      if (!node) return 10000;
      if (!node.parents.length) return 0;
      return 1 + Math.min(...node.parents.map(p => p === null ? 10000 : depth(p, new Set(path).add(id))));
    };
    for (const u of selectedUnlocks(catalog, [root.id])) for (const recipeId of u.recipeIds) {
      const list = routes.get(recipeId) ?? [];
      list.push({ root, treeIds: trees.map(t => t.id), order: trees.length ? depth(root.id) : 0 });
      routes.set(recipeId, list);
    }
  }
  return new Map(catalog.recipes.map(recipe => {
    const allRoutes = routes.get(recipe.id) ?? [];
    // Дочерняя custom-схема не создаёт самостоятельного более раннего пути открытия.
    const originRoutes = allRoutes.filter(route => !unlocks.some(u => u.schematicIds?.includes(route.root.id)) || origin(route.root) !== 'other');
    const candidates = (originRoutes.length ? originRoutes : allRoutes).map(route => {
      const source = origin(route.root), tier = earliestTier(route.root.id);
      const tree = catalog.researchTrees?.find(t => route.treeIds.includes(t.id));
      const hub = Number.isFinite(tier);
      const phase = hub ? phaseForTier(catalog, tier)?.name ?? 'Начало прохождения' : '';
      const section = hub ? `${phase} · уровень HUB ${tier}` : tree ? `MAM · ${tree.name}` : source === 'hard-drive' ? 'Жёсткие диски · независимые или неизвестные условия' : 'Другие открытия';
      return { ...route, source, tier: hub ? tier : undefined, section, rank: hub ? 0 : tree ? 1 : 2 };
    }).sort((a, b) => a.rank - b.rank || (a.tier ?? 0) - (b.tier ?? 0) || a.section.localeCompare(b.section, 'ru') || a.order - b.order || a.root.name.localeCompare(b.root.name, 'ru'));
    const first = candidates[0];
    const step = first?.root.name ?? 'Источник открытия не сопоставлен';
    const section = first?.section ?? 'Неизвестное место в прогрессе';
    return [recipe.id, { sources: unique(candidates.map(c => c.source)), treeIds: unique(candidates.flatMap(c => c.treeIds)),
      unlockIds: unique(candidates.map(c => c.root.id)), section, step, groupKey: `${section}\u0000${first?.root.id ?? 'unknown'}`,
      tier: first?.tier, rank: first?.rank ?? 3, order: first?.order ?? 0 }];
  }));
}
export function compareRecipeProgress(a: RecipeProgress, b: RecipeProgress): number {
  return a.rank - b.rank || (a.tier ?? 0) - (b.tier ?? 0) || a.section.localeCompare(b.section, 'ru') || a.order - b.order || a.step.localeCompare(b.step, 'ru') || a.groupKey.localeCompare(b.groupKey);
}

export function prepareRecipeSetup(catalog: Catalog, plan: Plan, ids: string[], operation: SetupOperation, alternatives: AlternativeMode) {
  const previousIds = plan.world?.unlockedMilestoneIds ?? plan.recipeProgress?.unlockIds ?? [];
  const selectable = new Set(catalog.unlocks?.filter(u => origin(u) === 'hub' || u.kind === 'mam').map(u => u.id));
  if (ids.some(id => !selectable.has(id))) throw new Error('Выберите этапы HUB или исследования MAM из текущего каталога.');
  const unlockIds = unique([...(operation === 'add' ? previousIds.filter(id => selectable.has(id)) : []), ...ids]);
  const effects = selectedUnlocks(catalog, unlockIds);
  const completed = new Set(effects.map(u => u.id));
  const diskSchemes = catalog.unlocks?.filter(u => origin(u) === 'hard-drive') ?? [];
  const diskRecipes = (u: Unlock) => selectedUnlocks(catalog, [u.id]).flatMap(s => s.recipeIds);
  const unknownAlternatives = unique(diskSchemes.filter(u => !u.selectionDependenciesKnown || !u.prerequisiteGroups).flatMap(diskRecipes));
  const eligibleDisks = diskSchemes.filter(u => u.selectionDependenciesKnown && u.prerequisiteGroups?.every(group => group.some(id => completed.has(id))));
  const base = createWorld(catalog, 'Прогресс', plan.world?.id ?? 'recipe-progress');
  const granted = grantWorldUnlocks(catalog, base, unlockIds);
  const retainedAlternatives = alternatives === 'keep'
    ? plan.settings.enabledRecipeIds.filter(id => catalog.recipes.some(r => r.id === id && r.alternate) && (!plan.world || plan.world.unlockedRecipeIds.includes(id))) : [];
  const recipes = unique([...granted.unlockedRecipeIds.filter(id => alternatives !== 'none' || !catalog.recipes.find(r => r.id === id)?.alternate),
    ...retainedAlternatives, ...(alternatives === 'all' ? eligibleDisks.flatMap(u => selectedUnlocks(catalog, [u.id]).flatMap(s => s.recipeIds)) : [])]);
  const combine = (old: string[], added: string[]) => unique([...(operation === 'add' ? old : []), ...added]);
  const best = (kind: 'belts' | 'pipes', old: string, added: string) => operation === 'add'
    ? catalog[kind].filter(t => t.id === old || t.id === added).sort((a, b) => b.rate - a.rate)[0].id : added;
  const next = structuredClone(plan);
  next.recipeProgress = { unlockIds };
  next.settings.enabledRecipeIds = combine(plan.settings.enabledRecipeIds, recipes);
  next.settings.enabledBuildingIds = combine(plan.settings.enabledBuildingIds, granted.unlockedBuildingIds.filter(id => catalog.buildings.some(b => b.id === id)));
  next.settings.beltId = best('belts', plan.settings.beltId, granted.beltId);
  next.settings.pipeId = best('pipes', plan.settings.pipeId, granted.pipeId);
  if (plan.world) {
    next.world = { ...structuredClone(plan.world),
      unlockedRecipeIds: combine(plan.world.unlockedRecipeIds, recipes),
      unlockedBuildingIds: combine(plan.world.unlockedBuildingIds, granted.unlockedBuildingIds),
      unlockedMilestoneIds: combine(plan.world.unlockedMilestoneIds, granted.unlockedMilestoneIds),
      beltId: best('belts', plan.world.beltId, granted.beltId), pipeId: best('pipes', plan.world.pipeId, granted.pipeId),
      overclockUnlocked: (operation === 'add' && plan.world.overclockUnlocked) || granted.overclockUnlocked,
    };
  }
  return { before: structuredClone(plan), plan: next, operation, alternatives,
    eligibleAlternatives: unique(eligibleDisks.flatMap(diskRecipes)), unknownAlternatives };
}
export type RecipeSetup = ReturnType<typeof prepareRecipeSetup>;
export function prepareDiskSetup(catalog: Catalog, plan: Plan, ids: string[]): RecipeSetup {
  const setup = prepareRecipeSetup(catalog, plan, ids, 'add', 'all');
  const next = structuredClone(plan);
  next.settings.enabledRecipeIds = unique([...next.settings.enabledRecipeIds, ...setup.eligibleAlternatives]);
  if (next.world) next.world.unlockedRecipeIds = unique([...next.world.unlockedRecipeIds, ...setup.eligibleAlternatives]);
  return { ...setup, plan: next };
}
export function applyRecipeSetup(current: Plan, setup: RecipeSetup): Plan {
  if (JSON.stringify(current) !== JSON.stringify(setup.before)) throw new Error('План изменился. Просмотр устарел; подготовьте его заново.');
  return structuredClone(setup.plan);
}

/** Единственная транзакция общего мира и настроек активной фабрики. Её черновой заказ не сохраняется. */
export function prepareWorkspaceRecipeSetup(workspace: Workspace, current: Plan, setup: RecipeSetup, activeFactoryId: string | null) {
  const nextPlan = applyRecipeSetup(current, setup);
  const world = workspace.worlds.find(w => w.id === current.world?.id);
  if (!world || JSON.stringify(snapshotWorld(world)) !== JSON.stringify(current.world)) throw new Error('Снимок мира устарел или мир отсутствует в этом аккаунте. Откройте актуальную фабрику в разделе миров.');
  const preview = previewWorldUpdate(workspace, { ...world, ...nextPlan.world });
  const next = applyWorldUpdate(workspace, preview);
  nextPlan.world = snapshotWorld(preview.after);
  next.factories = next.factories.map(factory => factory.id === activeFactoryId && factory.worldId === world.id
    ? { ...factory, plan: { ...factory.plan, recipeProgress: nextPlan.recipeProgress, settings: { ...factory.plan.settings,
      enabledRecipeIds: [...nextPlan.settings.enabledRecipeIds], enabledBuildingIds: [...nextPlan.settings.enabledBuildingIds],
      beltId: nextPlan.settings.beltId, pipeId: nextPlan.settings.pipeId } } } : factory);
  return { workspace: next, plan: nextPlan, preview };
}
