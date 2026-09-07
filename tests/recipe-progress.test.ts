import { describe, expect, it } from 'vitest';
import catalogJson from '../packages/game-data/catalog.json';
import type { Catalog, Unlock } from '../packages/domain/types';
import { createDefaultPlan } from '../packages/domain/defaults';
import { createWorld, snapshotWorld, createFactory, emptyWorkspace, parseWorkspace } from '../packages/domain/worlds';
import { parsePlan } from '../packages/domain/validation';
import { parseCatalogPlan } from '../packages/domain/worldPlanValidation';
import { buildRecipeProgress, prepareRecipeSetup, prepareDiskSetup, applyRecipeSetup, prepareWorkspaceRecipeSetup } from '../packages/domain/recipeProgress';

const catalog = catalogJson as Catalog;
const hub = (tier: number) => ['Schematic_StartingRecipes_C', ...catalog.unlocks!.filter(u => u.kind === 'hub' && u.tier !== undefined && u.tier <= tier).map(u => u.id)];
describe('быстрая настройка рецептов', () => {
  it('заменяет набор, раскрывает дочерние схемы и сохраняет заказ, источники и цель', () => {
    const plan = createDefaultPlan(catalog);
    const setup = prepareRecipeSetup(catalog, plan, ['Schematic_5-1_C'], 'replace', 'none');
    const next = applyRecipeSetup(plan, setup);
    expect(next.settings.enabledRecipeIds).toContain('plastic');
    expect(next.settings.enabledRecipeIds).not.toContain('iron-plate');
    expect(next.settings.enabledRecipeIds.every(id => !catalog.recipes.find(r => r.id === id)!.alternate)).toBe(true);
    expect(next.settings.enabledBuildingIds).toContain('oil-refinery');
    expect(next.targets).toEqual(plan.targets); expect(next.sources).toEqual(plan.sources);
    expect(next.settings.objective).toBe(plan.settings.objective);
    expect(parsePlan(JSON.parse(JSON.stringify(next)))).toEqual(next);
  });
  it('добавление монотонно и повторное применение не создаёт дубликаты', () => {
    const plan = createDefaultPlan(catalog); plan.settings.enabledRecipeIds = ['screw'];
    const setup = prepareRecipeSetup(catalog, plan, hub(0), 'add', 'none');
    const next = applyRecipeSetup(plan, setup);
    expect(next.settings.enabledRecipeIds).toContain('screw');
    expect(next.settings.enabledRecipeIds).toContain('iron-plate');
    expect(applyRecipeSetup(next, prepareRecipeSetup(catalog, next, hub(0), 'add', 'none'))).toEqual(next);
  });
  it('MAM работает без HUB, не покупает предков, сохраняется при загрузке', () => {
    const plan = createDefaultPlan(catalog);
    const next = applyRecipeSetup(plan, prepareRecipeSetup(catalog, plan, ['Research_Quartz_2_C'], 'replace', 'none'));
    expect(next.settings.enabledRecipeIds).toContain('crystal-oscillator');
    expect(next.recipeProgress!.unlockIds).toEqual(['Research_Quartz_2_C']);
    expect(parsePlan(JSON.parse(JSON.stringify(next))).recipeProgress).toEqual(next.recipeProgress);
  });
  it('различает диски и альтернативные рецепты MAM', () => {
    const index = buildRecipeProgress(catalog);
    expect(index.get('alt-screw')!.sources).toContain('hard-drive');
    expect(index.get('turbofuel')!.sources).toContain('mam');
    expect(index.get('turbofuel')!.sources).not.toContain('hard-drive');
    expect(index.get('silica')!.treeIds).toContain('BPD_ResearchTree_Quartz_C');
  });
  it('диски учитывают независимый MAM и не отмечаются изученными автоматически', () => {
    const plan = createDefaultPlan(catalog);
    const before = prepareRecipeSetup(catalog, plan, hub(2), 'replace', 'all');
    const after = prepareRecipeSetup(catalog, plan, [...hub(2), 'Research_Caterium_0_C'], 'replace', 'all');
    expect(before.plan.settings.enabledRecipeIds).not.toContain('alt-caterium-wire');
    expect(after.plan.settings.enabledRecipeIds).toContain('alt-caterium-wire');
    expect(after.plan.recipeProgress!.unlockIds).not.toContain('Schematic_Alternate_Wire2_C');
  });
  it('неизвестные условия не считаются выполненными; AND групп и OR внутри', () => {
    const fake = structuredClone(catalog);
    const disk = fake.unlocks!.find(u => u.recipeIds.includes('alt-screw'))!;
    disk.selectionDependenciesKnown = true; disk.prerequisiteGroups = [['Schematic_1-1_C', 'Research_Caterium_0_C'], ['Research_Quartz_2_C']];
    const plan = createDefaultPlan(fake);
    expect(prepareRecipeSetup(fake, plan, ['Research_Caterium_0_C'], 'replace', 'all').plan.settings.enabledRecipeIds).not.toContain('alt-screw');
    expect(prepareRecipeSetup(fake, plan, ['Research_Caterium_0_C', 'Research_Quartz_2_C'], 'replace', 'all').plan.settings.enabledRecipeIds).toContain('alt-screw');
    disk.selectionDependenciesKnown = false;
    const unknown = prepareRecipeSetup(fake, plan, ['Research_Caterium_0_C', 'Research_Quartz_2_C'], 'replace', 'all');
    expect(unknown.plan.settings.enabledRecipeIds).not.toContain('alt-screw');
    expect(unknown.unknownAlternatives).toContain('alt-screw');
  });
  it('сохранение альтернатив при замене и отсутствие новых альтернатив при добавлении', () => {
    const plan = createDefaultPlan(catalog); plan.settings.enabledRecipeIds = ['alt-screw', 'turbofuel'];
    expect(prepareRecipeSetup(catalog, plan, [], 'replace', 'keep').plan.settings.enabledRecipeIds).toEqual(plan.settings.enabledRecipeIds);
    expect(prepareRecipeSetup(catalog, plan, [], 'replace', 'none').plan.settings.enabledRecipeIds).toEqual([]);
    expect(prepareRecipeSetup(catalog, plan, [], 'add', 'none').plan.settings.enabledRecipeIds).toEqual(plan.settings.enabledRecipeIds);
  });
  it('поздняя альтернатива сортируется после раннего продукта, неизвестное — внизу', () => {
    const index = buildRecipeProgress(catalog);
    expect(index.get('alt-steel-screw')!.tier).toBeGreaterThan(index.get('screw')!.tier!);
    const fake = structuredClone(catalog); fake.recipes.push({ ...fake.recipes[0], id: 'unknown' });
    expect(buildRecipeProgress(fake).get('unknown')!.section).toBe('Неизвестное место в прогрессе');
  });
  it('дочерние рецепты наследуют этап и источник, а режим всех дисков не сохраняет поздние при замене', () => {
    const index = buildRecipeProgress(catalog);
    expect(index.get('plastic')!.tier).toBe(5);
    expect(index.get('alt-distilled-silica')!.sources).toEqual(['hard-drive']);
    expect(index.get('turbofuel')!.sources).toEqual(['mam']);
    const plan = createDefaultPlan(catalog); plan.settings.enabledRecipeIds.push('alt-steel-screw');
    expect(prepareRecipeSetup(catalog, plan, hub(0), 'replace', 'all').plan.settings.enabledRecipeIds).not.toContain('alt-steel-screw');
  });
  it('просмотр мира атомарен, сохраняет чужие запреты и не сохраняет черновой заказ текущей фабрики', () => {
    const world = createWorld(catalog, 'Общий', 'w');
    const original = createDefaultPlan(catalog);
    const workspace = { ...emptyWorkspace(catalog.version), worlds: [world], factories: [createFactory(original, 'a', world), createFactory(original, 'b', world)] };
    workspace.factories[1].plan.settings.enabledRecipeIds = [];
    const current = structuredClone(workspace.factories[0].plan); current.targets[0].rate = 123;
    const setup = prepareRecipeSetup(catalog, current, hub(0), 'replace', 'none');
    const update = prepareWorkspaceRecipeSetup(workspace, current, setup, 'a');
    expect(world.unlockedRecipeIds).toEqual([]);
    expect(update.workspace.factories[1].plan.settings.enabledRecipeIds).toEqual([]);
    expect(update.workspace.factories[0].plan.targets).toEqual(original.targets);
    expect(update.plan.targets[0].rate).toBe(123);
    expect(update.plan.world!.revision).toBe(2);
    expect(parseWorkspace(JSON.parse(JSON.stringify(update.workspace)))).toEqual(update.workspace);
    expect(() => prepareWorkspaceRecipeSetup(update.workspace, current, setup, 'a')).toThrow(/устарел|изменил/);
  });
  it('устаревший просмотр не перезаписывает изменённый план', () => {
    const plan = createDefaultPlan(catalog), setup = prepareRecipeSetup(catalog, plan, hub(0), 'replace', 'none');
    expect(() => applyRecipeSetup({ ...plan, name: 'Изменено' }, setup)).toThrow(/изменил|устарел/);
  });
  it('добавление только дисков не включает выключенные обычные рецепты и не меняет технологии', () => {
    const plan = createDefaultPlan(catalog); plan.settings.enabledRecipeIds = [];
    const next = prepareDiskSetup(catalog, plan, hub(2)).plan;
    expect(next.settings.enabledRecipeIds).toContain('alt-screw');
    expect(next.settings.enabledRecipeIds).not.toContain('iron-plate');
    expect(next.settings.enabledBuildingIds).toEqual(plan.settings.enabledBuildingIds);
    expect(next.settings.beltId).toEqual(plan.settings.beltId);
    expect(next.recipeProgress).toBeUndefined();
  });
  it('проверяет ссылки выбранного прогресса при загрузке каталога', () => {
    const plan = createDefaultPlan(catalog); plan.recipeProgress = { unlockIds: ['missing'] };
    expect(() => parseCatalogPlan(plan, catalog)).toThrow(/неизвестные схемы/);
  });
  it('создание мира из настроенного плана сохраняет выбранный прогресс', () => {
    const plan = createDefaultPlan(catalog); plan.recipeProgress = { unlockIds: ['Research_Quartz_2_C'] };
    expect(createWorld(catalog, 'Копия', 'copy', plan).unlockedMilestoneIds).toContain('Research_Quartz_2_C');
  });
});
