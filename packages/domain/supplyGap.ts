import type { Catalog, Plan, Source } from './types';
import { sourceCapacity } from './sourceCapacity';

export interface SupplyGap {
  itemId: string;
  available: number;
  extra: number;
  minimumExtra: number | null;
  consumers: string[];
}

/** Preview a separate source. Existing quotas and reserves belong to their original sources. */
export function supplyChange(catalog: Catalog, plan: Plan, gap: SupplyGap, rate: number, minerId: string | null, purity: Source['purity'], sourceId: string): Plan | null {
  if (!Number.isFinite(rate) || rate <= 0 || rate > 1e9) return null;
  const total = gap.available + rate;
  const cap = plan.settings.inputLimits?.[gap.itemId];
  const raiseCap = cap != null && total > cap;
  if (raiseCap && total > 1e9) return null;
  const implicit = plan.settings.resourcePolicy === 'unlimited-unlisted' && !plan.sources.some(s => s.itemId === gap.itemId);
  const installed = plan.sources.filter(s => s.itemId === gap.itemId).reduce((sum, s) => sum + (sourceCapacity(catalog, plan, s).limit ?? Infinity), implicit ? Infinity : 0);
  const additional = Math.max(0, total - installed);
  const next = { ...plan, settings: raiseCap ? { ...plan.settings, inputLimits: { ...plan.settings.inputLimits, [gap.itemId]: total } } : plan.settings };
  if (additional <= 1e-9) return next;
  if (plan.sources.length >= 512 || plan.sources.some(s => s.id === sourceId)) return null;
  const miner = catalog.miners.find(m => m.id === minerId && m.resourceIds.includes(gap.itemId));
  if (minerId && (!miner || plan.world && !plan.world.unlockedBuildingIds.includes(minerId))) return null;
  const source: Source = { id: sourceId, itemId: gap.itemId, kind: miner ? 'node' : 'flow', limit: additional,
    minerId: miner?.id ?? '', count: 1, purity: miner?.id === 'water-extractor' ? 1 : purity, clock: 100 };
  if (miner) {
    const perNode = sourceCapacity(catalog, plan, { ...source, limit: null }).limit ?? 0;
    if (!perNode) return null;
    source.count = Math.max(1, Math.ceil(additional / perNode - 1e-10));
    if (source.count > 10000) return null;
  }
  return { ...next, sources: [...plan.sources, source] };
}
