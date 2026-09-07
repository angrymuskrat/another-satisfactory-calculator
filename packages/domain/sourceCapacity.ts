import type { Catalog, Plan, Source } from './types';
import { wellConfiguration } from './production';

export function sourceCapacity(catalog: Catalog, plan: Plan, source: Source) {
  const reserve = source.reserve ?? 0;
  if (source.kind === 'flow') return { limit: source.limit === null ? null : Math.max(0, source.limit - reserve), explanation: (source.importPower == null ? 'Энергия внешней поставки неизвестна и исключена.' : `Энергия импорта: ${source.importPower} МВт на единицу потока в минуту.`) + ` Резерв: ${reserve}/мин.` };
  if (source.kind === 'well') {
    if (plan.world && !plan.world.unlockedMilestoneIds.includes('p2:resource-wells')) return { limit: 0, explanation: 'Скважины ещё не открыты в мире.' };
    try { const worldPipe = plan.world && catalog.pipes.find(p => p.id === plan.world!.pipeId); const localPipe = catalog.pipes.find(p => p.id === plan.settings.pipeId); const effective = worldPipe && localPipe && worldPipe.rate < localPipe.rate ? { ...plan, settings: { ...plan.settings, pipeId: worldPipe.id } } : plan; const well = wellConfiguration(catalog, effective, source); return { limit: Math.max(0, Math.min(source.limit ?? well.capacity, well.capacity) - reserve), explanation: `${well.count} спутников; один компенсатор ${well.power.toFixed(2)} МВт. Каждая труба ограничивается отдельно. Резерв: ${reserve}/мин.` }; } catch (error) { return { limit: 0, explanation: String(error) }; }
  }
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
  return { limit: Math.max(0, limit - reserve), explanation: `${miner.name}: ${miner.rate} × чистота ${source.purity} × ${source.clock}% = ${Number(nominal.toFixed(3))}/мин на узел. ${transport.name}: ${transport.rate}/мин на выход. Узлов: ${source.count}.${source.limit !== null ? ` Дополнительный лимит: ${source.limit}/мин.` : ''}${nominal > transport.rate ? ' Выход ограничен транспортом.' : ' Выход ограничен добычей.'}` };
}
