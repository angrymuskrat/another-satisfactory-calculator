import { useEffect, useEffectEvent, useId, useMemo, useState } from 'react';
import { Calculator, ChevronDown, Play, SlidersHorizontal, Square } from 'lucide-react';
import { buildConstruction } from '../../../packages/domain/construction';
import { sourceLabel } from '../../../packages/domain/sourceLabel';
import { hasSolution, type Catalog, type Plan, type ProductResult, type Result } from '../../../packages/domain/types';
import { ItemIcon, ItemSelect, format, unit } from './controls';
import { firstProductionBlock, quickOrderPlan } from './quickOrderPlan';
import { ShareOrder } from './ShareOrder';
import { useSolver } from './useSolver';
import { useT } from './i18n';
import { gameName } from './i18n/gameNames';
import './quickOrder.css';

interface QuickOrderProps {
  catalog: Catalog;
  open: boolean;
  onToggle: (open: boolean) => void;
  onAdvanced: (plan: Plan) => void;
}
export function QuickOrder({ catalog, open, onToggle, onAdvanced }: QuickOrderProps) {
  const t = useT();
  const [productId, setProductId] = useState('iron-plate');
  const [text, setText] = useState('20');
  const [submitted, setSubmitted] = useState<Plan | null>(null);
  const id = useId();
  const product = catalog.items.find(item => item.id === productId) ?? catalog.items[0];
  const rate = Number(text.trim().replace(',', '.'));
  const valid = /^[\d.,]+$/.test(text.trim()) && Number.isFinite(rate) && rate >= 1e-6 && rate <= 1e9;
  const plan = useMemo(() => valid ? quickOrderPlan(catalog, product, rate) : null, [catalog, product, rate, valid]);

  return <section className="panel quick-order" aria-labelledby={id + '-title'}>
    <h2 id={id + '-title'}><button type="button" className="quick-order-toggle" aria-expanded={open} aria-controls={id}
      onClick={() => { onToggle(!open); setSubmitted(null); }}>
      <Calculator size={19} aria-hidden="true" />{t.quickOrder.title}<ChevronDown size={18} aria-hidden="true" />
    </button></h2>
    <div id={id} hidden={!open} className="quick-order-content">
      <div className="quick-order-fields">
        <div><span className="field-label">{t.quickOrder.product}</span>
          <ItemSelect label={t.quickOrder.productLabel} items={catalog.items} value={product.id}
            onChange={value => { setProductId(value); setSubmitted(null); }} />
        </div>
        <form onSubmit={event => { event.preventDefault(); if (plan) setSubmitted(plan); }}>
          <label><span className="field-label">{t.quickOrder.ratePerMinute}</span>
            <span className="number-field"><input type="text" inputMode="decimal" aria-label={t.quickOrder.ratePerMinute}
              aria-invalid={!valid} aria-describedby={!valid ? id + '-error' : undefined} value={text}
              onChange={event => { setText(event.target.value); setSubmitted(null); }} /><span>{unit(product)}</span></span>
          </label>
          <button type="submit" className="primary-button" disabled={!plan || !!submitted}>
            <Play size={15} aria-hidden="true" />{t.quickOrder.calculateOrder}
          </button>
        </form>
      </div>
      {!valid && <p id={id + '-error'} className="form-error" role="status">{t.quickOrder.rateRange}</p>}
      <p className="quick-order-assumptions">{t.quickOrder.assumptionsRaw}
        {' '}{t.quickOrder.assumptionsRest}</p>
      <small>{t.quickOrder.catalogVersion(catalog.version)}</small>
      {submitted && <OrderCalculation catalog={catalog} plan={submitted} />}
      {plan && <div className="quick-order-actions"><ShareOrder plan={plan} />
        <button type="button" className="secondary-button" onClick={() => { onToggle(false); setSubmitted(null); onAdvanced(plan); }}>
          <SlidersHorizontal size={16} aria-hidden="true" />{t.quickOrder.advanced}
        </button>
      </div>}
    </div>
  </section>;
}

export function OrderCalculation({ catalog, plan }: { catalog: Catalog; plan: Plan }) {
  return <SnapshotCalculation key={JSON.stringify(plan)} catalog={catalog} plan={plan} />;
}

