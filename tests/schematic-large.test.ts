import { beforeAll, expect, it } from 'vitest';
import type { Catalog, ProductionVariant } from '../packages/domain/types';
import { buildConstruction } from '../packages/domain/construction';
import { buildSchematic, filterSchematicFlows } from '../packages/domain/schematic';
import { createHighs } from '../packages/solver/highs';
import { findWorkingPlans } from '../packages/solver/workingPlans';
import { layoutBoth } from '../apps/web/src/schematicElk';
import gameCatalog from '../packages/game-data/catalog.json';
import { largeOrder } from './largeOrderFixture';
import { expectColumnOrderKept, expectEdgesAvoidNodes, expectNoOverlap } from './schematicFixtures';

const catalog = gameCatalog as Catalog;
let highs: Awaited<ReturnType<typeof createHighs>>;
beforeAll(async () => { highs = await createHighs(); });

it('раскладывает схему большого заказа компактно и без пересечений', async () => {
  const published: ProductionVariant[] = [];
  findWorkingPlans(catalog, largeOrder(catalog), highs, performance.now() + 60_000, v => published.push(v));
  const variant = published.find(v => v.id === 'working-machines');
  expect(variant).toBeDefined();
  const { plan, result } = variant!;
  const construction = buildConstruction(catalog, plan, result);
  const graph = filterSchematicFlows(buildSchematic(catalog, construction, { products: result.products, exports: result.exports }, 'types'));
  const started = performance.now();
  const { medium: layout, close } = await layoutBoth(graph);
  console.info(`large schematic: ${graph.nodes.length} nodes, ${graph.edges.length} edges, medium ${layout.width}x${layout.height}, `
    + `close ${close.width}x${close.height}, share ${(layout.width * layout.height / (10340 * 22217)).toFixed(3)}, `
    + `both layouts ${Math.round(performance.now() - started)} ms`);
  expect(graph.nodes.filter(n => n.kind === 'merge' || n.kind === 'split')).toHaveLength(0);
  expect(layout.width * layout.height).toBeLessThanOrEqual(0.15 * 10340 * 22217);
  expectNoOverlap(layout.rects);
  expectEdgesAvoidNodes(graph, layout);
  expectNoOverlap(close.rects);
  expectEdgesAvoidNodes(graph, close);
  for (const e of graph.edges) for (const l of [layout, close]) expect(l.bends[e.id]?.length).toBeGreaterThanOrEqual(2);
  expectColumnOrderKept(layout, close);
}, 120_000);
