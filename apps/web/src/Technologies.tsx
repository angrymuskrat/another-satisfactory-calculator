import { MAX_CLOCK_PERCENT, MIN_CLOCK_PERCENT } from '../../../packages/domain/gameMechanics';
import { Gauge, MoveRight } from 'lucide-react';
import type { PlanProps } from './Planner';
import { CatalogStatus } from './Construction';
import { format, ItemIcon, NumberField } from './controls';
import { useT } from './i18n';
import { gameName } from './i18n/gameNames';

const range = (values: number[]) => Math.min(...values) === Math.max(...values) ? format(values[0]) : format(Math.min(...values)) + '–' + format(Math.max(...values));

export function Technologies({ catalog, plan, setPlan }: PlanProps) {
  const t = useT();
  const current = plan.settings;
  const limitOf = (id: string) => current.buildingLimits && Object.hasOwn(current.buildingLimits, id) ? current.buildingLimits[id] : undefined;
  const settings = (patch: Partial<typeof current>) => setPlan({ ...plan, settings: { ...plan.settings, ...patch } });
  const setLimit = (id: string, value: number | null) => {
    const buildingLimits = { ...current.buildingLimits };
    if (value === null) delete buildingLimits[id]; else buildingLimits[id] = value;
    settings({ buildingLimits });
  };
  return <div className="technology-view"><div className="technology-controls">
    <section className="panel"><div className="section-heading"><h2><MoveRight size={19} />{t.technologies.transport}</h2></div><label><span className="field-label">{t.technologies.maxBelt}</span><select value={plan.settings.beltId} onChange={e => settings({ beltId: e.target.value })}>{catalog.belts.map(b => <option key={b.id} value={b.id}>{t.technologies.beltOption(gameName('belt', b.id, b.name), format(b.rate))}</option>)}</select></label><label><span className="field-label">{t.technologies.maxPipe}</span><select value={plan.settings.pipeId} onChange={e => settings({ pipeId: e.target.value })}>{catalog.pipes.map(b => <option key={b.id} value={b.id}>{t.technologies.pipeOption(gameName('pipe', b.id, b.name), format(b.rate))}</option>)}</select></label><p className="hint">{t.technologies.transportHint}</p></section>
    <section className="panel"><div className="section-heading"><h2><Gauge size={19} />{t.technologies.clockLimit}</h2></div><label><span className="field-label">{t.technologies.maxClock}</span><NumberField label={t.technologies.clockLabel} value={plan.settings.clock} min={MIN_CLOCK_PERCENT} max={MAX_CLOCK_PERCENT} suffix="%" onChange={clock => settings({ clock })} /></label><input type="range" min={MIN_CLOCK_PERCENT} max={MAX_CLOCK_PERCENT} aria-label={t.technologies.clockSlider} value={plan.settings.clock} onChange={e => settings({ clock: Number(e.target.value) })} /><div className="range-labels"><span>{MIN_CLOCK_PERCENT}%</span><button onClick={() => settings({ clock: 100 })}>100%</button><span>{MAX_CLOCK_PERCENT}%</span></div><p className="hint">{t.technologies.clockHint}</p></section>
  </div><section className="panel"><div className="section-heading"><h2>{t.technologies.availableBuildings}</h2></div><p className="hint">{t.technologies.buildingsHint}</p><p className="hint">{t.technologies.variablePowerHint}</p>
    <div className="building-grid">{catalog.buildings.map(b => {
      const enabled = plan.settings.enabledBuildingIds.includes(b.id), limit = limitOf(b.id);
      const unlocked = !plan.world || plan.world.unlockedBuildingIds.includes(b.id);
      const recipes = catalog.recipes.filter(r => r.buildingId === b.id);
      const dependent = recipes.some(r => r.power !== undefined || r.powerMax !== undefined) || b.powerMax !== undefined;
      const powers = recipes.map(r => r.power ?? b.power), peaks = recipes.map(r => r.powerMax ?? b.powerMax ?? r.power ?? b.power);
      const estimated = b.powerEstimated || recipes.some(r => r.powerEstimated);
      return <div key={b.id} className={'building-tile' + (enabled ? ' enabled' : '')}><label className="building-card"><ItemIcon item={b} size={45} /><span><strong>{gameName('building', b.id, b.name)}</strong><small>{dependent ? t.technologies.powerDependsOnRecipe : t.technologies.powerAtFull(format(b.power))}</small></span><input type="checkbox" aria-label={t.technologies.availableLabel(gameName('building', b.id, b.name))} checked={enabled} onChange={e => settings({ enabledBuildingIds: e.target.checked ? [...plan.settings.enabledBuildingIds, b.id] : plan.settings.enabledBuildingIds.filter(id => id !== b.id) })} /></label>
        {!unlocked && <p className="hint">{t.technologies.notOpenedBuilding}</p>}
        {dependent && <p className="hint">{t.technologies.dependentAtFull(powers.length ? t.technologies.cycleAverage(range(powers), format(Math.max(...peaks))) : t.technologies.flatAverage(format(b.power), format(b.powerMax ?? b.power)))}{estimated && t.technologies.estimatedCoefficients}</p>}
        <label className="inline-check"><input type="checkbox" aria-label={t.technologies.limitCountLabel(gameName('building', b.id, b.name))} checked={limit !== undefined} onChange={e => setLimit(b.id, e.target.checked ? 0 : null)} />{t.technologies.limitCount}</label>
        {limit !== undefined && <NumberField label={t.technologies.buildingLimitLabel(gameName('building', b.id, b.name))} value={limit} min={0} step={1} suffix={t.technologies.pcs} onChange={value => setLimit(b.id, value)} />}
      </div>;
    })}</div>
  </section><section className="panel"><h2>{t.technologies.miners}</h2><p className="hint">{t.technologies.minersHint}{!plan.world && t.technologies.noWorldNote}</p><div className="building-grid">{catalog.miners.map(miner => {
    const unlocked = !plan.world || plan.world.unlockedBuildingIds.includes(miner.id), limit = limitOf(miner.id);
    return <div key={miner.id} className={'building-tile' + (unlocked ? ' enabled' : '')}><div className="building-card"><span><strong>{gameName('miner', miner.id, miner.name)}</strong><small>{t.technologies.powerAtFull(format(miner.power))}</small></span></div>{plan.world && <p className="hint">{unlocked ? t.technologies.minerOpened : t.technologies.minerNotOpened}</p>}<label className="inline-check"><input type="checkbox" aria-label={t.technologies.limitCountLabel(gameName('miner', miner.id, miner.name))} checked={limit !== undefined} onChange={e => setLimit(miner.id, e.target.checked ? 0 : null)} />{t.technologies.limitCount}</label>{limit !== undefined && <NumberField label={t.technologies.minerLimitLabel(gameName('miner', miner.id, miner.name))} value={limit} min={0} step={1} suffix={t.technologies.pcs} onChange={value => setLimit(miner.id, value)} />}</div>;
  })}</div></section><CatalogStatus catalog={catalog} /></div>;
}
