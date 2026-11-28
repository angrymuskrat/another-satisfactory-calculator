import { useEffect, useMemo, useRef, useState } from 'react';
import type { Catalog, Plan, ProductResult } from '../../../packages/domain/types';
import { residueCandidates, sinkAvailable, type ResidueContext, type ResidueRoute } from '../../../packages/solver/residues';
import { sourceLabel } from '../../../packages/domain/sourceLabel';
import { format, NumberField, unit } from './controls';
import { useAnalysis } from './useAnalysis';
import { useT } from './i18n';
import { gameName } from './i18n/gameNames';

type Props = { catalog: Catalog; plan: Plan; result: ResidueContext | null; setPlan: (p: Plan) => void };
const signed = (n: number) => (n > 1e-6 ? '+' : '') + format(n, 3);
const itemName = (catalog: Catalog, id: string) => gameName('item', id, catalog.items.find(i => i.id === id)?.name ?? id);
const recipeName = (catalog: Catalog, id: string) => gameName('recipe', id, catalog.recipes.find(x => x.id === id)?.name ?? id);
export const residueHref = (id: string) => '#residue-' + encodeURIComponent(id);

export function ResidueHelp({ catalog, plan, result, setPlan }: Props) {
  const text = useT().residueHelp;
  const ids = useMemo(() => {
    try { return residueCandidates(catalog, plan, result); }
    catch { return []; } // The calculation already reports an invalid world or plan.
  }, [catalog, plan, result]);
  const [choice, setChoice] = useState('');
  const selector = useRef<HTMLSelectElement>(null);
  const optionsKey = JSON.stringify(ids);
  useEffect(() => {
    const follow = () => {
      const itemId = Array.from(selector.current?.options ?? []).find(option => residueHref(option.value) === location.hash)?.value;
      if (!itemId) return;
      setChoice(itemId);
      selector.current?.focus();
      selector.current?.scrollIntoView({ block: 'center' });
    };
    follow();
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  }, [optionsKey]);
  const id = ids.includes(choice) ? choice : ids[0];
  if (!id || !result) return null;
  return <section className="panel" aria-label={text.label}>
    <h3>{result.products?.some(p => p.rate > 0) ? text.whereToSend : text.whatBlocks}</h3>
    {!result.products?.some(p => p.rate > 0) && <p>{text.mayLeaveResidue}</p>}
    <label className="field-label">{text.byproduct}<select id={'residue-' + id} ref={selector} value={id} onChange={e => {
      setChoice(e.target.value);
      if (location.hash.startsWith('#residue-')) history.replaceState(history.state, '', residueHref(e.target.value));
    }}>
      {ids.map(key => <option key={key} value={key}>{itemName(catalog, key)}</option>)}
    </select></label>
    <ResidueOptions key={JSON.stringify([id, plan.exports, result.products])} catalog={catalog} plan={plan} itemId={id} result={result} setPlan={setPlan} />
  </section>;
}

