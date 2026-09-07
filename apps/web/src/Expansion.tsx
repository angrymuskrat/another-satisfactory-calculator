import type { Plan, Source } from '../../../packages/domain/types';
import type { PlanProps } from './Planner';
import { amplifierSlots } from '../../../packages/domain/production';
import { ItemSelect, NumberField } from './controls';

export function Expansion({ catalog, plan, setPlan }: PlanProps) {
  const lines = plan.lines ?? [];
  const update = (id: string, patch: Partial<NonNullable<Plan['lines']>[number]>) => setPlan({ ...plan, lines: lines.map(l => l.id === id ? { ...l, ...patch } : l) });
  return <section className="panel"><details><summary>Расширение фабрики и усилители</summary>
    <p className="hint">Опишите уже построенные производственные машины. Закрепление сохраняет рецепт, частоту и долю работы. Свободная линия может использовать весь запас своей мощности.</p>
    <label className="field-label">Способ расширения<select aria-label="Способ расширения" value={plan.expansion ?? 'add'} onChange={e => setPlan({ ...plan, expansion: e.target.value as Plan['expansion'] })}><option value="keep">Оставить — только существующее производство</option><option value="add">Добавить — сохранить линии и достроить</option><option value="rebuild">Перестроить — разрешить замену всех линий</option></select></label>
    <label className="field-label">Доступно Somersloops<NumberField label="Бюджет Somersloops" value={plan.somersloopBudget ?? 0} step={1} max={1000000} onChange={somersloopBudget => setPlan({ ...plan, somersloopBudget })} /></label>
    <p className="hint">Распределение выбирается решателем на физических машинах при заданных частотах. Поддерживается и плавильня: один Somersloop удваивает выпуск и увеличивает мощность в четыре раза.</p>
    {lines.map((l, i) => <fieldset className="source-card" key={l.id}><legend>Линия {i + 1}</legend>
      <label className="field-label">Название<input aria-label={`Название линии ${i + 1}`} value={l.name} maxLength={120} onChange={e => update(l.id, { name: e.target.value })} /></label>
      <label className="field-label">Рецепт<select aria-label={`Рецепт линии ${i + 1}`} value={l.recipeId} onChange={e => update(l.id, { recipeId: e.target.value, somersloops: 0 })}>{catalog.recipes.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
      <div className="target-bounds"><label className="field-label">Построено<NumberField label={`Машин линии ${i + 1}`} value={l.count} min={1} max={1000000} step={1} onChange={count => update(l.id, { count })} /></label>
        <label className="field-label">Частота, %<NumberField label={`Частота линии ${i + 1}`} value={l.clock} min={1} max={250} onChange={clock => update(l.id, { clock })} /></label>
        <label className="field-label">Доля работы, %<NumberField label={`Доля работы линии ${i + 1}`} value={l.duty * 100} max={100} disabled={!l.locked} onChange={duty => update(l.id, { duty: duty / 100 })} /></label>
        <label className="field-label">Somersloops на машину<NumberField label={`Усилители линии ${i + 1}`} value={l.somersloops} max={amplifierSlots(catalog.recipes.find(r => r.id === l.recipeId)?.buildingId ?? '')} step={1} onChange={somersloops => update(l.id, { somersloops })} /></label></div>
      <label className="inline-check"><input type="checkbox" checked={l.locked} onChange={e => update(l.id, { locked: e.target.checked })} />Закрепить выпуск линии {i + 1}</label>
      <button className="text-button" onClick={() => setPlan({ ...plan, lines: lines.filter(x => x.id !== l.id) })}>Удалить линию {i + 1}</button>
    </fieldset>)}
    <button className="text-button" onClick={() => { const recipe = catalog.recipes.find(r => plan.settings.enabledRecipeIds.includes(r.id)); if (recipe) setPlan({ ...plan, lines: [...lines, { id: crypto.randomUUID(), name: `Линия ${lines.length + 1}`, recipeId: recipe.id, count: 1, clock: plan.settings.clock, somersloops: 0, duty: 1, locked: true }] }); }}>Добавить построенную линию</button>
  </details></section>;
}

export function SourceDetails({ source, index, update }: { source: Source; index: number; update: (patch: Partial<Source>) => void }) {
  return <details><summary>Заметка, резерв и энергия импорта</summary>
    <label className="field-label">Заметка<textarea aria-label={`Заметка источника ${index}`} value={source.notes ?? ''} maxLength={2000} onChange={e => update({ notes: e.target.value })} /></label>
    <label className="field-label">Резерв для других фабрик, в минуту<NumberField label={`Резерв источника ${index}`} value={source.reserve ?? 0} onChange={reserve => update({ reserve })} /></label>
    {source.limit === null && source.kind === 'flow' && !!source.reserve && <p role="alert">Резерв требует конечного лимита источника.</p>}
    {source.kind === 'flow' && <><label className="inline-check"><input aria-label={`Известная энергия импорта ${index}`} type="checkbox" checked={source.importPower != null} onChange={e => update({ importPower: e.target.checked ? 0 : null })} />Задать энергию получения внешнего потока</label>
      {source.importPower != null && <label className="field-label">МВт на единицу потока в минуту<NumberField label={`Энергия импорта ${index}`} value={source.importPower} onChange={importPower => update({ importPower })} /></label>}</>}
  </details>;
}

export function WellControls({ source, index, update }: { source: Source; index: number; update: (patch: Partial<Source>) => void }) {
  const satellites = source.well?.satellites ?? [];
  return <div className="full-width"><label className="field-label">Частота общего компенсатора<NumberField label={`Частота скважины ${index}`} value={source.clock} min={1} max={250} onChange={clock => update({ clock })} /></label>
    {satellites.map((n, i) => <div className="target-bounds" key={i}><label className="field-label">Чистота спутников<select aria-label={`Чистота спутника ${index}.${i + 1}`} value={n.purity} onChange={e => update({ well: { satellites: satellites.map((s, j) => i === j ? { ...s, purity: Number(e.target.value) as Source['purity'] } : s) } })}><option value={0.5}>Низкая</option><option value={1}>Обычная</option><option value={2}>Высокая</option></select></label>
      <label className="field-label">Количество спутников<NumberField label={`Спутников скважины ${index}.${i + 1}`} value={n.count} min={1} max={100} step={1} onChange={count => update({ well: { satellites: satellites.map((s, j) => i === j ? { ...s, count } : s) } })} /></label><button className="text-button" disabled={satellites.length <= 1} onClick={() => update({ well: { satellites: satellites.filter((_, j) => i !== j) } })}>Удалить группу {i + 1}</button></div>)}
    <button className="text-button" disabled={satellites.length >= 32} onClick={() => update({ well: { satellites: [...satellites, { purity: 1, count: 1 }] } })}>Добавить группу спутников</button>
    <p className="hint">Один компенсатор обслуживает все спутники. Пока скважина используется, учтена полная мощность на выбранной частоте. Выход каждой трубы ограничивается отдельно.</p>
  </div>;
}

export function Exports({ catalog, plan, setPlan }: PlanProps) {
  const rows = plan.exports ?? [];
  return <section className="panel"><details><summary>Отгрузка побочных продуктов</summary><p className="hint">Укажите реального постоянного потребителя и максимальный поток. Отгрузка не создаёт автоматически источник в другом плане.</p>
    {rows.map((row, i) => <div className="source-card" key={i}><ItemSelect label={`Отгрузка ${i + 1}`} items={catalog.items.filter(x => x.id === row.itemId || !rows.some(r => r.itemId === x.id))} value={row.itemId} onChange={itemId => setPlan({ ...plan, exports: rows.map((r, j) => i === j ? { ...r, itemId } : r) })} />
      <label className="field-label">Получатель<input aria-label={`Получатель отгрузки ${i + 1}`} value={row.name} maxLength={120} onChange={e => setPlan({ ...plan, exports: rows.map((r, j) => i === j ? { ...r, name: e.target.value } : r) })} /></label>
      <label className="field-label">Максимум в минуту<NumberField label={`Лимит отгрузки ${i + 1}`} value={row.limit} onChange={limit => setPlan({ ...plan, exports: rows.map((r, j) => i === j ? { ...r, limit } : r) })} /></label>
      <button className="text-button" onClick={() => setPlan({ ...plan, exports: rows.filter((_, j) => i !== j) })}>Удалить отгрузку {i + 1}</button></div>)}
    <button className="text-button" onClick={() => { const item = catalog.items.find(x => !rows.some(r => r.itemId === x.id)); if (item) setPlan({ ...plan, exports: [...rows, { itemId: item.id, limit: 60, name: '' }] }); }}>Добавить отгрузку</button>
  </details></section>;
}
