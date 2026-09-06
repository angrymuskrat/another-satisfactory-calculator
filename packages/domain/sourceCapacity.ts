import type { Catalog, Plan, Source } from './types';

export function sourceCapacity(catalog: Catalog, plan: Plan, source: Source) {
  if (source.kind === 'flow') return { limit: source.limit, explanation: source.limit === 0 ? 'Этот внешний источник запрещён.' : 'Энергия внешней поставки неизвестна и исключена.' };
  if (plan.world && !plan.world.unlockedBuildingIds.includes(source.minerId)) return { limit: 0, explanation: 'Добытчик ещё не открыт в мире.' };
  const miner = catalog.miners.find(m => m.id === source.minerId);
  const item = catalog.items.find(i => i.id === source.itemId);
  const transports = item?.fluid ? catalog.pipes : catalog.belts;
  const local = transports.find(t => t.id === (item?.fluid ? plan.settings.pipeId : plan.settings.beltId));
  const world = plan.world && transports.find(t => t.id === (item?.fluid ? plan.world!.pipeId : plan.world!.beltId));
  const transport = world && local && world.rate < local.rate ? world : local;
  if (!miner || !transport) return { limit: 0, explanation: 'Добытчик или транспорт отсутствует в каталоге.' };
  const nominal = miner.rate * source.purity * source.clock / 100;
  const capacity = Math.min(nominal, transport.rate) * source.count;
  const limit = source.limit === null ? capacity : Math.min(source.limit, capacity);
  return { limit, explanation: `${miner.name}: ${miner.rate} × чистота ${source.purity} × ${source.clock}% = ${Number(nominal.toFixed(3))}/мин на узел. ${transport.name}: ${transport.rate}/мин на выход. Узлов: ${source.count}.${source.limit !== null ? ` Дополнительный лимит: ${source.limit}/мин.` : ''}${nominal > transport.rate ? ' Выход ограничен транспортом.' : ' Выход ограничен добычей.'}` };
}
