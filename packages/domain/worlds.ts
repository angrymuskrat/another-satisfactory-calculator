import { z } from 'zod';
import type { Catalog, Plan, WorldSnapshot } from './types';
import { parsePlan, worldSnapshotSchema } from './validation';
import { validateWorkspaceSharedResources } from './sharedResources';

const id = z.string().min(1).max(200);
const revision = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER - 1);
export const worldSchema = worldSnapshotSchema.extend({ revision, name: z.string().trim().min(1).max(120), catalogVersion: id });
export type World = z.infer<typeof worldSchema>;
export interface Factory { id: string; name: string; worldId: string | null; plan: Plan }
export interface Workspace { schemaVersion: 1; catalogVersion: string; worlds: World[]; factories: Factory[] }
export const emptyWorkspace = (catalogVersion: string): Workspace => ({ schemaVersion: 1, catalogVersion, worlds: [], factories: [] });
export function snapshotWorld(world: World): WorldSnapshot {
  const { name: _name, catalogVersion: _version, ...snapshot } = world;
  return structuredClone(snapshot);
}
export function createWorld(catalog: Catalog, name: string, worldId: string, plan?: Plan): World {
  if (plan?.world) return worldSchema.parse({ ...structuredClone(plan.world), id: worldId, name, catalogVersion: catalog.version, revision: 1 });
  return worldSchema.parse({ id: worldId, name, catalogVersion: catalog.version, revision: 1,
    unlockedRecipeIds: plan?.settings.enabledRecipeIds ?? [],
    unlockedBuildingIds: plan ? [...new Set([...plan.settings.enabledBuildingIds, ...plan.sources.filter(s => s.kind === 'node').map(s => s.minerId)])] : [],
    beltId: plan?.settings.beltId ?? catalog.belts[0].id, pipeId: plan?.settings.pipeId ?? catalog.pipes[0].id,
    overclockUnlocked: plan ? plan.settings.clock > 100 || plan.sources.some(s => s.kind !== 'flow' && s.clock > 100) || (plan.expansion !== 'rebuild' && !!plan.lines?.some(l => l.clock > 100)) : false,
    unlockedMilestoneIds: [
      ...(plan?.sources.some(s => s.kind === 'well') ? ['p2:resource-wells'] : []),
      ...((plan?.somersloopBudget ?? 0) > 0 || (plan?.expansion !== 'rebuild' && plan?.lines?.some(l => l.somersloops > 0)) ? ['p2:production-amplifier'] : []),
    ],
  });
}
export function createFactory(plan: Plan, factoryId: string, world?: World): Factory {
  const copy = structuredClone(plan);
  if (world) copy.world = snapshotWorld(world);
  else delete copy.world;
  return { id: factoryId, name: copy.name, worldId: world?.id ?? null, plan: copy };
}
export function validateWorldCatalog(world: WorldSnapshot, catalog: Catalog) {
  if (world.unlockedRecipeIds.some(id => !catalog.recipes.some(r => r.id === id)) ||
      world.unlockedBuildingIds.some(id => !catalog.buildings.some(b => b.id === id) && !catalog.miners.some(m => m.id === id)) ||
      world.resourceNodes?.some(node => !catalog.items.some(item => item.id === node.itemId)) ||
      !catalog.belts.some(b => b.id === world.beltId) || !catalog.pipes.some(p => p.id === world.pipeId)) {
    throw new Error('Мир содержит неизвестные ресурсы, рецепты, здания или транспорт.');
  }
}

