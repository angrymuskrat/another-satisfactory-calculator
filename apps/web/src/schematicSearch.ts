import type { Catalog } from '../../../packages/domain/types';
import type { SchematicModel } from '../../../packages/domain/schematic';
import { normalize } from './controls';
import { searchNames } from './i18n/gameNames';

/** Nodes whose building, recipe, configuration or input/output item names contain
 * the query, ignoring case; the result follows `order` and skips ids missing from it. */
export function findNodes(graph: SchematicModel, catalog: Catalog, query: string, order: string[]): string[] {
  const needle = normalize(query.trim());
  if (!needle) return [];
  const items = new Map(catalog.items.map(i => [i.id, searchNames('item', i.id, i.name)]));
  const recipes = new Map(catalog.recipes.map(r => [r.id, searchNames('recipe', r.id, r.name)]));
  const buildings = new Map(catalog.buildings.map(b => [b.id, searchNames('building', b.id, b.name)]));
  const hits = new Set(graph.nodes.filter(n => [
    n.label, n.buildingId && buildings.get(n.buildingId), n.itemId && items.get(n.itemId),
    ...n.configurations.flatMap(g => [g.name, g.recipeId && recipes.get(g.recipeId)]),
    ...[...n.inputs, ...n.outputs].map(f => items.get(f.itemId) ?? f.itemId),
  ].some(text => text && normalize(text).includes(needle))).map(n => n.id));
  return order.filter(id => hits.has(id));
}