function ResidueOptions({ catalog, plan, itemId, result, setPlan }: Props & { itemId: string }) {
  const text = useT().residueHelp;
  const item = catalog.items.find(i => i.id === itemId)!;
  const outlet = plan.exports?.find(e => e.itemId === itemId);
  const transport = item.fluid ? catalog.pipes.find(p => p.id === plan.settings.pipeId) : catalog.belts.find(b => b.id === plan.settings.beltId);
  const [limit, setLimit] = useState(outlet?.limit ?? transport?.rate ?? 60);
  const [receiver, setReceiver] = useState(outlet?.name ?? '');
  const [capacity, setCapacity] = useState(0);
  const [reference, setReference] = useState('');
  const [criterion, setCriterion] = useState(plan.settings.objective === 'buildings' || (plan.settings.objective === 'smooth-power' && !plan.settings.pareto && plan.settings.smoothPowerExtraMachines === undefined) ? 'machines' : 'energy');
  const [submitted, setSubmitted] = useState('');
  const analysis = useAnalysis(catalog, plan);
  const request = { kind: 'residues' as const, itemId, limit, receiver, products: result?.products };
  const query = JSON.stringify(request);
  const report = submitted === query ? analysis.report?.residues : null;
  const base = report?.routes.find(r => r.id === reference) ?? report?.routes[0];
  const ranked = report?.routes.filter(r => !r.conditionalReceiver).sort((a, b) => {
    const metric = (route: ResidueRoute) => criterion === 'machines' ? route.machines : criterion === 'energy' ? route.result.power
      : route.result.resources.filter(f => f.itemId === criterion).reduce((sum, f) => sum + f.rate, 0);
    return metric(a) - metric(b);
  }) ?? [];
  const inputs = new Set(ranked.flatMap(r => r.result.resources.filter(f => f.rate > 0).map(f => f.itemId)));
  const discharge = report?.routes.find(r => r.id === 'export')?.result.exports?.find(f => f.itemId === itemId)?.rate;
  const calculate = () => { setSubmitted(query); setReference(''); analysis.calculate(request); };
  const unlock = catalog.unlocks?.find(u => u.buildingIds.includes('awesome-sink'));
  const sink = catalog.buildings.find(b => b.id === 'awesome-sink');
  return <>
    <div className="target-bounds"><label className="field-label">{text.receiver}<input maxLength={120} value={receiver} placeholder={text.receiverPlaceholder} onChange={e => setReceiver(e.target.value)} /></label>
      <label className="field-label">{text.shipmentLimit(unit(item))}<NumberField label={text.trialLimit} value={limit} max={1e9} onChange={setLimit} /></label></div>
    <button className="secondary-button" disabled={analysis.running} onClick={calculate}>{text.pickProcessing}</button>
    {!item.fluid && item.sinkable && sinkAvailable(catalog, plan) && <button className="text-button" disabled={analysis.running} onClick={calculate}>{text.compareSink}</button>}
    {analysis.running && <p role="status">{text.checkingCopies}{' '}<button className="text-button" onClick={analysis.cancel}>{text.cancelCheck}</button></p>}
    {analysis.error && <p role="alert">{analysis.error}</p>}
    {report && <>
      <p role="status">{text.comparison(report.complete, report.routes.length)}</p>
      {discharge !== undefined && <><p>{text.discharge(format(discharge, 4), unit(item), gameName('item', item.id, item.name), describeFlows(catalog, report.routes.find(r => r.id === 'export')!.result.products))}</p>
        <details><summary>{text.temporaryStorage}</summary><label className="field-label">{text.freeCapacity(!!item.fluid)}<NumberField label={text.freeCapacityLabel} value={capacity} onChange={setCapacity} /></label>
          {capacity > 0 && <p>{text.fillTime(format(capacity / discharge, 2))}</p>}
          <p>{text.batchHint}</p></details></>}
      {ranked.length > 1 && <><label className="field-label">{text.whatToSave}<select value={criterion} onChange={e => setCriterion(e.target.value)}>
        <option value="machines">{text.physicalMachines}</option><option value="energy">{text.countedEnergy}</option>
        {[...inputs].map(id => <option key={id} value={id}>{itemName(catalog, id)}</option>)}</select></label>
        <p>{text.bestByCriterion(ranked[0].label)}</p></>}
      {base && <><label className="field-label">{text.compareCosts}<select value={base.id} onChange={e => setReference(e.target.value)}>
        {report.routes.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select></label>
        {report.routes.map(route => <RouteCard key={route.id} catalog={catalog} input={plan} itemId={itemId} route={route} base={base} setPlan={setPlan} />)}</>}
      {!report.routes.length && <p>{text.noRoute}</p>}
      {!!report.attempts.length && <details><summary>{text.otherChecks(report.attempts.length)}</summary><ul>{report.attempts.map((a, index) => <li key={index}>{text.attempt(a.label, text.statusLabels[a.status], a.message)}</li>)}</ul></details>}
      {sink && (report.routes.some(r => r.result.sinkPower > 0) || (item.sinkable && !item.fluid && !sinkAvailable(catalog, plan))) && <details><summary>{text.sinkTitle}</summary>
        <p>{unlock && text.openedBy(unlock.kind === 'hub', unlock.tier, gameName('schematic', unlock.id, unlock.name))}{text.sinkPower(sink.power)}
        {plan.world && !plan.world.unlockedBuildingIds.includes(sink.id) && text.sinkClosed}
        {!plan.world && text.sinkCheckProgress}</p>
        <p>{sink.buildCost?.length ? text.buildCost(sink.buildCost.map(f => text.buildCostItem(itemName(catalog, f.itemId), format(f.amount))).join(', ')) : text.buildCostUnknown}</p></details>}
    </>}
  </>;
}

function describeFlows(catalog: Catalog, flows: ProductResult[]) {
  return flows.map(f => { const item = catalog.items.find(i => i.id === f.itemId); return `${itemName(catalog, f.itemId)} ${format(f.rate, 4)} ${unit(item)}`; }).join(', ');
}

function RouteCard({ catalog, input, route, base, itemId, setPlan }: { catalog: Catalog; input: Plan; route: ResidueRoute; base: ResidueRoute; itemId: string; setPlan: (p: Plan) => void }) {
  const text = useT().residueHelp;
  const r = route.result;
  const resourceIds = [...new Set([...r.resources, ...base.result.resources].filter(f => f.rate > 0).map(f => f.sourceId))];
  const inputItems = [...new Set([...r.resources, ...base.result.resources].filter(f => f.rate > 0).map(f => f.itemId))];
  const totalInput = (variant: ResidueRoute, id: string) => variant.result.resources.reduce((sum, f) => sum + (f.itemId === id ? f.rate : 0), 0);
  const materials = [...new Set([...route.materials.items, ...base.materials.items].map(f => f.itemId))];
  const machines = new Map([...base.equipment, ...route.equipment].map(g => [g.id, g]));
  const changed = JSON.stringify(route.plan) !== JSON.stringify(input);
  const enabled = route.plan.settings.enabledRecipeIds.filter(id => !input.settings.enabledRecipeIds.includes(id));
  const disabled = input.settings.enabledRecipeIds.filter(id => !route.plan.settings.enabledRecipeIds.includes(id));
  const unknown = resourceIds.map(id => {
    const source = input.sources.find(s => s.id === id);
    const difference = (r.resources.find(f => f.sourceId === id)?.rate ?? 0) - (base.result.resources.find(f => f.sourceId === id)?.rate ?? 0);
    const itemId = (r.resources.find(f => f.sourceId === id) ?? base.result.resources.find(f => f.sourceId === id))!.itemId;
    return { id, itemId, difference, source };
  }).filter(f => (!f.source || (f.source.kind === 'flow' && f.source.importPower == null)) && Math.abs(f.difference) > 1e-6);
  const sameUnknownItem = unknown.length > 0 && unknown.every(f => f.itemId === unknown[0].itemId);
  const unknownRate = sameUnknownItem ? unknown.reduce((sum, f) => sum + f.difference, 0) : 0;
  const unknownItem = catalog.items.find(i => i.id === unknown[0]?.itemId);
  const unknownLabel = unknown.length === 1 ? sourceLabel(catalog, input, unknown[0].id, unknown[0].itemId)
    : unknownItem && gameName('item', unknownItem.id, unknownItem.name);
  const energyDelta = r.power - base.result.power;
  const threshold = Math.abs(unknownRate) > 1e-6 ? -energyDelta * 60 / unknownRate : null;
  const alteredExports = route.plan.exports?.filter(e => {
    const old = input.exports?.find(x => x.itemId === e.itemId);
    return !old || old.limit !== e.limit || old.name !== e.name;
  }) ?? [];
  const receivers = r.steps.filter(s => s.inputs.some(f => f.itemId === itemId && f.rate > 0));
  return <details className="source-card" open><summary>{text.routeTitle(route.label, text.statusLabels[r.status])}</summary>
    <p>{text.routeSummary(describeFlows(catalog, r.products), format(route.localPower, 3), signed(route.localPower - base.localPower), format(r.power, 3), route.machines, signed(route.machines - base.machines))}</p>
    {!!receivers.length && <p>{text.consumption(receivers.map(s => `${recipeName(catalog, s.recipeId)}: ${describeFlows(catalog, s.inputs.filter(f => f.itemId === itemId))}`).join(', '))}</p>}
    {!!r.exports?.length && <p>{text.shipment(r.exports.map(f => `${route.plan.exports?.find(e => e.itemId === f.itemId)?.name}: ${describeFlows(catalog, [f])}`).join(', '))}</p>}
    {r.surplus.length > 0 && <p>{text.toSink(describeFlows(catalog, r.surplus), Math.round(r.sinkPower / catalog.buildings.find(b => b.id === 'awesome-sink')!.power), format(r.sinkPower))}</p>}
    <details><summary>{text.machinesToBuild}</summary><ul>{[...machines.values()].map(g => {
      const current = route.equipment.find(f => f.id === g.id);
      const difference = (current?.added ?? 0) - (base.equipment.find(f => f.id === g.id)?.added ?? 0);
      const catalogBuilding = catalog.buildings.find(b => b.id === g.buildingId), catalogMiner = catalog.miners.find(b => b.id === g.buildingId);
      const buildingName = catalogBuilding?.name ?? catalogMiner?.name ?? g.name;
      const building = catalogBuilding ? gameName('building', g.buildingId, catalogBuilding.name) : catalogMiner ? gameName('miner', g.buildingId, catalogMiner.name) : g.name;
      return <li key={g.id}>{text.machineLine(building, buildingName !== g.name ? g.name : null, current?.added ?? 0, signed(difference), current?.count ?? 0, current ? format(current.clock) : null)}</li>;
    })}</ul></details>
    <details><summary>{text.rawAndMaterials}</summary><ul>{inputItems.map(id => {
      const item = catalog.items.find(i => i.id === id);
      const amount = totalInput(route, id);
      return <li key={id}>{text.inputLine(itemName(catalog, id), format(amount, 4), unit(item), signed(amount - totalInput(base, id)))}</li>;
    })}</ul><p>{text.newBuildingMaterials}</p><ul>{materials.map(id => {
      const quantity = route.materials.items.find(f => f.itemId === id)?.amount ?? 0;
      return <li key={id}>{text.materialLine(itemName(catalog, id), format(quantity), signed(quantity - (base.materials.items.find(f => f.itemId === id)?.amount ?? 0)))}</li>;
    })}</ul>{!route.materials.complete && <p>{text.unknownBuildingCost(route.materials.unknown.map(b => b.name).join(', '))}</p>}</details>
    {!!unknown.length && <p>{text.unknownEnergy}{' '}{threshold !== null && threshold > 0 ?
      text.breakEven(format(threshold, 2), unknownLabel, unknown.length > 1, unknownRate > 0 ? base.label : route.label)
      : text.compareFullEnergy}</p>}
    {changed && !route.conditionalReceiver && <details><summary>{text.settingsChanges}</summary>
      {input.settings.allowSink !== route.plan.settings.allowSink && <p>{route.plan.settings.allowSink ? text.allowSink : text.disableSink}{route.plan.settings.allowSink && !input.world && text.applyIfOpened}</p>}
      {!!input.settings.processFluidsOnSite !== !!route.plan.settings.processFluidsOnSite && <p>{text.fluidProcessing(!!route.plan.settings.processFluidsOnSite)}</p>}
      {alteredExports.map(e => <p key={e.itemId}>{text.exportLimit(e.name ?? '', e.limit, unit(catalog.items.find(i => i.id === e.itemId)))}</p>)}
      {enabled.length > 0 && <p>{text.allowRecipes(enabled.map(id => recipeName(catalog, id)).join(', '))}</p>}
      {disabled.length > 0 && <p>{text.disableRecipes(disabled.map(id => recipeName(catalog, id)).join(', '))}</p>}
      <button className="secondary-button" onClick={() => setPlan(route.plan)}>{text.applySettings}</button>
    </details>}
    {route.conditionalReceiver && <p>{text.needReceiver}</p>}
  </details>;
}
