import { describe, expect, it } from 'vitest';
import catalogJson from '../packages/game-data/catalog.json';
import type { Catalog } from '../packages/domain/types';
import { createDefaultPlan } from '../packages/domain/defaults';
import { createFactory, createWorld, emptyWorkspace, snapshotWorld } from '../packages/domain/worlds';
import { parsePlan } from '../packages/domain/validation';
import { applyRecipeSetup, prepareRecipeSetup, prepareWorkspaceRecipeSetup } from '../packages/domain/recipeProgress';
import { exportRecipeSettings, parseRecipeSettings, prepareRecipeSettingsImport } from '../packages/domain/recipeSettingsFile';

const catalog = catalogJson as Catalog;
const roundTrip = (value: unknown) => JSON.parse(JSON.stringify(value));
function configuredPlan() {
  const base = createDefaultPlan(catalog);
  const plan = applyRecipeSetup(base, prepareRecipeSetup(catalog, base, ['Schematic_1-1_C', 'Research_Quartz_2_C'], 'replace', 'none'));
  plan.settings.enabledRecipeIds = [...plan.settings.enabledRecipeIds, 'alt-screw'];
  plan.settings.enabledBuildingIds = plan.settings.enabledBuildingIds.filter(id => id !== 'smelter');
  plan.settings.beltId = catalog.belts[2].id; plan.settings.clock = 150;
  plan.settings.buildingLimits = { constructor: 4 };
  return plan;
}

