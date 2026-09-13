import type { Catalog, ProductResult } from './types';
import type { ConstructionModel } from './construction';
import type { BeltEndpoint, BeltNetwork } from './beltNetwork';

export interface BeltRoutingResult {
  depth: 1 | 2 | 3 | 4;
  networks: BeltNetwork[];
  externalLanes: Record<string, number>;
  deliveryLanes: Record<string, number>;
  sinkCounts: Record<string, number>;
  searchedConfigurations: number;
}
export interface PhysicalBeltEndpoint extends BeltEndpoint {
  itemId: string;
  groupId?: string;
  machineIndex?: number;
  sourceId?: string;
  destination?: 'product' | 'export';
  destinationIndex?: number;
  lane?: number;
}
export const beltEndpointId = (direction: string, group: string, index: number, item: string) => JSON.stringify(['routing', direction, group, index, item]);

/** Rates come from recomputed construction and destinations, never from the witness. */
export function physicalBeltEndpoints(catalog: Catalog, model: ConstructionModel, destinations: { products: ProductResult[]; exports?: ProductResult[] }, routing: BeltRoutingResult): PhysicalBeltEndpoint[] {
  const endpoints: PhysicalBeltEndpoint[] = [];
  const solid = (item: string) => catalog.items.some(i => i.id === item && !i.fluid);
  const lanes = (n: number | undefined) => {
    if (!Number.isSafeInteger(n) || n! < 1 || n! > 100000) throw new Error('Недопустимое число физических конвейеров.');
    return n!;
  };
  for (const group of [...model.production, ...model.extraction, ...model.sinks]) {
    for (const [direction, flows] of [['supply', group.averageOutputs], ['demand', group.averageInputs]] as const) {
      for (const flow of flows.filter(f => solid(f.itemId) && f.rate > 0)) for (let i = 0; i < group.count; i++) {
        endpoints.push({ id: beltEndpointId(direction, group.id, i, flow.itemId), direction, itemId: flow.itemId, rate: flow.rate / group.count, groupId: group.id, machineIndex: i });
      }
    }
  }
  for (const source of model.externalSources.filter(s => solid(s.itemId) && s.rate > 0)) {
    const count = lanes(routing.externalLanes[source.sourceId]);
    for (let i = 0; i < count; i++) endpoints.push({ id: beltEndpointId('supply', `external:${source.sourceId}`, i, source.itemId), direction: 'supply', itemId: source.itemId, rate: source.rate / count, sourceId: source.sourceId, lane: i });
  }
  for (const [destination, flows] of [['product', destinations.products], ['export', destinations.exports ?? []]] as const) {
    flows.forEach((flow, index) => {
      if (!solid(flow.itemId) || flow.rate <= 0) return;
      const group = destination === 'export' ? `export:${flow.itemId}` : `product:${index}`, count = lanes(routing.deliveryLanes[group]);
      for (let i = 0; i < count; i++) endpoints.push({ id: beltEndpointId('demand', group, i, flow.itemId), direction: 'demand', itemId: flow.itemId, rate: flow.rate / count, destination, destinationIndex: index, lane: i });
    });
  }
  return endpoints;
}
