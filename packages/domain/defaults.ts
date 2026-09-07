import type { Catalog, Plan } from './types';
export function createDefaultPlan(catalog: Catalog): Plan {
  const target = catalog.items.find(i => i.id === 'reinforced-iron-plate') ?? catalog.items.find(i => !i.raw) ?? catalog.items[0];
  const ore = catalog.items.find(i => i.id === 'iron-ore') ?? catalog.items.find(i => i.raw) ?? catalog.items[0];
  return {
    schemaVersion: 1, catalogVersion: catalog.version, name: 'Моя первая фабрика', mode: 'maximize', policy: 'proportional',
    targets: [{ itemId: target.id, rate: 10, weight: 1, scale: 1 }],
    sources: [{ id: 'iron-node', itemId: ore.id, kind: 'node', limit: null, count: 1, purity: 1, minerId: catalog.miners.find(m => m.id === 'miner-mk2')?.id ?? catalog.miners[0].id, clock: 100 }],
    settings: {
      enabledRecipeIds: catalog.recipes.filter(r => !r.alternate).map(r => r.id), enabledBuildingIds: catalog.buildings.map(b => b.id),
      beltId: catalog.belts.find(b => b.id === 'belt3')?.id ?? catalog.belts[0].id,
      pipeId: catalog.pipes[0].id, clock: 100, resourcePolicy: 'listed-only', objective: 'smooth-power', powerLimit: null,
      outputSlack: 0, allowSink: false, resourceWeights: {},
    },
  };
}