function SnapshotCalculation({ catalog, plan }: { catalog: Catalog; plan: Plan }) {
  const t = useT();
  const { report, error, calculate, running, cancel } = useSolver(catalog, plan, 'order');
  const start = useEffectEvent(() => calculate());
  useEffect(() => { start(); }, [catalog]);
  const variant = report?.variants.find(candidate => hasSolution(candidate.result)) ?? report?.variants[0];
  const failure = variant ? (!hasSolution(variant.result) ? variant.result : null) : report?.pareto?.failures[0];
  return <section className="quick-order-result" aria-label={t.quickOrder.resultLabel}>
    {running && <div className="quick-order-progress"><span role="status">{t.quickOrder.calculating}</span>
      <button type="button" className="secondary-button" onClick={cancel}><Square size={14} aria-hidden="true" />{t.app.cancelCalculation}</button>
    </div>}
    {error && <p className="alert warning" role="status">{error}</p>}
    {variant && <>
      <p role="status" className={'status-badge ' + variant.result.status}>{t.quickOrder.statuses[variant.result.status]}</p>
      {report?.pareto && <p className="hint">{t.quickOrder.paretoVariant(variant.label)}</p>}
      {hasSolution(variant.result) && <OrderSummary catalog={catalog} plan={variant.plan} result={variant.result} />}
    </>}
    {failure && <div className="alert warning"><div>
      {!variant && <strong>{report?.pareto?.failures[0].label} · {t.quickOrder.statuses[failure.status]}</strong>}
      <p>{failure.message}</p>
      {failure.status === 'infeasible' && <p>{t.quickOrder.infeasibleHint}</p>}
      {failure.status === 'unbounded' && <p>{t.quickOrder.unboundedHint}</p>}
    </div></div>}
    {!running && (error || failure) &&
      <button type="button" className="secondary-button" onClick={() => calculate()}>{t.quickOrder.retry}</button>}
  </section>;
}

function flowRate(value: number) {
  return value > 0 && value < 1e-6 ? value.toExponential(2) : format(value, 6);
}

function OrderSummary({ catalog, plan, result }: { catalog: Catalog; plan: Plan; result: Result }) {
  const t = useT();
  const construction = useMemo(() => {
    try {
      const model = buildConstruction(catalog, plan, result);
      return { block: firstProductionBlock(model.production), extraction: model.extraction.length > 0 };
    } catch (cause) {
      return { error: cause instanceof Error ? cause.message : t.quickOrder.blockCheckFailed };
    }
  }, [catalog, plan, result, t]);
  const item = (id: string) => catalog.items.find(value => value.id === id);
  const itemName = (id: string) => { const entry = item(id); return entry ? gameName('item', entry.id, entry.name) : undefined; };
  const flows = (rows: ProductResult[]) => rows.map(row => {
    const product = item(row.itemId);
    return `${itemName(row.itemId) ?? row.itemId} · ${flowRate(row.rate)} ${unit(product)}`;
  }).join(', ');
  const used = result.resources.filter(source => source.rate > 0);
  return <>
    <div className="quick-order-totals">
      <section><h3>{t.quickOrder.output}</h3><ul>{result.products.map(row => <li key={row.itemId}>
        <ItemIcon item={item(row.itemId)} size={25} /><span>{itemName(row.itemId)}</span>
        <strong>{flowRate(row.rate)} {unit(item(row.itemId))}</strong>
      </li>)}</ul></section>
      <section><h3>{t.quickOrder.rawUse}</h3>{used.length ? <ul>{used.map(source => <li key={source.sourceId}>
        <ItemIcon item={item(source.itemId)} size={25} /><span>{sourceLabel(catalog, plan, source.sourceId, source.itemId)}</span>
        <strong>{flowRate(source.rate)} {unit(item(source.itemId))}</strong>
      </li>)}</ul> : <p>{t.quickOrder.noRawNeeded}</p>}</section>
    </div>
    <section className="quick-order-block"><h3>{t.quickOrder.firstBlock}</h3>
      {construction.error ? <p role="alert">{construction.error}</p> : construction.block ? <>
        {construction.block.cyclic && <p>{t.quickOrder.cyclic}</p>}
        {construction.block.groups.map(group => <div key={group.id} className="quick-order-machine">
          <strong>{(() => { const building = catalog.buildings.find(entry => entry.id === group.buildingId); return building ? gameName('building', building.id, building.name) : undefined; })()} × {format(group.count)}</strong>
          <span>{t.quickOrder.recipeClock((() => { const recipe = catalog.recipes.find(entry => entry.id === group.recipeId); return recipe ? gameName('recipe', recipe.id, recipe.name) : group.name; })(), format(group.clock))}
            {group.activeDuty < 1 - 1e-8 && t.quickOrder.dutyShare(format(group.activeDuty * 100, 4))}
            {!!group.somersloops && t.quickOrder.amplifiersPerMachine(group.somersloops)}
          </span>
          {group.averageInputs.length > 0 && <p>{t.quickOrder.inputs(flows(group.averageInputs))}</p>}
          {group.averageOutputs.length > 0 && <p>{t.quickOrder.outputs(flows(group.averageOutputs))}</p>}
          {group.generatedPower !== undefined && <p>{t.quickOrder.generation(format(group.generatedPower))}</p>}
        </div>)}
      </> : <p>{plan.batch?.items.every(row => row.stock >= row.required)
        ? t.quickOrder.batchInStock
        : construction.extraction ? t.quickOrder.fromExtraction
        : used.length ? t.quickOrder.fromExternal
        : t.quickOrder.noMachines}</p>}
    </section>
  </>;
}
