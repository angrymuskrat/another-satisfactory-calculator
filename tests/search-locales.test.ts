import { describe, expect, it } from 'vitest';
import type { Catalog } from '../packages/domain/types';
import type { SchematicModel, SchematicNode } from '../packages/domain/schematic';
import { matchesRecipe } from '../apps/web/src/recipeCatalog';
import { matchesItem, normalize } from '../apps/web/src/controls';
import { findNodes } from '../apps/web/src/schematicSearch';
import { gameName, nameCollator, searchNames } from '../apps/web/src/i18n/gameNames';
import gameCatalog from '../packages/game-data/catalog.json';

const catalog = gameCatalog as Catalog;
const recipeIds = (query: string) => catalog.recipes.filter(r => matchesRecipe(catalog, r, query, 'all')).map(r => r.id);

describe('поиск рецептов на двух языках', () => {
  it('«iron plate» и «железная пластина» находят один и тот же набор рецептов, включая iron-plate', () => {
    const english = recipeIds('iron plate');
    expect(english).toContain('iron-plate');
    expect(english).toEqual(recipeIds('железная пластина'));
  });

  it('регистр русского запроса не влияет на результат', () => {
    expect(recipeIds('ЖЕЛЕЗНАЯ')).toEqual(recipeIds('железная'));
    expect(recipeIds('железная').length).toBeGreaterThan(0);
  });

  it('ё и е равнозначны в запросе и в названии из каталога', () => {
    const plate = catalog.recipes.find(r => r.id === 'alt-adhered-iron-plate')!;
    expect(plate.name).toContain('ё');
    expect(matchesRecipe(catalog, plate, 'скреплённая', 'all')).toBe(true);
    expect(matchesRecipe(catalog, plate, 'скрепленная', 'all')).toBe(true);
    expect(normalize('ЁЛКА')).toBe(normalize('елка'));
  });
});

describe('выбор предмета', () => {
  const biofuel = catalog.items.find(i => i.id === 'solid-biofuel')!;
  it('находит предмет по английскому и русскому названию, с ё и без', () => {
    expect(matchesItem(biofuel, 'solid biofuel')).toBe(true);
    expect(matchesItem(biofuel, 'ТВЁРДОЕ')).toBe(true);
    expect(matchesItem(biofuel, 'твердое')).toBe(true);
    expect(matchesItem(biofuel, 'железная')).toBe(false);
  });
});

describe('поиск узла схемы по английскому названию', () => {
  const flow = (itemId: string) => ({ itemId, rate: 10 });
  const node = { id: 'smelter', kind: 'building', label: 'Литейная', buildingId: 'foundry', count: 1, existing: 0, clock: 100, averagePower: 1, peakPower: 1, stage: 1,
    inputs: [flow('iron-ore')], outputs: [flow('iron-ingot')],
    configurations: [{ id: 'iron-ingot', kind: 'production', buildingId: 'foundry', name: 'Слиток', recipeId: 'iron-ingot' }] } as unknown as SchematicNode;
  const graph = { nodes: [node], edges: [], machineCount: 1, warnings: [], cycles: [] } as unknown as SchematicModel;
  it('«iron ore» и «Foundry» находят узел, русский запрос по-прежнему работает', () => {
    expect(findNodes(graph, catalog, 'iron ore', ['smelter'])).toEqual(['smelter']);
    expect(findNodes(graph, catalog, 'FOUNDRY', ['smelter'])).toEqual(['smelter']);
    expect(findNodes(graph, catalog, 'железная руда', ['smelter'])).toEqual(['smelter']);
    expect(findNodes(graph, catalog, 'iron plate', ['smelter'])).toEqual([]);
  });
  it('ё в запросе равна е в названии метки узла', () => {
    const custom = { nodes: [{ ...node, label: 'Разъёмы' }], edges: [], machineCount: 1, warnings: [], cycles: [] } as unknown as SchematicModel;
    expect(findNodes(custom, catalog, 'разъемы', ['smelter'])).toEqual(['smelter']);
  });
});

describe('searchNames', () => {
  it('отдаёт название активного языка, русское и английское по одному разу', () => {
    const names = searchNames('item', 'iron-plate', 'x').split(' ');
    expect(searchNames('item', 'iron-plate', 'x')).toBe('Железная пластина Iron Plate');
    expect(names.filter(w => w === 'Железная')).toHaveLength(1);
  });
  it('совпадающие названия не дублируются, неизвестный id даёт запасное название', () => {
    expect(searchNames('item', 'no-such-item', 'Запас')).toBe('Запас');
  });
});

describe('алфавитная сортировка', () => {
  it('для русского языка порядок по gameName равен прежнему localeCompare(…, "ru") по названию каталога', () => {
    const collator = nameCollator();
    const before = [...catalog.recipes].sort((a, b) => a.name.localeCompare(b.name, 'ru') || a.id.localeCompare(b.id)).map(r => r.id);
    const after = [...catalog.recipes].sort((a, b) => collator.compare(gameName('recipe', a.id, a.name), gameName('recipe', b.id, b.name)) || a.id.localeCompare(b.id)).map(r => r.id);
    expect(after).toEqual(before);
    const unlocks = catalog.unlocks ?? [];
    const oldUnlocks = [...unlocks].sort((a, b) => a.name.localeCompare(b.name, 'ru')).map(u => u.id);
    const newUnlocks = [...unlocks].sort((a, b) => collator.compare(gameName('schematic', a.id, a.name), gameName('schematic', b.id, b.name))).map(u => u.id);
    expect(newUnlocks).toEqual(oldUnlocks);
  });
});
