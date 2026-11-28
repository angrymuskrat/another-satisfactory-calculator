import { MAX_CLOCK_PERCENT, MIN_CLOCK_PERCENT, purity } from '../../../packages/domain/gameMechanics';
import type { Plan, Source } from '../../../packages/domain/types';
import type { PlanProps } from './Planner';
import { amplifierSlots } from '../../../packages/domain/production';
import { ItemSelect, NumberField } from './controls';
import { useT } from './i18n';
import { gameName } from './i18n/gameNames';

export function Expansion({ catalog, plan, setPlan }: PlanProps) {
  const t = useT();
  const lines = plan.lines ?? [];
  const update = (id: string, patch: Partial<NonNullable<Plan['lines']>[number]>) => setPlan({ ...plan, lines: lines.map(l => l.id === id ? { ...l, ...patch } : l) });
  return <section className="panel"><details><summary>{t.expansion.summary}</summary>
    <p className="hint">{t.expansion.intro}</p>
    <label className="field-label">{t.expansion.method}<select aria-label={t.expansion.method} value={plan.expansion ?? 'add'} onChange={e => setPlan({ ...plan, expansion: e.target.value as Plan['expansion'] })}><option value="keep">{t.expansion.methodKeep}</option><option value="add">{t.expansion.methodAdd}</option><option value="rebuild">{t.expansion.methodRebuild}</option></select></label>
    <label className="field-label">{t.expansion.somersloopsAvailable}<NumberField label={t.expansion.somersloopBudget} value={plan.somersloopBudget ?? 0} step={1} max={1000000} onChange={somersloopBudget => setPlan({ ...plan, somersloopBudget })} /></label>
    <p className="hint">{t.expansion.distributionHint}</p>
    {lines.map((l, i) => <fieldset className="source-card" key={l.id}><legend>{t.expansion.line(i + 1)}</legend>
      <label className="field-label">{t.expansion.name}<input aria-label={t.expansion.lineNameLabel(i + 1)} value={l.name} maxLength={120} onChange={e => update(l.id, { name: e.target.value })} /></label>
      <label className="field-label">{t.expansion.recipe}<select aria-label={t.expansion.lineRecipeLabel(i + 1)} value={l.recipeId} onChange={e => update(l.id, { recipeId: e.target.value, somersloops: 0 })}>{catalog.recipes.map(r => <option key={r.id} value={r.id}>{gameName('recipe', r.id, r.name)}</option>)}</select></label>
      <div className="target-bounds"><label className="field-label">{t.expansion.built}<NumberField label={t.expansion.machinesLabel(i + 1)} value={l.count} min={1} max={1000000} step={1} onChange={count => update(l.id, { count })} /></label>
        <label className="field-label">{t.expansion.clockPercent}<NumberField label={t.expansion.lineClockLabel(i + 1)} value={l.clock} min={MIN_CLOCK_PERCENT} max={MAX_CLOCK_PERCENT} onChange={clock => update(l.id, { clock })} /></label>
        <label className="field-label">{t.expansion.dutyPercent}<NumberField label={t.expansion.lineDutyLabel(i + 1)} value={l.duty * 100} max={100} disabled={!l.locked} onChange={duty => update(l.id, { duty: duty / 100 })} /></label>
        <label className="field-label">{t.expansion.somersloopsPerMachine}<NumberField label={t.expansion.lineAmplifiersLabel(i + 1)} value={l.somersloops} max={amplifierSlots(catalog.recipes.find(r => r.id === l.recipeId)?.buildingId ?? '')} step={1} onChange={somersloops => update(l.id, { somersloops })} /></label></div>
      <label className="inline-check"><input type="checkbox" checked={l.locked} onChange={e => update(l.id, { locked: e.target.checked })} />{t.expansion.lockLine(i + 1)}</label>
      <button className="text-button" onClick={() => setPlan({ ...plan, lines: lines.filter(x => x.id !== l.id) })}>{t.expansion.removeLine(i + 1)}</button>
    </fieldset>)}
    <button className="text-button" onClick={() => { const recipe = catalog.recipes.find(r => plan.settings.enabledRecipeIds.includes(r.id)); if (recipe) setPlan({ ...plan, lines: [...lines, { id: crypto.randomUUID(), name: t.expansion.line(lines.length + 1), recipeId: recipe.id, count: 1, clock: plan.settings.clock, somersloops: 0, duty: 1, locked: true }] }); }}>{t.expansion.addLine}</button>
  </details></section>;
}

