import { Factory, Gauge, MoveRight } from 'lucide-react';
import type { PlanProps } from './Planner';
import { CatalogStatus } from './Construction';
import { format, ItemIcon, NumberField } from './controls';

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
    <section className="panel"><div className="section-heading"><h2><Gauge size={19} />Рабочая частота</h2></div><label><span className="field-label">Частота производственных машин</span><NumberField label="Частота производства" value={plan.settings.clock} min={1} max={250} suffix="%" onChange={clock => settings({ clock })} /></label><input type="range" min={1} max={250} aria-label="Частота производства ползунок" value={plan.settings.clock} onChange={e => settings({ clock: Number(e.target.value) })} /><div className="range-labels"><span>1%</span><button onClick={() => settings({ clock: 100 })}>100%</button><span>250%</span></div><p className="hint">В режиме «Ровная нагрузка» это верхний предел: решатель подбирает рабочую частоту каждой группы машин от 1% до этого значения, чтобы уменьшить простои. В остальных режимах частота фиксирована. Закреплённые линии сохраняют собственные настройки; незакреплённым линиям частоту можно снизить. Усилители и существующие линии задаются в планировщике.</p></section>
  </div><section className="panel"><div className="section-heading"><div><span className="eyebrow">ПРОИЗВОДСТВО</span><h2>Доступные здания</h2></div><Factory size={22} /></div><p className="hint">Рецепты отключённых зданий исключаются до расчёта. Лимит задаёт суммарное физическое число машин этого типа для всех рецептов; 0 запрещает использование, отсутствие лимита не ограничивает количество. Для добытчиков количество доступных узлов задаётся в источниках.</p>
    <div className="building-grid">{catalog.buildings.map(b => {
      const enabled = plan.settings.enabledBuildingIds.includes(b.id), limit = limitOf(b.id);
      const unlocked = !plan.world || plan.world.unlockedBuildingIds.includes(b.id);
      const recipes = catalog.recipes.filter(r => r.buildingId === b.id);
      const dependent = recipes.some(r => r.power !== undefined || r.powerMax !== undefined) || b.powerMax !== undefined;
      const powers = recipes.map(r => r.power ?? b.power), peaks = recipes.map(r => r.powerMax ?? b.powerMax ?? r.power ?? b.power);
      const estimated = b.powerEstimated || recipes.some(r => r.powerEstimated);
      return <div key={b.id}><label className={'building-card ' + (enabled ? 'enabled' : '')}><ItemIcon item={b} size={45} /><span><strong>{b.name}</strong><small>{dependent ? 'Мощность зависит от рецепта / фазы цикла' : format(b.power) + ' МВт при 100% во время работы'}</small></span><input type="checkbox" aria-label={'Доступно: ' + b.name} checked={enabled} onChange={e => settings({ enabledBuildingIds: e.target.checked ? [...plan.settings.enabledBuildingIds, b.id] : plan.settings.enabledBuildingIds.filter(id => id !== b.id) })} /></label>
        {!unlocked && <p className="hint">Не открыто в мире. Локальное разрешение не откроет здание: его рецепты исключены из расчёта.</p>}
        {dependent && <p className="hint">При 100%: {powers.length ? 'средняя за рабочий цикл ' + format(Math.min(...powers)) + '–' + format(Math.max(...powers)) + ' МВт; максимум до ' + format(Math.max(...peaks)) + ' МВт.' : 'средняя ' + format(b.power) + ' МВт, максимум ' + format(b.powerMax ?? b.power) + ' МВт.'} Коэффициенты выбранного рецепта показаны в результате; активная доля времени дополнительно уменьшает среднюю мощность группы. Пик на долю времени не умножается.{estimated && ' В каталоге есть оценочные коэффициенты.'}</p>}
        <label><input type="checkbox" checked={limit !== undefined} onChange={e => setLimit(b.id, e.target.checked ? 0 : null)} /> Ограничить количество: {b.name}</label>
        {limit !== undefined && <NumberField label={'Лимит зданий: ' + b.name} value={limit} min={0} step={1} suffix="шт" onChange={value => setLimit(b.id, value)} />}
      </div>;
    })}</div>
  </section><section className="panel"><h2>Добывающие установки</h2><p className="hint">Лимит типа суммирует необходимые добытчики на всех источниках фабрики. Доступные месторождения, чистота и частоты задаются в источниках. Месторождение с неоткрытым добытчиком имеет нулевой доступный поток.</p><div className="building-grid">{catalog.miners.map(miner => {
    const unlocked = !plan.world || plan.world.unlockedBuildingIds.includes(miner.id), limit = limitOf(miner.id);
    return <div key={miner.id}><div className={'building-card ' + (unlocked ? 'enabled' : '')}><span><strong>{miner.name}</strong><small>{format(miner.power)} МВт при 100% во время работы</small></span></div><p className="hint">{!plan.world ? 'Мир не привязан: доступность не ограничена прогрессом.' : unlocked ? 'Открыто в мире.' : 'Не открыто в мире: источники с этим добытчиком исключены из расчёта.'}</p><label><input type="checkbox" checked={limit !== undefined} onChange={e => setLimit(miner.id, e.target.checked ? 0 : null)} /> Ограничить количество: {miner.name}</label>{limit !== undefined && <NumberField label={'Лимит добытчиков: ' + miner.name} value={limit} min={0} step={1} suffix="шт" onChange={value => setLimit(miner.id, value)} />}</div>;
  })}</div></section><CatalogStatus catalog={catalog} /></div>;
}