describe('файл настройки рецептов', () => {
  it('экспортирует прогресс, рецепты с альтернативными и технологии', () => {
    const plan = configuredPlan();
    const file = exportRecipeSettings(catalog, plan, new Date('2026-10-03T00:00:00Z'));
    expect(file).toMatchObject({ format: 'ficsit-recipe-settings', version: 1, catalogVersion: catalog.version, name: plan.name, exportedAt: '2026-10-03T00:00:00.000Z' });
    expect(file.progress.unlockIds).toEqual(['Schematic_1-1_C', 'Research_Quartz_2_C']);
    expect(file.recipes.enabledRecipeIds).toEqual(plan.settings.enabledRecipeIds);
    expect(file.recipes.enabledRecipeIds).toContain('alt-screw');
    expect(file.technologies).toEqual({ enabledBuildingIds: plan.settings.enabledBuildingIds, beltId: catalog.belts[2].id, pipeId: plan.settings.pipeId, clock: 150, buildingLimits: { constructor: 4 } });
    expect(parseRecipeSettings(roundTrip(file), catalog)).toEqual(file);
  });
  it('импорт заменяет настройку, сохраняет заказ, источники и энергию', () => {
    const source = configuredPlan();
    const file = parseRecipeSettings(roundTrip(exportRecipeSettings(catalog, source)), catalog);
    const target = createDefaultPlan(catalog);
    target.targets = [{ itemId: 'screw', rate: 30, weight: 1, scale: 1 }]; target.settings.powerLimit = 200;
    const setup = prepareRecipeSettingsImport(catalog, target, file);
    expect(setup.importedFrom).toEqual({ name: source.name, catalogVersion: catalog.version, exportedAt: file.exportedAt });
    const next = applyRecipeSetup(target, setup);
    expect(next.recipeProgress).toEqual({ unlockIds: file.progress.unlockIds });
    expect(next.settings.enabledRecipeIds).toEqual(source.settings.enabledRecipeIds);
    expect(next.settings.enabledBuildingIds).toEqual(source.settings.enabledBuildingIds);
    expect([next.settings.beltId, next.settings.pipeId, next.settings.clock]).toEqual([source.settings.beltId, source.settings.pipeId, 150]);
    expect(next.settings.buildingLimits).toEqual({ constructor: 4 });
    expect(next.targets).toEqual(target.targets); expect(next.sources).toEqual(target.sources);
    expect(next.settings.powerLimit).toBe(200); expect(next.settings.objective).toBe(target.settings.objective);
    expect(parsePlan(roundTrip(next))).toEqual(next);
    // Повторный экспорт импортированного плана воспроизводит содержание файла.
    const { exportedAt: _a, ...again } = exportRecipeSettings(catalog, next);
    const { exportedAt: _b, ...original } = file;
    expect(again).toEqual(original);
  });
  it('отсутствие лимитов в файле снимает прежние лимиты', () => {
    const file = exportRecipeSettings(catalog, createDefaultPlan(catalog));
    expect(file.technologies.buildingLimits).toBeUndefined();
    const target = configuredPlan();
    expect(applyRecipeSetup(target, prepareRecipeSettingsImport(catalog, target, file)).settings.buildingLimits).toBeUndefined();
  });
  it('отклоняет чужие форматы, неизвестные ID и не-HUB/MAM прогресс', () => {
    const file = roundTrip(exportRecipeSettings(catalog, configuredPlan()));
    expect(() => parseRecipeSettings(roundTrip(createDefaultPlan(catalog)), catalog)).toThrow(/не файл настройки рецептов/);
    expect(() => parseRecipeSettings({ ...file, version: 2 }, catalog)).toThrow(/Некорректный файл/);
    expect(() => parseRecipeSettings({ ...file, extra: true }, catalog)).toThrow(/Некорректный файл/);
    expect(() => parseRecipeSettings({ ...file, recipes: { enabledRecipeIds: ['screw', 'screw'] } }, catalog)).toThrow(/Некорректный файл/);
    expect(() => parseRecipeSettings({ ...file, recipes: { enabledRecipeIds: ['no-such-recipe'] } }, catalog)).toThrow(/рецепты \(no-such-recipe\)/);
    expect(() => parseRecipeSettings({ ...file, technologies: { ...file.technologies, beltId: 'warp-belt' } }, catalog)).toThrow(/конвейер/);
    const disk = catalog.unlocks!.find(u => u.sourceType === 'EST_Alternate')!;
    expect(() => parseRecipeSettings({ ...file, progress: { unlockIds: [disk.id] } }, catalog)).toThrow(/этапы HUB или исследования MAM/);
  });
  it('допускает файл другой версии каталога, если все ID известны', () => {
    const file = { ...roundTrip(exportRecipeSettings(catalog, configuredPlan())), catalogVersion: 'older-build' };
    const setup = prepareRecipeSettingsImport(catalog, createDefaultPlan(catalog), parseRecipeSettings(file, catalog));
    expect(setup.importedFrom!.catalogVersion).toBe('older-build');
  });
  it('в мире экспортирует только открытое и открывает импортированное после просмотра', () => {
    const world = createWorld(catalog, 'Мир', 'w1');
    const opened = { ...world, unlockedRecipeIds: ['iron-ingot', 'iron-plate'], unlockedBuildingIds: ['smelter', 'constructor'], unlockedMilestoneIds: ['Schematic_1-1_C', 'p2:resource-wells'] };
    const worldPlan = createDefaultPlan(catalog);
    worldPlan.world = snapshotWorld(opened);
    worldPlan.settings.enabledRecipeIds = ['iron-ingot', 'iron-plate', 'alt-screw'];
    const file = exportRecipeSettings(catalog, worldPlan);
    expect(file.progress.unlockIds).toEqual(['Schematic_1-1_C']);
    expect(file.recipes.enabledRecipeIds).toEqual(['iron-ingot', 'iron-plate']);
    expect(file.technologies.enabledBuildingIds.every(id => opened.unlockedBuildingIds.includes(id))).toBe(true);

    const other = configuredPlan(); other.world = snapshotWorld(world);
    const factory = createFactory(other, 'f1', world);
    const workspace = { ...emptyWorkspace(catalog.version), worlds: [world], factories: [factory] };
    const imported = parseRecipeSettings(roundTrip(exportRecipeSettings(catalog, configuredPlan())), catalog);
    const setup = prepareRecipeSettingsImport(catalog, factory.plan, imported);
    const update = prepareWorkspaceRecipeSetup(workspace, factory.plan, setup, 'f1');
    const savedWorld = update.workspace.worlds[0];
    expect(savedWorld.unlockedRecipeIds).toEqual(expect.arrayContaining(imported.recipes.enabledRecipeIds));
    expect(savedWorld.unlockedBuildingIds).toEqual(expect.arrayContaining(imported.technologies.enabledBuildingIds));
    expect(savedWorld.unlockedMilestoneIds).toEqual(expect.arrayContaining(imported.progress.unlockIds));
    expect(savedWorld.overclockUnlocked).toBe(true);
    expect(update.plan.settings.enabledRecipeIds).toEqual(imported.recipes.enabledRecipeIds);
    expect(update.workspace.factories[0].plan.settings.clock).toBe(150);
    expect(update.workspace.factories[0].plan.targets).toEqual(factory.plan.targets);
  });
});