export function SourceDetails({ source, index, update }: { source: Source; index: number; update: (patch: Partial<Source>) => void }) {
  const t = useT();
  return <details><summary>{t.expansion.sourceSummary}</summary>
    <label className="field-label">{t.expansion.note}<textarea aria-label={t.expansion.sourceNoteLabel(index)} value={source.notes ?? ''} maxLength={2000} onChange={e => update({ notes: e.target.value })} /></label>
    <label className="field-label">{t.expansion.reserve}<NumberField label={t.expansion.sourceReserveLabel(index)} value={source.reserve ?? 0} onChange={reserve => update({ reserve })} /></label>
    {source.limit === null && source.kind === 'flow' && !!source.reserve && <p role="alert">{t.expansion.reserveNeedsLimit}</p>}
    {source.kind === 'flow' && <><label className="inline-check"><input aria-label={t.expansion.knownImportPower(index)} type="checkbox" checked={source.importPower != null} onChange={e => update({ importPower: e.target.checked ? 0 : null })} />{t.expansion.setImportPower}</label>
      {source.importPower != null && <label className="field-label">{t.expansion.importPowerUnit}<NumberField label={t.expansion.importPowerLabel(index)} value={source.importPower} onChange={importPower => update({ importPower })} /></label>}</>}
  </details>;
}

export function WellControls({ source, index, update }: { source: Source; index: number; update: (patch: Partial<Source>) => void }) {
  const t = useT();
  const satellites = source.well?.satellites ?? [];
  return <div className="full-width"><label className="field-label">{t.expansion.wellClock}<NumberField label={t.expansion.wellClockLabel(index)} value={source.clock} min={MIN_CLOCK_PERCENT} max={MAX_CLOCK_PERCENT} onChange={clock => update({ clock })} /></label>
    {satellites.map((n, i) => <div className="target-bounds" key={i}><label className="field-label">{t.expansion.satellitePurity}<select aria-label={t.expansion.satellitePurityLabel(index, i + 1)} value={n.purity} onChange={e => update({ well: { satellites: satellites.map((s, j) => i === j ? { ...s, purity: Number(e.target.value) as Source['purity'] } : s) } })}><option value={purity.impure}>{t.expansion.purityLow}</option><option value={purity.normal}>{t.expansion.purityNormal}</option><option value={purity.pure}>{t.expansion.purityHigh}</option></select></label>
      <label className="field-label">{t.expansion.satelliteCount}<NumberField label={t.expansion.satelliteCountLabel(index, i + 1)} value={n.count} min={1} max={100} step={1} onChange={count => update({ well: { satellites: satellites.map((s, j) => i === j ? { ...s, count } : s) } })} /></label><button className="text-button" disabled={satellites.length <= 1} onClick={() => update({ well: { satellites: satellites.filter((_, j) => i !== j) } })}>{t.expansion.removeGroup(i + 1)}</button></div>)}
    <button className="text-button" disabled={satellites.length >= 32} onClick={() => update({ well: { satellites: [...satellites, { purity: 1, count: 1 }] } })}>{t.expansion.addGroup}</button>
    <p className="hint">{t.expansion.wellHint}</p>
  </div>;
}

export function Exports({ catalog, plan, setPlan }: PlanProps) {
  const t = useT();
  const rows = plan.exports ?? [];
  return <section className="panel"><details><summary>{t.expansion.exportsSummary}</summary><p className="hint">{t.expansion.exportsHint}</p>
    <label className="inline-check"><input type="checkbox" checked={!!plan.settings.processFluidsOnSite} onChange={e => setPlan({ ...plan, settings: { ...plan.settings, processFluidsOnSite: e.target.checked } })} />{t.expansion.processFluids}</label>
    {plan.settings.processFluidsOnSite && <p className="hint">{t.expansion.processFluidsHint}</p>}
    {rows.map((row, i) => <div className="source-card" key={i}><ItemSelect label={t.expansion.exportLabel(i + 1)} items={catalog.items.filter(x => x.id === row.itemId || !rows.some(r => r.itemId === x.id))} value={row.itemId} onChange={itemId => setPlan({ ...plan, exports: rows.map((r, j) => i === j ? { ...r, itemId } : r) })} />
      <label className="field-label">{t.expansion.recipient}<input aria-label={t.expansion.exportRecipientLabel(i + 1)} value={row.name} maxLength={120} onChange={e => setPlan({ ...plan, exports: rows.map((r, j) => i === j ? { ...r, name: e.target.value } : r) })} /></label>
      {!row.name.trim() && <p className="hint">{t.expansion.recipientHint}</p>}
      <label className="field-label">{t.expansion.maxPerMinute}<NumberField label={t.expansion.exportLimitLabel(i + 1)} value={row.limit} onChange={limit => setPlan({ ...plan, exports: rows.map((r, j) => i === j ? { ...r, limit } : r) })} /></label>
      <button className="text-button" onClick={() => setPlan({ ...plan, exports: rows.filter((_, j) => i !== j) })}>{t.expansion.removeExport(i + 1)}</button></div>)}
    <button className="text-button" onClick={() => { const item = catalog.items.find(x => !rows.some(r => r.itemId === x.id)); if (item) setPlan({ ...plan, exports: [...rows, { itemId: item.id, limit: 60, name: '' }] }); }}>{t.expansion.addExport}</button>
  </details></section>;
}
