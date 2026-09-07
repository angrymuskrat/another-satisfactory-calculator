import { Plus, Trash2 } from 'lucide-react';
import type { Catalog, Plan, Result } from '../../../packages/domain/types';
import { batchEstimate } from '../../../packages/domain/batch';
import { format, ItemSelect, NumberField, unit } from './controls';

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
      <div><span className="eyebrow">ПАРТИЯ</span><h2>Заказ по количеству</h2></div>
      <label className="switch"><input aria-label="Режим партии" type="checkbox" checked={!!batch} onChange={event => setEnabled(event.target.checked)} /><span /></label>
    </div>
    {!batch ? <p className="hint">Задайте количество, запас и срок для деталей лифта, исследований или склада.</p> : <>
      <label><span className="field-label">Желаемое время, минут</span><NumberField label="Желаемое время партии, минут" value={batch.minutes} min={0.000001} onChange={minutes => setPlan({ ...plan, batch: { ...batch, minutes } })} /></label>
      <div className="targets-header" style={{ gridTemplateColumns: 'minmax(140px, 1fr) 90px 90px 28px' }}><span>Предмет</span><span>Требуется</span><span>На складе</span><span /></div>
      <div className="target-list">{batch.items.map((row, index) => {
        const selected = catalog.items.find(item => item.id === row.itemId);
        return <div className="target-entry" key={index}><div className="target-row" style={{ gridTemplateColumns: 'minmax(140px, 1fr) 90px 90px 28px' }}>
          <ItemSelect label={`Предмет партии ${index + 1}`} items={catalog.items.filter(item => item.id === row.itemId || !batch.items.some(other => other.itemId === item.id))} value={row.itemId} onChange={itemId => updateItem(index, { itemId })} />
          <label><span className="batch-input-label">Требуется</span><NumberField label={`Требуется: ${selected?.name ?? row.itemId}`} value={row.required} onChange={required => updateItem(index, { required })} /></label>
          <label><span className="batch-input-label">На складе</span><NumberField label={`На складе: ${selected?.name ?? row.itemId}`} value={row.stock} onChange={stock => updateItem(index, { stock })} /></label>
          <button type="button" className="icon-button danger" aria-label={`Удалить из партии: ${selected?.name ?? row.itemId}`} disabled={batch.items.length === 1} onClick={() => setPlan({ ...plan, batch: { ...batch, items: batch.items.filter((_, i) => i !== index) } })}><Trash2 size={16} /></button>
        </div></div>;
      })}</div>
      <button type="button" className="secondary-button" disabled={!addable} onClick={() => addable && setPlan({ ...plan, batch: { ...batch, items: [...batch.items, { itemId: addable.id, required: 100, stock: 0 }] } })}><Plus size={15} />Добавить позицию</button>
      <p className="hint">При расчёте остаток партии преобразуется в заданный выпуск. Запас учитывается один раз и не становится источником фабрики.</p>
    </>}
  </section>;
}

export function BatchResult({ catalog, plan, result }: BatchResultProps) {
  const estimate = batchEstimate(plan, result);
  if (!estimate) return null;
  const item = (itemId: string) => catalog.items.find(value => value.id === itemId);
  const amountUnit = (itemId: string) => item(itemId)?.fluid ? 'м³' : 'шт';
  return <section className="panel output-panel batch-result">
    {estimate.items.every(i => i.remaining === 0) && <p role="status">Партия готова: всё необходимое уже на складе.</p>}
    <div className="section-heading"><div><span className="eyebrow">ПАРТИЯ</span><h3>Оценка партии</h3></div><strong>{estimate.minutes == null ? 'Срок недостижим' : `${format(estimate.minutes, 2)} мин`}</strong></div>
    {estimate.items.map(row => {
      const current = item(row.itemId);
      return <div className="output-row" key={row.itemId}><div><strong>{current?.name ?? row.itemId}</strong><small>Осталось {format(row.remaining, 6)} {amountUnit(row.itemId)} из {format(row.required, 6)} {amountUnit(row.itemId)}</small></div><div className="output-rate">{row.remaining === 0 ? <>0<small>производство не требуется</small></> : Number.isFinite(row.minutes) ? <>{format(row.minutes, 2)}<small>мин · {format(row.rate, 6)} {unit(current)}</small></> : <>∞<small>поток отсутствует</small></>}</div></div>;
    })}
    <p className="hint">Оценка времени после выхода фабрики на режим. Запуск и заполнение конвейеров не моделируются.</p>
  </section>;
}
