import { Plus, Trash2 } from 'lucide-react';
import type { Catalog, Plan, Result } from '../../../packages/domain/types';
import { batchEstimate } from '../../../packages/domain/batch';
import { format, ItemSelect, NumberField, unit } from './controls';
import { messages, useT } from './i18n';
import { gameName } from './i18n/gameNames';

export interface BatchEditorProps {
  catalog: Catalog;
  plan: Plan;
  setPlan: (plan: Plan) => void;
}

export interface BatchResultProps {
  catalog: Catalog;
  plan: Plan;
  result: Result;
}

export function BatchEditor({ catalog, plan, setPlan }: BatchEditorProps) {
  // Тест вызывает редактор как обычную функцию вне React, где хук недоступен.
  const t = messages();
  const batch = plan.batch;
  const setEnabled = (enabled: boolean) => {
    if (!enabled) {
      const { batch: _batch, ...withoutBatch } = plan;
      setPlan(withoutBatch);
      return;
    }
    const itemId = plan.targets.find(target => catalog.items.some(item => item.id === target.itemId))?.itemId
      ?? catalog.items.find(item => !item.raw)?.id
      ?? catalog.items[0]?.id;
    if (itemId) setPlan({ ...plan, batch: { minutes: 60, items: [{ itemId, required: 100, stock: 0 }] } });
  };
  const updateItem = (index: number, patch: Partial<NonNullable<Plan['batch']>['items'][number]>) => {
    if (!batch) return;
    setPlan({ ...plan, batch: { ...batch, items: batch.items.map((item, i) => i === index ? { ...item, ...patch } : item) } });
  };
  const addable = catalog.items.find(item => !batch?.items.some(row => row.itemId === item.id));
  return <section className="panel batch-panel">
    <div className="section-heading">
      <div><h2>{t.batch.title}</h2></div>
      <label className="switch"><input aria-label={t.batch.modeLabel} type="checkbox" checked={!!batch} onChange={event => setEnabled(event.target.checked)} /><span /></label>
    </div>
    {!batch ? <p className="hint">{t.batch.hint}</p> : <>
      <label><span className="field-label">{t.batch.timeLabel}</span><NumberField label={t.batch.timeFieldLabel} value={batch.minutes} min={0.000001} onChange={minutes => setPlan({ ...plan, batch: { ...batch, minutes } })} /></label>
      <div className="targets-header" style={{ gridTemplateColumns: 'minmax(140px, 1fr) 90px 90px 28px' }}><span>{t.batch.itemHeader}</span><span>{t.batch.requiredHeader}</span><span>{t.batch.stockHeader}</span><span /></div>
      <div className="target-list">{batch.items.map((row, index) => {
        const selected = catalog.items.find(item => item.id === row.itemId);
        const selectedName = selected ? gameName('item', selected.id, selected.name) : row.itemId;
        return <div className="target-entry" key={index}><div className="target-row" style={{ gridTemplateColumns: 'minmax(140px, 1fr) 90px 90px 28px' }}>
          <ItemSelect label={t.batch.itemLabel(index + 1)} items={catalog.items.filter(item => item.id === row.itemId || !batch.items.some(other => other.itemId === item.id))} value={row.itemId} onChange={itemId => updateItem(index, { itemId })} />
          <label><span className="batch-input-label">{t.batch.requiredHeader}</span><NumberField label={t.batch.requiredLabel(selectedName)} value={row.required} onChange={required => updateItem(index, { required })} /></label>
          <label><span className="batch-input-label">{t.batch.stockHeader}</span><NumberField label={t.batch.stockLabel(selectedName)} value={row.stock} onChange={stock => updateItem(index, { stock })} /></label>
          <button type="button" className="icon-button danger" aria-label={t.batch.removeLabel(selectedName)} disabled={batch.items.length === 1} onClick={() => setPlan({ ...plan, batch: { ...batch, items: batch.items.filter((_, i) => i !== index) } })}><Trash2 size={16} /></button>
        </div></div>;
      })}</div>
      <button type="button" className="secondary-button" disabled={!addable} onClick={() => addable && setPlan({ ...plan, batch: { ...batch, items: [...batch.items, { itemId: addable.id, required: 100, stock: 0 }] } })}><Plus size={15} />{t.batch.addItem}</button>
      <p className="hint">{t.batch.convertHint}</p>
    </>}
  </section>;
}

export function BatchResult({ catalog, plan, result }: BatchResultProps) {
  const t = useT();
  const estimate = batchEstimate(plan, result);
  if (!estimate) return null;
  const item = (itemId: string) => catalog.items.find(value => value.id === itemId);
  const amountUnit = (itemId: string) => item(itemId)?.fluid ? t.recipes.unitFluid : t.recipes.unitSolid;
  return <section className="panel output-panel batch-result">
    {estimate.items.every(i => i.remaining === 0) && <p role="status">{t.batch.ready}</p>}
    <div className="section-heading"><div><h3>{t.batch.estimate}</h3></div><strong>{estimate.minutes == null ? t.batch.unreachable : t.batch.minutes(format(estimate.minutes, 2))}</strong></div>
    {estimate.items.map(row => {
      const current = item(row.itemId);
      return <div className="output-row" key={row.itemId}><div><strong>{current ? gameName('item', current.id, current.name) : row.itemId}</strong><small>{t.batch.remaining(format(row.remaining, 6), amountUnit(row.itemId), format(row.required, 6))}</small></div><div className="output-rate">{row.remaining === 0 ? <>0<small>{t.batch.noProduction}</small></> : Number.isFinite(row.minutes) ? <>{format(row.minutes, 2)}<small>{t.batch.minutesRate(format(row.rate, 6), unit(current))}</small></> : <>∞<small>{t.batch.noFlow}</small></>}</div></div>;
    })}
    <p className="hint">{t.batch.estimateHint}</p>
  </section>;
}
