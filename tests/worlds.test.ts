import { describe, it, expect } from 'vitest';
import catalogJson from '../packages/game-data/catalog.json';
import type { Catalog } from '../packages/domain/types';
import { createDefaultPlan } from '../packages/domain/defaults';
import { applyWorldUpdate, createFactory, createWorld, emptyWorkspace, grantWorldUnlocks, mergeWorkspace, parseWorkspace, previewWorldUpdate } from '../packages/domain/worlds';
import { parseCatalogPlan, parseCatalogWorkspace, saveGuestWorkspace, WORKSPACE_KEY } from '../apps/web/src/planStorage';

const catalog = catalogJson as Catalog;
const plan = createDefaultPlan(catalog);
function fixture() {
  const world = createWorld(catalog, 'Основное прохождение', 'world-1', plan);
  const a = createFactory(plan, 'factory-1', world);
  const b = createFactory({ ...plan, name: 'Вторая', sources: [], settings: { ...plan.settings, enabledRecipeIds: [] } }, 'factory-2', world);
  return { ...emptyWorkspace(catalog.version), worlds: [world], factories: [a, b] };
}
describe('миры и фабрики', () => {
  it('применяет реальные схемы, дочерние открытия и добытчиков без покупки prerequisites', () => {
    const world = createWorld(catalog, 'С нуля', 'world');
    const oil = catalog.unlocks!.find(u => u.id === 'Schematic_5-1_C')!;
    expect(oil.schematicIds).toContain('Schematic_5-1-1_C');
    const next = grantWorldUnlocks(catalog, world, [oil.id]);
    const child = catalog.unlocks!.find(u => u.id === 'Schematic_5-1-1_C')!;
    expect(next.unlockedMilestoneIds).toContain(child.id);
    expect(next.unlockedRecipeIds).toEqual(expect.arrayContaining(child.recipeIds));
    expect(next.unlockedBuildingIds).toContain('oil-pump');
    expect(world.unlockedMilestoneIds).toEqual([]);
    const overclock = grantWorldUnlocks(catalog, world, ['Research_PowerSlugs_2_C']);
    expect(overclock.overclockUnlocked).toBe(true);
    expect(overclock.unlockedMilestoneIds).toEqual(['Research_PowerSlugs_2_C']);
    const custom = { ...catalog, unlocks: [
      { ...oil, id: 'a', schematicIds: ['b'], prerequisiteIds: ['not-purchased'] },
      { ...oil, id: 'b', schematicIds: ['a'], prerequisiteIds: [] },
    ] };
    expect(grantWorldUnlocks(custom, world, ['a']).unlockedMilestoneIds).toEqual(['a', 'b']);
    expect(() => grantWorldUnlocks(catalog, world, ['unknown'])).toThrow('отсутствует');
  });
  it('копирует полный legacy план без изменения источника и открывает две независимые фабрики', () => {
    const original = JSON.stringify(plan);
    const workspace = fixture();
    const legacy = createFactory(plan, 'legacy');
    expect(legacy.plan).toEqual(plan);
    expect(legacy.worldId).toBeNull();
    workspace.factories[0].plan.sources[0].limit = 0;
    expect(JSON.stringify(plan)).toBe(original);
    expect(workspace.factories[1].plan.sources).toEqual([]);
    expect(parseCatalogPlan(JSON.parse(original), catalog)).toEqual(plan);
  });
  it('preview не изменяет действующий мир; apply обновляет обе фабрики и сохраняет локальные исключения', () => {
    const workspace = fixture();
    const original = structuredClone(workspace);
    const preview = previewWorldUpdate(workspace, { ...workspace.worlds[0], unlockedRecipeIds: [], beltId: catalog.belts[0].id });
    expect(preview.recipes.removed).toEqual(plan.settings.enabledRecipeIds);
    expect(preview.factories).toHaveLength(2);
    expect(workspace).toEqual(original);
    const next = applyWorldUpdate(workspace, preview);
    expect(next.worlds[0].revision).toBe(2);
    for (let i = 0; i < 2; i++) {
      expect(next.factories[i].plan.world?.revision).toBe(2);
      expect(next.factories[i].plan.settings).toEqual(original.factories[i].plan.settings);
      expect(next.factories[i].plan.sources).toEqual(original.factories[i].plan.sources);
    }
    expect(() => applyWorldUpdate(next, preview)).toThrow('устарел');
    expect(parseCatalogWorkspace(next, catalog)).toEqual(next);
  });
  it('отклоняет отсутствующий мир, устаревший snapshot, повторяющийся ID и другой каталог', () => {
    const a = fixture(); a.factories[0].worldId = 'missing';
    expect(() => parseWorkspace(a)).toThrow('отсутствует');
    const b = fixture(); b.factories[0].plan.world!.revision++;
    expect(() => parseWorkspace(b)).toThrow('Snapshot');
    const c = fixture(); c.factories.push(c.factories[0]);
    expect(() => parseWorkspace(c)).toThrow('Повторяющиеся');
    expect(() => parseCatalogWorkspace({ ...emptyWorkspace('other') }, catalog)).toThrow('каталога');
    const d = fixture(); d.worlds[0].unlockedRecipeIds.push('missing');
    d.factories.forEach(f => f.plan.world!.unlockedRecipeIds.push('missing'));
    expect(() => parseCatalogWorkspace(d, catalog)).toThrow('неизвестные');
  });
  it('JSON round-trip сохраняет все фабрики; повторный импорт добавляет копии с независимыми ссылками', () => {
    const workspace = fixture();
    workspace.factories.push(createFactory(plan, 'legacy'));
    const imported = parseCatalogWorkspace(JSON.parse(JSON.stringify(workspace)), catalog);
    let id = 0;
    const merged = mergeWorkspace(workspace, imported, () => `import-${++id}`);
    expect(merged.factories.slice(0, 3)).toEqual(workspace.factories);
    expect(merged.worlds).toHaveLength(2);
    expect(merged.factories).toHaveLength(6);
    expect(merged.factories[3].worldId).toBe(merged.worlds[1].id);
    expect(merged.factories[3].plan.world?.id).toBe(merged.worlds[1].id);
    expect(merged.factories[5].plan).toEqual(plan);
  });
  it('гостевое сохранение не затирает legacy draft или изменения другой вкладки', () => {
    const values = new Map([['ficsit-plan-v1', JSON.stringify(plan)]]);
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    const workspace = fixture();
    const raw = saveGuestWorkspace(storage, workspace, null);
    expect(parseCatalogWorkspace(JSON.parse(raw), catalog)).toEqual(workspace);
    expect(storage.getItem('ficsit-plan-v1')).toBe(JSON.stringify(plan));
    storage.setItem(WORKSPACE_KEY, '{corrupt but preserved');
    expect(() => saveGuestWorkspace(storage, workspace, raw)).toThrow('другой вкладке');
    expect(storage.getItem(WORKSPACE_KEY)).toBe('{corrupt but preserved');
  });
});
