import { describe, expect, it } from 'vitest';
import type { Catalog } from '../packages/domain/types';
import type { SchematicModel, SchematicNode } from '../packages/domain/schematic';
import { findNodes } from '../apps/web/src/schematicSearch';
import gameCatalog from '../packages/game-data/catalog.json';

const catalog = gameCatalog as Catalog;
const flow = (itemId: string) => ({ itemId, rate: 10 });
function node(id: string, buildingId: string, label: string, recipeId: string, configuration: string, inputs: string[], outputs: string[]) {
  return { id, kind: 'building', label, buildingId, count: 1, existing: 0, clock: 100, averagePower: 1, peakPower: 1, stage: 1,
    inputs: inputs.map(flow), outputs: outputs.map(flow),
    configurations: [{ id: recipeId, kind: 'production', buildingId, name: configuration, recipeId }] } as unknown as SchematicNode;
}
const graph = { nodes: [
  node('steel', 'foundry', 'Литейная', 'steel-ingot', 'Сталь основная', ['iron-ore', 'coal'], ['steel-ingot']),
  node('wire', 'constructor', 'Конструктор', 'wire', 'Проволока', ['copper-ingot'], ['wire']),
  node('cable', 'constructor', 'Конструктор', 'cable', 'Линия кабеля', ['wire'], ['cable']),
  node('connector', 'manufacturer', 'Производитель', 'high-speed-connector', 'Разъёмы', ['quickwire', 'cable', 'circuit-board'], ['high-speed-connector']),
  node('computer', 'manufacturer', 'Производитель', 'computer', 'Компьютеры', ['circuit-board', 'cable', 'plastic'], ['computer']),
], edges: [], machineCount: 5, warnings: [], cycles: [] } as unknown as SchematicModel;
const order = ['computer', 'steel', 'wire', 'cable', 'connector'];

describe('поиск по схеме', () => {
  it('находит литейную по части названия здания без учёта регистра', () => {
    expect(findNodes(graph, catalog, 'литей', order)).toEqual(['steel']);
    expect(findNodes(graph, catalog, '  ЛИТЕЙ ', order)).toEqual(['steel']);
  });

  it('находит конструктор кабеля и потребителей кабеля в порядке раскладки', () => {
    expect(findNodes(graph, catalog, 'кабель', order)).toEqual(['computer', 'cable', 'connector']);
    expect(findNodes(graph, catalog, 'кабель', [...order].reverse())).toEqual(['connector', 'cable', 'computer']);
  });

  it('ищет по названию рецепта из каталога и по названию конфигурации', () => {
    const insulated = { ...graph, nodes: [node('alt', 'assembler', 'Сборщик', 'alt-cable', 'Линия 2', ['wire', 'rubber'], ['cable'])] };
    expect(findNodes(insulated, catalog, 'изолированный', ['alt'])).toEqual(['alt']);
    expect(findNodes(graph, catalog, 'основная', order)).toEqual(['steel']);
  });

  it('пустая строка и пробелы ничего не находят', () => {
    expect(findNodes(graph, catalog, '', order)).toEqual([]);
    expect(findNodes(graph, catalog, '   ', order)).toEqual([]);
  });

  it('пропускает узлы, которых нет в раскладке', () => {
    expect(findNodes(graph, catalog, 'кабель', ['cable'])).toEqual(['cable']);
  });
});
