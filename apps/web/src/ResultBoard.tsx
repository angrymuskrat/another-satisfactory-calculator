import { Check } from 'lucide-react';
import type { Catalog, Plan, Result } from '../../../packages/domain/types';
import type { ConstructionGroup, ConstructionModel } from '../../../packages/domain/construction';
import { orderDependencies } from '../../../packages/domain/dependencies';
import { batchEstimate } from '../../../packages/domain/batch';
import { sourceLabel } from '../../../packages/domain/sourceLabel';
import type { MachineSpan, SchematicModel, SchematicNode } from '../../../packages/domain/schematic';
import { builtCount, type BuiltRanges, type constructionDependencies, type NextBuildStep } from '../../../packages/domain/constructionProgress';
import { format, ItemIcon, unit } from './controls';
import { usedResources } from './resultResources';

export type BuildEntry = { id: string; parts: MachineSpan[]; group?: ConstructionGroup; supply?: SchematicNode };
/** Order of the construction instruction: suppliers first, so readiness can advance from the top.
 * External supplies carry a "ready" mark that machines wait for, so they lead the order without counting as machines. */
export function buildOrder(model: ConstructionModel, graph: SchematicModel | null): BuildEntry[] {
  const production = orderDependencies(model.production.map(g => ({ recipeId: g.id, inputs: g.averageInputs, outputs: g.averageOutputs })))
    .flatMap(group => group.recipeIds.map(id => model.production.find(g => g.id === id)!));
  const supplies = graph?.nodes.filter(n => n.kind === 'source' && n.parts?.length).map(supply => ({ id: supply.parts![0].id, parts: supply.parts!, supply })) ?? [];
  return [...supplies, ...[...model.extraction, ...production, ...model.sinks].map(group => ({ id: group.id, parts: [{ id: group.id, first: 0, count: group.count }], group }))];
}

/** Above this many machines a cell per machine stops being readable; one segment per group is drawn instead. */
export const BOARD_CELL_LIMIT = 120;
const SHOWN_ROWS = 5;
const EPSILON = 1e-6;
const rate = (value: number) => value !== 0 && Math.abs(value) < 1e-6 ? value.toExponential(3) : format(value, 6);

function Meter({ value, limit, label }: { value: number; limit: number; label: string }) {
  const share = limit > 0 ? Math.min(1, value / limit) : 0;
  return <div className={'board-meter' + (share > .98 ? ' is-full' : '')} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={limit} aria-valuenow={Math.min(value, limit)}><span style={{ width: share * 100 + '%' }} /></div>;
}

