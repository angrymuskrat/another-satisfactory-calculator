import type { Catalog } from './types';
import map from '../game-data/source/map-resources.json' with { type: 'json' };
import mechanics from '../game-data/p2-mechanics.json' with { type: 'json' };

type Purities = { impure: number; normal: number; pure: number };
const purity = { impure: 0.5, normal: 1, pure: 2 } as const;
const MAX_CLOCK = 2.5;
/** The smallest weight accepted by the planner; used for resources the map does not limit. */
export const UNLIMITED_WEIGHT = 0.000001;
export const mapResourceProvenance = map.provenance;

const total = (counts: Purities | undefined, perNode: (multiplier: number) => number) =>
  counts ? (Object.keys(purity) as (keyof Purities)[]).reduce((sum, key) => sum + counts[key] * perNode(purity[key]), 0) : 0;

/** Map extraction limit per minute: best extractor at 250%, capped by the fastest belt/pipe per output. null — not limited by the map. */
export function mapResourceLimits(catalog: Catalog): Record<string, number | null> {
  const limits: Record<string, number | null> = {};
  for (const item of catalog.items.filter(i => i.raw)) {
    if (map.unlimited.includes(item.id)) { limits[item.id] = null; continue; }
    const transport = Math.max(...(item.fluid ? catalog.pipes : catalog.belts).map(t => t.rate));
    const miner = catalog.miners.filter(m => m.resourceIds.includes(item.id)).sort((a, b) => b.rate - a.rate)[0];
    const nodes = miner ? total((map.nodes as Record<string, Purities>)[item.id], multiplier => Math.min(transport, miner.rate * multiplier * MAX_CLOCK)) : 0;
    const wells = mechanics.well.resourceIds.includes(item.id)
      ? total((map.wellSatellites as Record<string, Purities>)[item.id], multiplier => Math.min(transport, mechanics.well.rate * multiplier * MAX_CLOCK)) : 0;
    if (nodes + wells > 0) limits[item.id] = nodes + wells;
  }
  return limits;
}

/** Conditional cost: the largest finite map limit divided by the resource limit. Not a proof of scarcity. */
export function scarcityWeights(catalog: Catalog): Record<string, number> {
  const limits = mapResourceLimits(catalog);
  const finite = Object.values(limits).filter((limit): limit is number => limit !== null);
  const largest = Math.max(...finite);
  return Object.fromEntries(Object.entries(limits).map(([id, limit]) => [id, limit === null ? UNLIMITED_WEIGHT : Number((largest / limit).toFixed(3))]));
}
