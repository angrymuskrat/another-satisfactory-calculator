import type { Plan, Result } from './types';

export interface BatchEstimateItem {
  itemId: string;
  required: number;
  stock: number;
  remaining: number;
  rate: number;
  minutes: number;
}

export interface BatchEstimate {
  items: BatchEstimateItem[];
  minutes: number | null;
}

export function applyBatch(plan: Plan): Plan {
  const batch = plan.batch;
  if (!batch) return plan;
  return {
    ...plan,
    mode: 'target',
    targets: batch.items.map(item => {
      const rate = Math.max(0, item.required - item.stock) / batch.minutes;
      return rate === 0
        ? { itemId: item.itemId, rate, weight: 1, scale: 1, minRate: 0, maxRate: 0 }
        : { itemId: item.itemId, rate, weight: 1, scale: 1 };
    }),
  };
}

export function batchEstimate(plan: Plan, result: Result): BatchEstimate | null {
  if (!plan.batch) return null;
  const items = plan.batch.items.map(item => {
    const remaining = Math.max(0, item.required - item.stock);
    const actual = result.products.find(product => product.itemId === item.itemId)?.rate ?? 0;
    const rate = Number.isFinite(actual) && actual > 0 ? actual : 0;
    const minutes = remaining === 0 ? 0 : rate > 0 ? remaining / rate : Number.POSITIVE_INFINITY;
    return { ...item, remaining, rate, minutes };
  });
  return { items, minutes: items.some(item => !Number.isFinite(item.minutes)) ? null : Math.max(...items.map(item => item.minutes)) };
}