/** Применяет прямые эффекты выбранных схем, включая BP_UnlockSchematic. Prerequisites не покупаются автоматически. */
export function grantWorldUnlocks(catalog: Catalog, world: World, selectedIds: string[]): World {
  const selected = new Set<string>();
  const visit = (id: string) => {
    if (selected.has(id)) return;
    const unlock = catalog.unlocks?.find(u => u.id === id);
    if (!unlock) throw new Error(`Схема открытия отсутствует в каталоге: ${id}`);
    selected.add(id);
    for (const child of unlock.schematicIds ?? []) visit(child);
  };
  selectedIds.forEach(visit);
  const unlocks = catalog.unlocks?.filter(u => selected.has(u.id)) ?? [];
  const best = (kind: 'belts' | 'pipes', current: string, added: string[]) => catalog[kind].filter(t => t.id === current || added.includes(t.id)).sort((a, b) => b.rate - a.rate)[0].id;
  return { ...structuredClone(world),
    unlockedMilestoneIds: [...new Set([...world.unlockedMilestoneIds, ...selected])],
    unlockedRecipeIds: [...new Set([...world.unlockedRecipeIds, ...unlocks.flatMap(u => u.recipeIds)])],
    unlockedBuildingIds: [...new Set([...world.unlockedBuildingIds, ...unlocks.flatMap(u => [...u.buildingIds, ...(u.minerIds ?? [])])])],
    beltId: best('belts', world.beltId, unlocks.flatMap(u => u.beltIds)),
    pipeId: best('pipes', world.pipeId, unlocks.flatMap(u => u.pipeIds)),
    overclockUnlocked: world.overclockUnlocked || unlocks.some(u => u.overclock),
  };
}
const workspaceSchema = z.strictObject({ schemaVersion: z.literal(1), catalogVersion: id,
  worlds: z.array(worldSchema).max(100),
  factories: z.array(z.strictObject({ id, name: z.string().trim().min(1).max(120), worldId: id.nullable(), plan: z.unknown() })).max(500),
});
// Валидация графа обязательна и для API, и для импорта: ссылка никогда не указывает на чужой/отсутствующий мир.
export function parseWorkspace(value: unknown, parse: (value: unknown) => Plan = parsePlan): Workspace {
  const data = workspaceSchema.parse(value);
  if (new Set(data.worlds.map(w => w.id)).size !== data.worlds.length || new Set(data.factories.map(f => f.id)).size !== data.factories.length) throw new Error('Повторяющиеся миры или фабрики.');
  if (data.worlds.some(w => w.catalogVersion !== data.catalogVersion)) throw new Error('Версии каталогов миров отличаются.');
  const factories = data.factories.map(f => {
    const plan = parse(f.plan);
    if (plan.catalogVersion !== data.catalogVersion || plan.name !== f.name) throw new Error('Название или каталог фабрики не совпадает с планом.');
    const world = data.worlds.find(w => w.id === f.worldId);
    if (f.worldId !== null && !world) throw new Error('Мир фабрики отсутствует.');
    if (world ? JSON.stringify(worldSnapshotSchema.parse(plan.world)) !== JSON.stringify(worldSnapshotSchema.parse(snapshotWorld(world))) : plan.world !== undefined) throw new Error('Snapshot фабрики не совпадает с действующим миром.');
    return { ...f, plan };
  });
  const workspace = { ...data, factories };
  validateWorkspaceSharedResources(workspace);
  return workspace;
}
export function validateWorkspaceCatalog(workspace: Workspace, catalog: Catalog) {
  if (workspace.catalogVersion !== catalog.version) throw new Error('Версия каталога рабочего пространства отличается. Исходный файл не изменён.');
  workspace.worlds.forEach(w => validateWorldCatalog(w, catalog));
}
const changes = (before: string[], after: string[]) => ({ added: after.filter(id => !before.includes(id)), removed: before.filter(id => !after.includes(id)) });
export function previewWorldUpdate(workspace: Workspace, draft: World) {
  const before = workspace.worlds.find(w => w.id === draft.id);
  if (!before || before.revision !== draft.revision) throw new Error('Мир изменился. Загрузите актуальную версию и повторите просмотр изменений.');
  if (before.catalogVersion !== draft.catalogVersion) throw new Error('Нельзя менять каталог мира без миграции.');
  const after = worldSchema.parse({ ...draft, revision: before.revision + 1 });
  const beforeNodes = before.resourceNodes ?? [], afterNodes = after.resourceNodes ?? [];
  return {
    before: structuredClone(before), after,
    recipes: changes(before.unlockedRecipeIds, after.unlockedRecipeIds),
    buildings: changes(before.unlockedBuildingIds, after.unlockedBuildingIds),
    milestones: changes(before.unlockedMilestoneIds, after.unlockedMilestoneIds),
    resources: {
      added: afterNodes.filter(node => !beforeNodes.some(previous => previous.id === node.id)),
      removed: beforeNodes.filter(node => !afterNodes.some(next => next.id === node.id)),
      changed: beforeNodes.flatMap(previous => {
        const next = afterNodes.find(node => node.id === previous.id);
        return next && JSON.stringify(previous) !== JSON.stringify(next) ? [{ before: previous, after: next }] : [];
      }),
    },
    factories: workspace.factories.filter(f => f.worldId === draft.id).map(f => ({ id: f.id, name: f.name })),
  };
}
export function applyWorldUpdate(workspace: Workspace, preview: ReturnType<typeof previewWorldUpdate>): Workspace {
  const current = workspace.worlds.find(w => w.id === preview.before.id);
  if (!current || JSON.stringify(current) !== JSON.stringify(preview.before)) throw new Error('Просмотр изменений устарел. Повторите просмотр изменений.');
  if (JSON.stringify(workspace.factories.filter(f => f.worldId === current.id).map(f => ({ id: f.id, name: f.name }))) !== JSON.stringify(preview.factories)) throw new Error('Список фабрик изменился. Повторите просмотр изменений.');
  return parseWorkspace({ ...workspace,
    worlds: workspace.worlds.map(w => w.id === current.id ? structuredClone(preview.after) : w),
    factories: workspace.factories.map(f => f.worldId === current.id ? { ...f, plan: { ...f.plan, world: snapshotWorld(preview.after) } } : f),
  });
}
// Импорт добавляет копии с новыми ID, поэтому коллизия не перезаписывает ни один существующий план.
export function mergeWorkspace(workspace: Workspace, imported: Workspace, newId: () => string): Workspace {
  if (workspace.catalogVersion !== imported.catalogVersion) throw new Error('Каталоги рабочих пространств отличаются.');
  const ids = new Map(imported.worlds.map(w => [w.id, newId()]));
  const nodeIds = new Map<string, string>();
  const worlds = imported.worlds.map(w => {
    const copy = { ...structuredClone(w), id: ids.get(w.id)! };
    if (!w.resourceNodes) return copy;
    return { ...copy, resourceNodes: w.resourceNodes.map(node => {
      const id = newId(); nodeIds.set(`${w.id}\u0000${node.id}`, id);
      return { ...node, id };
    }) };
  });
  const factories = imported.factories.map(f => {
    const world = worlds.find(w => w.id === ids.get(f.worldId ?? ''));
    const plan = structuredClone(f.plan);
    if (f.worldId !== null) plan.sources = plan.sources.map(source => source.sharedNodeId ? {
      ...source, sharedNodeId: nodeIds.get(`${f.worldId}\u0000${source.sharedNodeId}`) ?? source.sharedNodeId,
    } : source);
    return createFactory(plan, newId(), world);
  });
  return parseWorkspace({ ...workspace, worlds: [...workspace.worlds, ...worlds], factories: [...workspace.factories, ...factories] });
}
