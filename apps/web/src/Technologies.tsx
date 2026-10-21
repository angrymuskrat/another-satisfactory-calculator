import { Gauge, MoveRight } from 'lucide-react';
import type { PlanProps } from './Planner';
import { CatalogStatus } from './Construction';
import { format, ItemIcon, NumberField } from './controls';

const range = (values: number[]) => Math.min(...values) === Math.max(...values) ? format(values[0]) : format(Math.min(...values)) + '–' + format(Math.max(...values));

export function Technologies({ catalog, plan, setPlan }: PlanProps) {
  const current = plan.settings;
  const limitOf = (id: string) => current.buildingLimits && Object.hasOwn(current.buildingLimits, id) ? current.buildingLimits[id] : undefined;
  const settings = (patch: Partial<typeof current>) => setPlan({ ...plan, settings: { ...plan.settings, ...patch } });
  const setLimit = (id: string, value: number | null) => {
    const buildingLimits = { ...current.buildingLimits };
    if (value === null) delete buildingLimits[id]; else buildingLimits[id] = value;
    settings({ buildingLimits });
  };
  return <div className="technology-view"><div className="technology-controls">
    <section className="panel"><div className="section-heading"><h2><MoveRight size={19} />Транспорт</h2></div><label><span className="field-label">Максимальная конвейерная лента</span><select value={plan.settings.beltId} onChange={e => settings({ beltId: e.target.value })}>{catalog.belts.map(b => <option key={b.id} value={b.id}>{b.name} · {format(b.rate)} шт/мин</option>)}</select></label><label><span className="field-label">Максимальная труба</span><select value={plan.settings.pipeId} onChange={e => settings({ pipeId: e.target.value })}>{catalog.pipes.map(b => <option key={b.id} value={b.id}>{b.name} · {format(b.rate)} м³/мин</option>)}</select></label><p className="hint">Лимит применяется к выходу каждого добытчика и портам производственной машины. Между производствами разрешены параллельные линии. Ограничение порта может вызывать простои на заданной частоте.</p></section>
    <section className="panel"><div className="section-heading"><h2><Gauge size={19} />Предел частоты</h2></div><label><span className="field-label">Максимальная частота производств</span><NumberField label="Частота производства" value={plan.settings.clock} min={1} max={250} suffix="%" onChange={clock => settings({ clock })} /></label><input type="range" min={1} max={250} aria-label="Частота производства ползунок" value={plan.settings.clock} onChange={e => settings({ clock: Number(e.target.value) })} /><div className="range-labels"><span>1%</span><button onClick={() => settings({ clock: 100 })}>100%</button><span>250%</span></div><p className="hint">Это верхний предел: решатель подбирает рабочую частоту каждой группы машин от 1% до этого значения, чтобы уменьшить простои. Закреплённые линии сохраняют собственные настройки; незакреплённым линиям частоту можно снизить. Усилители и существующие линии задаются в планировщике.</p></section>
  </div><section className="panel"><div className="section-heading"><h2>Доступные здания</h2></div><p className="hint">Рецепты отключённых зданий исключаются до расчёта. Лимит задаёт суммарное физическое число машин этого типа для всех рецептов; 0 запрещает использование, отсутствие лимита не ограничивает количество. Для добытчиков количество доступных узлов задаётся в источниках.</p><p className="hint">Здания с переменной мощностью: коэффициенты выбранного рецепта показаны в результате; активная доля времени уменьшает среднюю мощность группы, пик на долю времени не умножается.</p>
    <div className="building-grid">{catalog.buildings.map(b => {
      const enabled = plan.settings.enabledBuildingIds.includes(b.id), limit = limitOf(b.id);
      const unlocked = !plan.world || plan.world.unlockedBuildingIds.includes(b.id);
      const recipes = catalog.recipes.filter(r => r.buildingId === b.id);
      const dependent = recipes.some(r => r.power !== undefined || r.powerMax !== undefined) || b.powerMax !== undefined;
      const powers = recipes.map(r => r.power ?? b.power), peaks = recipes.map(r => r.powerMax ?? b.powerMax ?? r.power ?? b.power);
      const estimated = b.powerEstimated || recipes.some(r => r.powerEstimated);
      return <div key={b.id} className={'building-tile' + (enabled ? ' enabled' : '')}><label className="building-card"><ItemIcon item={b} size={45} /><span><strong>{b.name}</strong><small>{dependent ? 'Мощность зависит от рецепта / фазы цикла' : format(b.power) + ' МВт при 100% во время работы'}</small></span><input type="checkbox" aria-label={'Доступно: ' + b.name} checked={enabled} onChange={e => settings({ enabledBuildingIds: e.target.checked ? [...plan.settings.enabledBuildingIds, b.id] : plan.settings.enabledBuildingIds.filter(id => id !== b.id) })} /></label>
        {!unlocked && <p className="hint">Не открыто в мире. Локальное разрешение не откроет здание: его рецепты исключены из расчёта.</p>}
        {dependent && <p className="hint">При 100%: {powers.length ? 'средняя за рабочий цикл ' + range(powers) + ' МВт; максимум до ' + format(Math.max(...peaks)) + ' МВт.' : 'средняя ' + format(b.power) + ' МВт, максимум ' + format(b.powerMax ?? b.power) + ' МВт.'}{estimated && ' В каталоге есть оценочные коэффициенты.'}</p>}
        <label className="inline-check"><input type="checkbox" aria-label={'Ограничить количество: ' + b.name} checked={limit !== undefined} onChange={e => setLimit(b.id, e.target.checked ? 0 : null)} />Ограничить количество</label>
        {limit !== undefined && <NumberField label={'Лимит зданий: ' + b.name} value={limit} min={0} step={1} suffix="шт" onChange={value => setLimit(b.id, value)} />}
      </div>;
    })}</div>
  </section><section className="panel"><h2>Добывающие установки</h2><p className="hint">Лимит типа суммирует необходимые добытчики на всех источниках фабрики. Доступные месторождения, чистота и частоты задаются в источниках. Месторождение с неоткрытым добытчиком имеет нулевой доступный поток.{!plan.world && ' Мир не привязан: доступность добытчиков не ограничена прогрессом.'}</p><div className="building-grid">{catalog.miners.map(miner => {
    const unlocked = !plan.world || plan.world.unlockedBuildingIds.includes(miner.id), limit = limitOf(miner.id);
    return <div key={miner.id} className={'building-tile' + (unlocked ? ' enabled' : '')}><div className="building-card"><span><strong>{miner.name}</strong><small>{format(miner.power)} МВт при 100% во время работы</small></span></div>{plan.world && <p className="hint">{unlocked ? 'Открыто в мире.' : 'Не открыто в мире: источники с этим добытчиком исключены из расчёта.'}</p>}<label className="inline-check"><input type="checkbox" aria-label={'Ограничить количество: ' + miner.name} checked={limit !== undefined} onChange={e => setLimit(miner.id, e.target.checked ? 0 : null)} />Ограничить количество</label>{limit !== undefined && <NumberField label={'Лимит добытчиков: ' + miner.name} value={limit} min={0} step={1} suffix="шт" onChange={value => setLimit(miner.id, value)} />}</div>;
  })}</div></section><CatalogStatus catalog={catalog} /></div>;
}