export function ResultBoard({ catalog, plan, result, model, order, built, progress, step, onMark, onShow }: {
  catalog: Catalog; plan: Plan; result: Result; model: ConstructionModel; order: BuildEntry[]; built: BuiltRanges;
  progress: ReturnType<typeof constructionDependencies> | null; step: NextBuildStep | null;
  onMark: (parts: MachineSpan[]) => void; onShow: (id: string) => void;
}) {
  const item = (id: string) => catalog.items.find(i => i.id === id);
  const name = (id: string) => item(id)?.name ?? id;
  const batch = batchEstimate(plan, result);
  const goal = (itemId: string, value: number) => {
    const row = batch?.items.find(i => i.itemId === itemId);
    const amount = item(itemId)?.fluid ? 'м³' : 'шт';
    if (row) return <>нужно {format(row.required, 6)} {amount} · в запасе {format(row.stock, 6)} {amount} · {row.remaining === 0 ? 'производить не нужно' : Number.isFinite(row.minutes) ? `${format(row.minutes, 2)} мин` : 'потока нет'}</>;
    const index = plan.targets.findIndex(t => t.itemId === itemId), target = plan.targets[index];
    if (!target) return null;
    const against = (wanted: number, label: string) => <>{label} {rate(wanted)} · {value < wanted - EPSILON * Math.max(1, wanted)
      ? <span className="is-short">не хватает {rate(wanted - value)}</span>
      : value > wanted + EPSILON * Math.max(1, wanted) ? <span className="is-met">сверх заказа {rate(value - wanted)}</span> : <span className="is-met">выполнен</span>}</>;
    if (plan.mode === 'target') return against(target.rate, 'заказ');
    if (target.minRate) return against(target.minRate, 'не меньше');
    if (plan.targets.length < 2) return <>максимум из доступного сырья</>;
    return plan.policy === 'priority' ? <>приоритет {index + 1}</> : plan.policy === 'weighted' ? <>вес {format(target.weight, 6)}</> : <>доля {format(target.scale, 6)}</>;
  };
  const machines = order.filter(e => e.group);
  const total = machines.reduce((sum, e) => sum + e.group!.count, 0);
  const done = machines.reduce((sum, e) => sum + builtCount(built, e.parts), 0);
  const cells = machines.map(e => ({ id: e.id, count: e.group!.count, built: builtCount(built, e.parts), ready: progress?.(e.parts, built).ready ?? 0 }));
  const resources = usedResources(plan, result.resources);
  const settings = plan.settings;
  const entry = step && step.kind !== 'done' ? order.find(e => e.id === step.id) : undefined;
  const current = entry?.group, supply = entry?.supply;
  const machine = current && (current.kind === 'extraction' ? catalog.miners.find(b => b.id === current.buildingId) : catalog.buildings.find(b => b.id === current.buildingId));
  const flows = (title: string, list: ConstructionGroup['averageInputs']) => <div><h4>{title}</h4>{list.length ? <ul>{list.map(f => <li key={f.itemId}><span><ItemIcon item={item(f.itemId)} size={18} />{name(f.itemId)}</span><span className="board-number">{rate(f.rate)} {unit(item(f.itemId))}</span></li>)}</ul> : <p>нет</p>}</div>;
  return <section className="result-board" aria-label="Табло результата">
    <div className="board-stack">
      <div className="board-panel board-goal"><h3>Цель</h3>
        {result.products.slice(0, SHOWN_ROWS).map(product => <div className={'board-goal-row' + (result.products.length > 2 ? ' is-compact' : '')} key={product.itemId}>
          <span className="board-goal-name"><ItemIcon item={item(product.itemId)} size={22} />{name(product.itemId)}</span>
          <strong className="board-number">{rate(product.rate)}<small>{unit(item(product.itemId))}</small></strong>
          <span className="board-versus">{goal(product.itemId, product.rate)}</span>
        </div>)}
        {result.products.length > SHOWN_ROWS && <p className="board-more">Ещё {result.products.length - SHOWN_ROWS} — в разделе «Готовая продукция».</p>}
      </div>
      <div className="board-panel board-built"><h3>Построено</h3>
        <p className="board-built-count"><strong className="board-number">{done}<small>/ {total}</small></strong><span>машин</span></p>
        {total <= BOARD_CELL_LIMIT
          ? <div className="board-cells" aria-hidden="true">{cells.flatMap(c => Array.from({ length: c.count }, (_, i) => <i key={c.id + i} className={i < c.built ? 'is-built' : i < c.built + c.ready ? 'is-ready' : undefined} />))}</div>
          : <div className="board-segments" aria-hidden="true">{cells.map(c => <span key={c.id} style={{ flexGrow: c.count }}><span style={{ width: c.built / c.count * 100 + '%' }} /></span>)}</div>}
      </div>
    </div>
    <div className={'board-panel board-next' + (step?.kind === 'ready' ? ' is-ready' : '')}><h3>Дальше строим</h3>
      {!step ? <p className="board-next-note">Порядок постройки не удалось проверить. Инструкция ниже остаётся доступной.</p>
        : step.kind === 'done' ? <><p className="board-next-name">Фабрика собрана</p><p className="board-next-note">Все машины отмечены построенными.</p></>
          : !entry ? null : <>
            <p className="board-next-name">{supply ? supply.label : machine?.name ?? current!.buildingId}{current && step.kind === 'ready' && <span className="board-number"> ×{step.ready}</span>}</p>
            <p className="board-next-recipe">{supply ? 'Внешняя поставка: подведите её к фабрике' : current!.name}</p>
            {step.kind === 'waiting' ? <><p className="board-next-note">Ждёт поставщиков{step.missing.length ? ':' : '.'}</p>
              {!!step.missing.length && <ul className="board-missing">{step.missing.slice(0, SHOWN_ROWS).map(m => <li key={JSON.stringify([m.id, m.index, m.itemId])}>{m.itemId ? name(m.itemId) : 'Связь скважины'} — {m.label}</li>)}</ul>}</>
              : <>
                {current ? <><dl className="board-specs">
                  <div><dt>Готово к постройке</dt><dd className="board-number">{step.ready}<small>из {step.remaining}</small></dd></div>
                  <div><dt>Частота</dt><dd className="board-number">{format(current.clock, 4)}<small>%</small></dd></div>
                  <div><dt>МВт, сред.</dt><dd className="board-number">{format(current.averagePower)}</dd></div>
                </dl>
                <div className="board-flows">{flows('Вход', current.averageInputs)}{flows('Выход', current.averageOutputs)}</div></>
                  : <div className="board-flows">{flows('Поставка', supply!.outputs)}</div>}
                {step.together && <p className="board-next-note">Замкнутый контур: участники строятся и запускаются вместе.</p>}
                <div className="board-actions">
                  <button type="button" className="primary-button" onClick={() => onMark(step.readyParts)}><Check size={16} />{supply ? 'Отметить готовой' : 'Отметить построенными'}</button>
                  <button type="button" className="text-button" onClick={() => onShow(step.id)}>Показать на схеме</button>
                </div>
              </>}
          </>}
    </div>
    <div className="board-stack">
      <div className="board-panel board-energy"><h3>Энергия</h3>
        <div className="board-energy-values">
          <p><strong className="board-number">{format(model.averagePower)}<small>МВт</small></strong><span>средняя</span></p>
          <p><strong className="board-number">{format(model.peakPower)}<small>МВт</small></strong><span>пик</span></p>
        </div>
        {settings.powerLimit !== null && <><Meter value={model.averagePower} limit={settings.powerLimit} label="Средняя мощность от бюджета" /><p className="board-versus">бюджет средней {format(settings.powerLimit)} МВт</p></>}
        {settings.peakPowerLimit != null && <p className="board-versus">лимит пика {format(settings.peakPowerLimit)} МВт</p>}
        <p className="board-more">Добыча, производство и утилизация{model.externalSources.some(s => s.power === null) ? '; энергия внешних поставок неизвестна и не включена' : ''}.</p>
      </div>
      <div className="board-panel board-raw"><h3>Сырьё</h3>
        {resources.slice(0, SHOWN_ROWS).map(source => <div className="board-raw-row" key={source.sourceId}>
          <div><span><ItemIcon item={item(source.itemId)} size={18} />{sourceLabel(catalog, plan, source.sourceId, source.itemId)}</span>
            <span className="board-number">{rate(source.rate)}{source.limit !== null && ` / ${format(source.limit)}`} {unit(item(source.itemId))}</span></div>
          {source.limit === null ? <p className="board-versus">без лимита</p> : <Meter value={source.rate} limit={source.limit} label={`${sourceLabel(catalog, plan, source.sourceId, source.itemId)}: расход от лимита`} />}
        </div>)}
        {!resources.length && <p className="board-more">Внешние источники не используются.</p>}
        {resources.length > SHOWN_ROWS && <p className="board-more">Ещё {resources.length - SHOWN_ROWS} — в разделе «Загрузка источников».</p>}
      </div>
    </div>
  </section>;
}
