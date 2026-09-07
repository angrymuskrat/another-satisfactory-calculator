import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import catalogJson from '../packages/game-data/catalog.json';
import type { Catalog, ResearchNode, Unlock } from '../packages/domain/types';
import { createDefaultPlan } from '../packages/domain/defaults';
import { createWorld, grantWorldUnlocks } from '../packages/domain/worlds';
import { prerequisiteState, researchChain, researchDescription, recipeResearchReasons, phaseForTier } from '../packages/domain/research';

const base = catalogJson as Catalog;
const node = (id: string, parents: (string | null)[] = [], groups: string[][] = []): ResearchNode => ({ schematicId: id, name: id, parents, unhiddenBy: [], unresolvedCoordinates: parents.includes(null) ? [[3, 1]] : [], prerequisiteGroups: groups });
const unlock = (id: string, recipeIds: string[] = []): Unlock => ({ id, name: id, kind: 'mam', recipeIds, buildingIds: [], beltIds: [], pipeIds: [], overclock: false, prerequisiteIds: [], prerequisitesKnown: false });
const fixture = (): Catalog => ({ ...base, researchNames: { a: 'Начало', b: 'Ветвь', c: 'Результат' }, unlocks: [unlock('a'), unlock('b'), unlock('c', ['iron-ingot'])], researchTrees: [{ id: 'tree', name: 'Ветка MAM', seasonal: false, conditions: ['Подбор предмета не отслеживается.'], nodes: [node('a'), node('b'), node('c', ['a', 'b'])] }], gamePhases: [{ id: 'phase0', name: 'Инструктаж', lastTier: 2 }, { id: 'phase1', name: 'Платформа', lastTier: 4 }, { id: 'phase2', name: 'Док', lastTier: 6 }] });

describe('справочный граф исследований', () => {
  it('для родителей использует ИЛИ, а неизвестная координата не означает выполнение', () => {
    expect(prerequisiteState(['a', 'b'], ['b'])).toBe('satisfied');
    expect(prerequisiteState(['a', null], [])).toBe('unknown');
    expect(prerequisiteState(['a', null], ['a'])).toBe('satisfied');
    expect(prerequisiteState(['a'], [])).toBe('pending');
    expect(prerequisiteState([], [])).toBe('satisfied');
  });
  it('объясняет отдельные AND-of-OR условия Docs и сохраняет неизвестность полного доступа', () => {
    const catalog = fixture(); catalog.researchTrees![0].nodes[2] = node('c', ['a', null], [['a', 'b'], ['other']]);
    const description = researchDescription(catalog, 'c', ['b']);
    expect(description.join(' ')).toContain('Начало ИЛИ Ветвь');
    expect(description.join(' ')).toContain('other');
    expect(description.join(' ')).toContain('неизвестная связь');
    expect(description.join(' ')).toContain('не подтверждает доступность');
  });
  it('разворачивает все ветви один раз, останавливается на циклах и выполненных узлах', () => {
    const catalog = fixture(); catalog.researchTrees![0].nodes[0].parents = ['c'];
    const chain = researchChain(catalog, ['c'], []);
    expect(chain.steps.map(s => s.id).sort()).toEqual(['a', 'b', 'c']);
    expect(chain.cycles).toContain('c');
    expect(researchChain(catalog, ['c'], ['c']).steps.map(s => s.id)).toEqual(['c']);
  });
  it('объясняет закрытый рецепт через предков без автоматической покупки исследований', () => {
    const catalog = fixture(); const world = createWorld(catalog, 'Мир', 'world');
    const text = recipeResearchReasons(catalog, 'iron-ingot', []).join(' ');
    expect(text).toContain('Начало'); expect(text).toContain('Ветвь'); expect(text).toContain('Результат');
    const next = grantWorldUnlocks(catalog, world, ['c']);
    expect(next.unlockedMilestoneIds).toEqual(['c']);
    expect(next.unlockedRecipeIds).toContain('iron-ingot');
    expect(world.unlockedMilestoneIds).toEqual([]);
    expect(createDefaultPlan(catalog).world).toBeUndefined();
  });
  it('показывает фазу для HUB по верхней границе tier, не подтверждая её завершение', () => {
    const catalog = fixture();
    expect(phaseForTier(catalog, 2)?.id).toBe('phase0');
    expect(phaseForTier(catalog, 3)?.id).toBe('phase1');
    expect(phaseForTier(catalog, 5)?.id).toBe('phase2');
    expect(phaseForTier(catalog, 99)).toBeUndefined();
  });
  it('импортирует закреплённые ветки, сезонные узлы и пять неизвестных связей без потери условий', async () => {
    const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
    const source = read('packages/game-data/source/research-assets.json');
    const progression = read('packages/game-data/progression.json');
    const catalog = structuredClone(base);
    const report = { notes: [] };
    const docs = (lang: string) => JSON.parse(gunzipSync(readFileSync(`packages/game-data/source/Docs-${lang}.json.gz`)).toString('utf16le').replace(/^\uFEFF/, '')).flatMap((group: { Classes: { ClassName: string }[] }) => group.Classes);
    const en = docs('en-US');
    const ru = new Map(docs('ru').map((record: { ClassName: string }) => [record.ClassName, record]));
    const pinned = read('packages/game-data/source/provenance.json');
    const { importResearchAssets } = await import('../scripts/' + 'import-research-assets.mjs');
    importResearchAssets({ source, catalog, progression, report, en, ru, pinned });
    expect(catalog.researchTrees).toHaveLength(10);
    expect(catalog.gamePhases).toHaveLength(8);
    const nodes = catalog.researchTrees!.flatMap(t => t.nodes);
    expect(nodes).toHaveLength(110);
    expect(nodes.filter(n => n.unresolvedCoordinates.length)).toHaveLength(5);
    expect(catalog.researchTrees!.filter(t => t.seasonal).flatMap(t => t.nodes)).toHaveLength(13);
    expect(nodes.find(n => n.schematicId === 'Research_Quartz_2_C')!.parents).toContain(null);
    expect(catalog.unlocks!.some(u => u.prerequisitesKnown)).toBe(false);
    expect(recipeResearchReasons(catalog, 'silica', []).join(' ')).toContain('Кремнезём');
    expect(report.notes).toEqual(catalog.provenance.notes);
    source.provenance.mappingVerification.verified = false;
    expect(() => importResearchAssets({ source, catalog, progression, report, en, ru, pinned })).toThrow('Сопоставление типов');
  });
});
