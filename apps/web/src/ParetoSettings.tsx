import type { Catalog, Plan, Settings } from '../../../packages/domain/types';
import { NumberField, unit } from './controls';
export function InputLimits({ catalog, plan, setPlan }: { catalog: Catalog; plan: Plan; setPlan: (p: Plan) => void }) {
  const ids = new Set([...plan.sources.map(s => s.itemId), ...Object.keys(plan.settings.inputLimits ?? {}), ...(plan.settings.resourcePolicy === 'unlimited-unlisted' ? catalog.items.filter(i => i.raw).map(i => i.id) : [])]);
  const update = (id: string, value: number | null) => setPlan({ ...plan, settings: { ...plan.settings, inputLimits: { ...plan.settings.inputLimits, [id]: value } } });
  return <details className="advanced" open><summary>Уточнить доступные ресурсы</summary><p className="hint">Лимит ограничивает сумму всех источников предмета. Увеличение разрешает расходовать больше, но не требует этого. Мощности добытчиков и квоты мира сохраняются.</p><div className="weights-grid">{catalog.items.filter(i => ids.has(i.id)).map(i => {
    const value = plan.settings.inputLimits?.[i.id];
    return <label key={i.id}><span className="field-label">{i.name}, {unit(i)}</span><div className="limit-control"><NumberField label={`Суммарный лимит: ${i.name}`} value={value ?? 100} disabled={value == null} onChange={v => update(i.id, v)} /><label className="inline-check"><input type="checkbox" aria-label={`Без суммарного лимита: ${i.name}`} checked={value == null} onChange={e => update(i.id, e.target.checked ? null : 100)} />∞</label></div></label>;
  })}</div></details>;
}
export function ParetoSettings(props: { catalog: Catalog; plan: Plan; setPlan: (p: Plan) => void }) {
  const { catalog, plan, setPlan } = props;
  if (plan.mode !== 'target' && !plan.batch) return null;
  const update = (patch: Partial<Settings>) => setPlan({ ...plan, settings: { ...plan.settings, ...patch } });
  const supply = (family: Settings['selfSupply']) => {
    const recipes = catalog.recipes.filter(r => r.generation?.family === family && family);
    update({ selfSupply: family, enabledRecipeIds: [...new Set([...plan.settings.enabledRecipeIds, ...recipes.map(r => r.id)])], enabledBuildingIds: [...new Set([...plan.settings.enabledBuildingIds, ...recipes.map(r => r.buildingId)])] });
  };
  return <section className="panel"><h2>Энергия и ресурсы: обзор Парето</h2>
    <label className="inline-check"><input type="checkbox" checked={!!plan.settings.pareto} onChange={e => update({ pareto: e.target.checked, selfSupply: e.target.checked ? plan.settings.selfSupply : undefined })} />Подобрать компромиссы для заданного выпуска</label>
    {plan.settings.pareto && <><p className="hint">До 12 вариантов за проход: энергия и каждый ресурс отдельно, без весов редкости и предварительной минимизации машин. Частоты от 1%; экономия может потребовать много зданий. Это приближённый обзор, не все возможные фабрики.</p>
      <label className="inline-check"><input type="checkbox" checked={!!plan.settings.selfSupply} onChange={e => supply(e.target.checked ? 'coal' : undefined)} />Самообеспечение электричеством</label>
      {plan.settings.selfSupply && <><label><span className="field-label">Ресурс для электричества</span><select aria-label="Ресурс для электричества" value={plan.settings.selfSupply} onChange={e => supply(e.target.value as Settings['selfSupply'])}><option value="coal">Уголь</option><option value="crude-oil">Нефть</option><option value="uranium">Уран</option></select></label>
        <p className="hint">Генераторы на 100% покрывают локальный пик с резервом. Входы — только первичное сырьё. Учитываются топливная цепочка, вода и отходы; вспомогательные ресурсы остаются необходимы. Доступность ограничена технологиями мира. Рассчитывается стационарная работа, не автономный запуск.</p></>}
      <InputLimits {...props} /></>}
  </section>;
}
