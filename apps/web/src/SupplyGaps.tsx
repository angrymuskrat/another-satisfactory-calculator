import { purity } from '../../../packages/domain/gameMechanics';
import { useMemo, useState } from 'react';
import { ArrowRight, Drill } from 'lucide-react';
import { hasSolution, type Catalog, type Plan, type Source } from '../../../packages/domain/types';
import { supplyChange, type SupplyGap } from '../../../packages/domain/supplyGap';
import { effectivePlan } from '../../../packages/domain/availability';
import { format, ItemIcon, NumberField, unit } from './controls';
import { useSolver } from './useSolver';
import './supplyGaps.css';

interface Choice { rate: number; minerId: string | null; purity: Source['purity']; sourceId: string }
export function SupplyGaps({ catalog, plan, gaps, setPlan }: { catalog: Catalog; plan: Plan; gaps: SupplyGap[]; setPlan: (value: Plan) => void }) {
  const miners = (id: string) => catalog.miners.filter(m => m.resourceIds.includes(id) && (!plan.world || plan.world.unlockedBuildingIds.includes(m.id)));
  const [editing, setEditing] = useState(false);
  const [choices, setChoices] = useState<Record<string, Choice>>(() => Object.fromEntries(gaps.map(g => [g.itemId, {
    rate: Math.ceil(g.extra * 1e6) / 1e6, minerId: miners(g.itemId)[0]?.id ?? null, purity: 1, sourceId: crypto.randomUUID(),
  }])));
  const change = (id: string, values: Partial<Choice>) => setChoices(current => ({ ...current, [id]: { ...current[id], ...values } }));
  const preview = useMemo(() => {
    let next: Plan | null = plan;
    for (const gap of gaps) {
      const choice = choices[gap.itemId];
      if (!choice) return null;
      next = supplyChange(catalog, next, gap, choice.rate, choice.minerId, choice.purity, choice.sourceId);
      if (!next) return null;
    }
    return next;
  }, [catalog, plan, gaps, choices]);
  const verify = useSolver(catalog, preview ?? plan);
  const verified = !verify.stale && [...verify.report?.variants ?? [], ...verify.report?.workingPlans ?? []].find(v => hasSolution(v.result) && v.result.products.some(p => p.rate > 0));
  const transport = effectivePlan(catalog, plan).settings;
  return <section className="panel supply-gaps" aria-label="Недостающее снабжение">
    <h2>Где добавить снабжение</h2>
    <p>{plan.mode === 'target' || plan.batch ? 'Для материального баланса заказа' : 'Для примера выпуска в заданных количествах в минуту'} можно добавить следующие входы. Проверка машин, энергии и отвода остатков доступна в предпросмотре.</p>
    {gaps.map(g => {
      const item = catalog.items.find(i => i.id === g.itemId)!;
      const c = choices[g.itemId];
      const added = preview?.sources.find(s => s.id === c.sourceId);
      const miner = catalog.miners.find(m => m.id === added?.minerId);
      const line = item.fluid ? catalog.pipes.find(p => p.id === transport.pipeId) : catalog.belts.find(b => b.id === transport.beltId);
      const consumers = g.consumers.map(id => catalog.recipes.find(r => r.id === id)?.name ?? id);
      return <div className="supply-proposal" key={item.id}>
        <div className="supply-branch"><div className="proposed-source"><Drill size={20} aria-hidden="true"/><span>{added?.kind === 'node' ? `${added.count} × ${miner?.name}` : added ? 'Внешняя поставка' : 'Вход фабрики'}</span></div>
          <ArrowRight aria-hidden="true"/><div><strong><ItemIcon item={item} size={24}/> {item.name}</strong><small>Далее → {consumers.join(', ') || 'отгрузка заказа'}</small></div></div>
        <p>Доступно {format(g.available, 6)} · Для этой цепочки {format(g.available + g.extra, 6)} · Добавить {format(g.extra, 6)} {unit(item)}.</p>
        {g.minimumExtra != null && g.minimumExtra > 1e-7 && <p className="hint">При доступных рецептах потребуется ещё как минимум {format(g.minimumExtra, 6)} {unit(item)} этого сырья.</p>}
        {editing && <div className="supply-fields">
          <label className="field-label">Дополнительный поток<NumberField label={'Дополнительный поток — ' + item.name} value={c.rate} min={1e-6} max={1e9} suffix={unit(item)} onChange={rate => change(item.id, { rate })}/></label>
          <label className="field-label">Источник<select aria-label={'Источник — ' + item.name} value={c.minerId ?? ''} onChange={e => change(item.id, { minerId: e.target.value || null })}>
            <option value="">Внешняя поставка</option>{miners(item.id).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
          {c.minerId && c.minerId !== 'water-extractor' && <label className="field-label">Чистота узла<select value={c.purity} onChange={e => change(item.id, { purity: Number(e.target.value) as Source['purity'] })}><option value={purity.impure}>Низкая</option><option value={purity.normal}>Обычная</option><option value={purity.pure}>Высокая</option></select></label>}
        </div>}
        {editing && added?.kind === 'node' && <p className="hint">{added.count} × {miner?.name} на 100%. На каждом выходе {line?.name} до {format(line?.rate ?? 0)} {unit(item)}. Проверьте доступность узлов в своём мире.</p>}
        {editing && added?.kind === 'flow' && <p className="hint">Внешний поток {format(added.limit ?? 0, 6)} {unit(item)}. Энергия поставщика неизвестна.</p>}
        {editing && preview?.settings.inputLimits?.[item.id] !== plan.settings.inputLimits?.[item.id] && <p>Общий лимит входа изменится с {format(plan.settings.inputLimits?.[item.id] ?? 0)} до {format(preview?.settings.inputLimits?.[item.id] ?? 0, 6)} {unit(item)}.</p>}
      </div>;
    })}
    {!editing ? <button className="secondary-button" onClick={() => setEditing(true)}>Добавить источник…</button> : <>
      <p className="hint">Проверка полной фабрики учитывает также энергию, машины и переработку остатков.</p>
      <div className="supply-actions"><button className="secondary-button" disabled={!preview || verify.running} onClick={() => verify.calculate()}>Проверить снабжение</button>
        <button className="primary-button" disabled={!preview} onClick={() => preview && setPlan(preview)}>Применить снабжение</button>
        <button className="text-button" onClick={() => { verify.cancel(); setEditing(false); }}>Закрыть</button></div>
      <p role="status">{!preview ? 'Эту конфигурацию источников нельзя добавить. Проверьте количество узлов и лимиты.' : verified ? 'С предложенным снабжением подтверждён выпуск.' : verify.running ? 'Проверяем фабрику с новыми источниками…' : !verify.stale && verify.report ? 'Полный расчёт пока не подтвердил рабочий план.' : ''}</p>
      {verified && <ul>{verified.result.products.map(p => {
        const product = catalog.items.find(i => i.id === p.itemId);
        return <li key={p.itemId}>{product?.name ?? p.itemId} · {format(p.rate, 6)} {unit(product)}</li>;
      })}</ul>}
    </>}
  </section>;
}
