import { purity } from '../../../packages/domain/gameMechanics';
import { useMemo, useState } from 'react';
import { ArrowRight, Drill } from 'lucide-react';
import { hasSolution, type Catalog, type Plan, type Source } from '../../../packages/domain/types';
import { supplyChange, type SupplyGap } from '../../../packages/domain/supplyGap';
import { effectivePlan } from '../../../packages/domain/availability';
import { format, ItemIcon, NumberField, unit } from './controls';
import { useSolver } from './useSolver';
import { useT } from './i18n';
import { gameName } from './i18n/gameNames';
import './supplyGaps.css';

interface Choice { rate: number; minerId: string | null; purity: Source['purity']; sourceId: string }
export function SupplyGaps({ catalog, plan, gaps, setPlan }: { catalog: Catalog; plan: Plan; gaps: SupplyGap[]; setPlan: (value: Plan) => void }) {
  const text = useT().supplyGaps;
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
  return <section className="panel supply-gaps" aria-label={text.label}>
    <h2>{text.title}</h2>
    <p>{text.intro(plan.mode === 'target' || !!plan.batch)}</p>
    {gaps.map(g => {
      const item = catalog.items.find(i => i.id === g.itemId)!;
      const c = choices[g.itemId];
      const added = preview?.sources.find(s => s.id === c.sourceId);
      const miner = catalog.miners.find(m => m.id === added?.minerId);
      const line = item.fluid ? catalog.pipes.find(p => p.id === transport.pipeId) : catalog.belts.find(b => b.id === transport.beltId);
      const consumers = g.consumers.map(id => gameName('recipe', id, catalog.recipes.find(r => r.id === id)?.name ?? id));
      const itemName = gameName('item', item.id, item.name);
      const minerName = (id: string, fallback: string | undefined) => gameName('miner', id, fallback ?? id);
      return <div className="supply-proposal" key={item.id}>
        <div className="supply-branch"><div className="proposed-source"><Drill size={20} aria-hidden="true"/><span>{added?.kind === 'node' ? text.proposedNode(added.count, miner && minerName(miner.id, miner.name)) : added ? text.externalSupply : text.factoryInput}</span></div>
          <ArrowRight aria-hidden="true"/><div><strong><ItemIcon item={item} size={24}/> {itemName}</strong><small>{text.next(consumers.join(', ') || text.orderShipment)}</small></div></div>
        <p>{text.amounts(format(g.available, 6), format(g.available + g.extra, 6), format(g.extra, 6), unit(item))}</p>
        {g.minimumExtra != null && g.minimumExtra > 1e-7 && <p className="hint">{text.minimumExtra(format(g.minimumExtra, 6), unit(item))}</p>}
        {editing && <div className="supply-fields">
          <label className="field-label">{text.extraFlow}<NumberField label={text.extraFlowLabel(itemName)} value={c.rate} min={1e-6} max={1e9} suffix={unit(item)} onChange={rate => change(item.id, { rate })}/></label>
          <label className="field-label">{text.source}<select aria-label={text.sourceLabel(itemName)} value={c.minerId ?? ''} onChange={e => change(item.id, { minerId: e.target.value || null })}>
            <option value="">{text.externalSupply}</option>{miners(item.id).map(m => <option key={m.id} value={m.id}>{minerName(m.id, m.name)}</option>)}</select></label>
          {c.minerId && c.minerId !== 'water-extractor' && <label className="field-label">{text.purity}<select value={c.purity} onChange={e => change(item.id, { purity: Number(e.target.value) as Source['purity'] })}><option value={purity.impure}>{text.purityLow}</option><option value={purity.normal}>{text.purityNormal}</option><option value={purity.pure}>{text.purityHigh}</option></select></label>}
        </div>}
        {editing && added?.kind === 'node' && <p className="hint">{text.nodeHint(added.count, miner ? minerName(miner.id, miner.name) : '', line ? gameName(item.fluid ? 'pipe' : 'belt', line.id, line.name) : '', format(line?.rate ?? 0), unit(item))}</p>}
        {editing && added?.kind === 'flow' && <p className="hint">{text.flowHint(format(added.limit ?? 0, 6), unit(item))}</p>}
        {editing && preview?.settings.inputLimits?.[item.id] !== plan.settings.inputLimits?.[item.id] && <p>{text.limitChange(format(plan.settings.inputLimits?.[item.id] ?? 0), format(preview?.settings.inputLimits?.[item.id] ?? 0, 6), unit(item))}</p>}
      </div>;
    })}
    {!editing ? <button className="secondary-button" onClick={() => setEditing(true)}>{text.addSource}</button> : <>
      <p className="hint">{text.verifyHint}</p>
      <div className="supply-actions"><button className="secondary-button" disabled={!preview || verify.running} onClick={() => verify.calculate()}>{text.verify}</button>
        <button className="primary-button" disabled={!preview} onClick={() => preview && setPlan(preview)}>{text.apply}</button>
        <button className="text-button" onClick={() => { verify.cancel(); setEditing(false); }}>{text.close}</button></div>
      <p role="status">{!preview ? text.cannotAdd : verified ? text.confirmed : verify.running ? text.verifying : !verify.stale && verify.report ? text.notConfirmed : ''}</p>
      {verified && <ul>{verified.result.products.map(p => {
        const product = catalog.items.find(i => i.id === p.itemId);
        return <li key={p.itemId}>{gameName('item', p.itemId, product?.name ?? p.itemId)} · {format(p.rate, 6)} {unit(product)}</li>;
      })}</ul>}
    </>}
  </section>;
}
