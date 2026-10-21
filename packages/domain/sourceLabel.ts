import type { Catalog, Plan } from './types';

/**
 * Подпись источника для пользователя: предмет и имя источника; без имени —
 * номер в плане, только если у предмета несколько источников. Технический ID
 * не показывается. Источник вне плана (неявный или добавленный проверкой) —
 * только название предмета.
 */
export function sourceLabel(catalog: Catalog, plan: Plan, sourceId: string, itemId: string): string {
  const item = catalog.items.find(i => i.id === itemId)?.name ?? itemId;
  const index = plan.sources.findIndex(s => s.id === sourceId);
  if (index < 0) return item;
  const source = plan.sources[index];
  const name = source.name?.trim();
  if (name) return `${item} · ${name}`;
  return plan.sources.filter(s => s.itemId === source.itemId).length > 1 ? `${item} · источник ${index + 1}` : item;
}
