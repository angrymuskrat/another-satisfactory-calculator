import type { Catalog, Plan, Settings } from '../../../packages/domain/types';
import { NumberField, unit } from './controls';
import { useT } from './i18n';
import { gameName } from './i18n/gameNames';
export function InputLimits({ catalog, plan, setPlan }: { catalog: Catalog; plan: Plan; setPlan: (p: Plan) => void }) {
  const t = useT();
  const ids = new Set([...plan.sources.map(s => s.itemId), ...Object.keys(plan.settings.inputLimits ?? {}), ...(plan.settings.resourcePolicy === 'unlimited-unlisted' ? catalog.items.filter(i => i.raw).map(i => i.id) : [])]);
  const update = (id: string, value: number | null) => setPlan({ ...plan, settings: { ...plan.settings, inputLimits: { ...plan.settings.inputLimits, [id]: value } } });
  return <details className="advanced" open><summary>{t.paretoSettings.refineResources}</summary><p className="hint">{t.paretoSettings.limitHint}</p><div className="weights-grid">{catalog.items.filter(i => ids.has(i.id)).map(i => {
    const value = plan.settings.inputLimits?.[i.id];
    const itemName = gameName('item', i.id, i.name);
    return <label key={i.id}><span className="field-label">{itemName}, {unit(i)}</span><div className="limit-control"><NumberField label={t.paretoSettings.totalLimit(itemName)} value={value ?? 100} disabled={value == null} onChange={v => update(i.id, v)} /><label className="inline-check"><input type="checkbox" aria-label={t.paretoSettings.noTotalLimit(itemName)} checked={value == null} onChange={e => update(i.id, e.target.checked ? null : 100)} />∞</label></div></label>;
  })}</div></details>;
}
export function ParetoSettings(props: { catalog: Catalog; plan: Plan; setPlan: (p: Plan) => void }) {
  const t = useT();
  const { catalog, plan, setPlan } = props;
  if (plan.mode !== 'target' && !plan.batch) return null;
  const update = (patch: Partial<Settings>) => setPlan({ ...plan, settings: { ...plan.settings, ...patch } });
  const supply = (family: Settings['selfSupply']) => {
    const recipes = catalog.recipes.filter(r => r.generation?.family === family && family);
    update({ selfSupply: family, enabledRecipeIds: [...new Set([...plan.settings.enabledRecipeIds, ...recipes.map(r => r.id)])], enabledBuildingIds: [...new Set([...plan.settings.enabledBuildingIds, ...recipes.map(r => r.buildingId)])] });
  };
  return <section className="panel"><h2>{t.paretoSettings.title}</h2>
    <label className="inline-check"><input type="checkbox" checked={!!plan.settings.pareto} onChange={e => update({ pareto: e.target.checked, selfSupply: e.target.checked ? plan.settings.selfSupply : undefined })} />{t.paretoSettings.pareto}</label>
    {plan.settings.pareto && <><p className="hint">{t.paretoSettings.paretoHint}</p>
      <label className="inline-check"><input type="checkbox" checked={!!plan.settings.selfSupply} onChange={e => supply(e.target.checked ? 'coal' : undefined)} />{t.paretoSettings.selfSupply}</label>
      {plan.settings.selfSupply && <><label><span className="field-label">{t.paretoSettings.supplyResource}</span><select aria-label={t.paretoSettings.supplyResource} value={plan.settings.selfSupply} onChange={e => supply(e.target.value as Settings['selfSupply'])}><option value="coal">{t.paretoSettings.coal}</option><option value="crude-oil">{t.paretoSettings.oil}</option><option value="uranium">{t.paretoSettings.uranium}</option></select></label>
        <p className="hint">{t.paretoSettings.supplyHint}</p></>}
      <InputLimits {...props} /></>}
  </section>;
}
