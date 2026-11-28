import { useEffect, useRef, type ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { buildComplexity } from '../../../packages/domain/complexity';
import type { Catalog, Plan, ProductionVariant, Result } from '../../../packages/domain/types';
import { hasSolution } from '../../../packages/domain/types';
import { ModelNotes, Results, usedResources } from './Results';
import { ParetoResults } from './ParetoResults';
import { format, unit } from './controls';
import type { useSolver } from './useSolver';
import { sourceLabel } from '../../../packages/domain/sourceLabel';
import { useT, type Messages } from './i18n';
import { gameName } from './i18n/gameNames';

const metric = (value: number, digits = 2) => value !== 0 && Math.abs(value) < 10 ** -digits ? value.toExponential(3) : format(value, digits);
const weightedResources = (plan: Plan, result: Result) => result.resources.reduce((sum, r) => sum + r.rate * (plan.settings.resourceWeights[r.itemId] ?? 1), 0);
type Variant = NonNullable<ReturnType<typeof useSolver>['report']>['variants'][number];
const title = (v: Variant, t: Messages) => v.result.searchProgress ? t.productionVariants.refinement(v.label) : v.label;
type MetricRow = { key: string; label: string; value: (variant: Variant) => ReactNode };
/** Строки карточки вне таблицы метрик: статус, название, описание, кнопка выбора. */
const CARD_ROWS = 4;
const difference = (value: number, baseline: number) => baseline > 0 ? `${value >= baseline ? '+' : '−'}${format(Math.abs(value / baseline - 1) * 100)}%` : '—';
const hint = (variant: ProductionVariant, plan: Plan, t: Messages) => {
  const text = t.productionVariants;
  if (variant.result.searchProgress) return variant.result.message;
  const loss = plan.mode === 'maximize' && !plan.batch ? text.lossAllowed(format(variant.plan.settings.outputSlack)) : text.orderKept;
  if (variant.id === 'maximum') return text.hintMaximum;
  if (variant.id === 'economy') return text.hintEconomy(variant.plan.settings.smoothPowerExtraMachines ?? 0, loss);
  if (variant.id === 'simple') return text.hintSimple(variant.plan.settings.recipesFirst?.extraPercent ?? 10, loss);
  return text.hintWeighted(loss);
};

export function ProductionVariants({ catalog, plan, setPlan, solver, constructionScope }: { catalog: Catalog; plan: Plan; setPlan: (plan: Plan) => void; solver: ReturnType<typeof useSolver>; constructionScope?: string }) {
  const t = useT();
  const text = t.productionVariants;
  const heading = useRef<HTMLHeadingElement>(null);
  const { report, pending, selected, choosing, stale, running, error } = solver;
  const hasVariants = !!report?.workingPlans?.length || report?.variants.some(v => hasSolution(v.result));
  const showCards = report !== null && choosing;
  const baseline = report?.variants[0];
  const variants = report?.variants.filter(v => !v.sameAs);
  const merged = report?.variants.filter(v => v.sameAs).map(v => text.merged(v.label, report.variants.find(o => o.id === v.sameAs)?.label)) ?? [];
  const focusHeading = () => requestAnimationFrame(() => heading.current?.focus());
  const solvedVariants = variants?.filter(v => hasSolution(v.result)) ?? [];
  const autoShown = useRef<object | null>(null);
  const finished = report && !report.pareto && !running && !stale && !selected && !report.workingPlans?.length && !pending.length
    && variants?.every(v => !v.result.searchProgress && v.result.status !== 'timeout');
  const firstSolved = finished ? solvedVariants[0] : undefined;
  useEffect(() => {
    if (!firstSolved || autoShown.current === report) return;
    autoShown.current = report;
    solver.preview(firstSolved.id);
  });
  if ((plan.settings.pareto && (plan.mode === 'target' || plan.batch)) || report?.pareto) return <ParetoResults catalog={catalog} plan={plan} setPlan={setPlan} solver={solver} constructionScope={constructionScope} />;
  const item = (id: string) => catalog.items.find(i => i.id === id);
  // Общий набор строк: одинаковые метрики стоят на одной высоте во всех вариантах.
  const solved = (variants ?? []).filter(v => hasSolution(v.result));
  const productIds = [...new Set(solved.flatMap(v => v.result.products.map(p => p.itemId)))];
  const sources = new Map(solved.flatMap(v => usedResources(v.plan, v.result.resources).map(r => [r.sourceId, r.itemId] as const)));
  const versus = (variant: Variant, value: number, base: number | undefined) => variant.id !== 'maximum' && base !== undefined && <small>{text.versusMaximum(difference(value, base))}</small>;
  const baseResult = baseline && hasSolution(baseline.result) ? baseline.result : null;
  const rows: MetricRow[] = [
    ...productIds.map(id => ({ key: `product:${id}`, label: gameName('item', id, item(id)?.name ?? id), value: (v: Variant) => {
      const product = v.result.products.find(p => p.itemId === id);
      return product ? <>{metric(product.rate, 6)} {unit(item(id))}{versus(v, product.rate, baseline?.result.products.find(p => p.itemId === id)?.rate ?? 0)}</> : '—';
    } })),
    { key: 'power', label: text.rows.power, value: v => <><span data-metric="power">{metric(v.result.power)}</span>{text.mwSuffix}{versus(v, v.result.power, baseline?.result.power ?? 0)}</> },
    { key: 'peak', label: text.rows.peak, value: v => text.mwValue(metric(v.result.installedPower)) },
    { key: 'machines', label: text.rows.machines, value: v => v.result.steps.reduce((total, step) => total + step.installedMachines, 0) },
    ...(solved.some(v => v.result.searchProgress?.machineMinimum !== undefined) ? [{ key: 'minimum', label: text.rows.minimum, value: (v: Variant) => v.result.searchProgress?.machineMinimum ?? '—' }] : []),
    { key: 'recipes', label: text.rows.recipes, value: v => {
      const recipes = buildComplexity(v.plan, v.result).distinctRecipes;
      const base = baseResult && baseline ? buildComplexity(baseline.plan, baseResult).distinctRecipes : undefined;
      return <>{recipes}{v.id !== 'maximum' && base !== undefined && <small>{text.versusMaximum(`${recipes - base >= 0 ? '+' : '−'}${Math.abs(recipes - base)}`)}</small>}</>;
    } },
    { key: 'weighted', label: text.rows.weighted, value: v => <>{metric(weightedResources(v.plan, v.result))}{baseResult && baseline && versus(v, weightedResources(v.plan, v.result), weightedResources(baseline.plan, baseResult))}</> },
    ...(solved.some(v => v.result.machineBudget) ? [{ key: 'budget', label: text.rows.budget, value: (v: Variant) => v.result.machineBudget ? <>{v.result.machineBudget.used} / {v.result.machineBudget.limit}<small>{text.budgetNote(v.result.machineBudget.minimum)}</small></> : '—' }] : []),
    ...[...sources].map(([id, itemId]) => ({ key: `source:${id}`, label: sourceLabel(catalog, plan, id, itemId), value: (v: Variant) => {
      const source = v.result.resources.find(r => r.sourceId === id);
      return source ? `${metric(source.rate)} ${unit(item(itemId))}` : '—';
    } })),
  ];
  return <>
    {!showCards && selected && <button className="text-button variant-back" onClick={() => { solver.showChoices(); focusHeading(); }}><ArrowLeft size={14} />{text.backToVariants}</button>}
    <h2 className="variant-title" ref={heading} tabIndex={-1}>{showCards || running && !selected ? text.heading : selected ? title(selected, t) : text.headingCalculation}</h2>
    {showCards ? <section aria-label={text.chooseLabel} className="production-variants">
      <p role="status">{stale ? text.recalcNeeded : running ? text.variantsAppearing : hasVariants ? text.chooseHint : text.noVariantDone}</p>
      {error && <p role="alert" className="alert error">{error}</p>}
      {!!report?.workingPlans?.length && <section className="panel" aria-label={text.workingPlansLabel}>
        <h3>{text.workingPlansTitle}</h3>
        <p>{text.workingPlansHint}</p>
        {report.workingPlans.map(v => <p key={v.id}><strong>{v.label}</strong>{text.workingPlanLine(v.result.steps.reduce((n, s) => n + s.installedMachines, 0), metric(v.result.power))}{' '}
          <button className="secondary-button" disabled={stale} onClick={() => { const next = solver.choose(v.id); if (next) { setPlan(next); focusHeading(); } }}>{text.openWorkingPlan}</button></p>)}
      </section>}
      {!running && (pending.length > 0 || report?.variants.some(v => v.result.searchProgress || v.result.status === 'timeout')) && <button className="secondary-button" disabled={stale} onClick={() => solver.calculate(true)}>{text.continueOptimization}</button>}
      {!!merged.length && <p className="alert">{report?.equivalent ? text.allEqual : merged.join(' ')}</p>}
      <div className="variant-grid">{variants?.map(variant => {
        const { result } = variant;
        const valid = hasSolution(result);
        const unsolved = !valid && pending.includes(variant.id);
        return <article className={'panel variant-card' + (valid ? ' is-aligned' : '')} key={variant.id} aria-labelledby={`variant-${variant.id}`} style={{ gridRow: `span ${rows.length + CARD_ROWS}` }}>
          {unsolved ? <span className="status-badge pending">{running ? text.calculating : text.notCalculated}</span> : <span className={`status-badge ${result.status}`}>{text.statuses[result.status]}</span>}
          <h3 id={`variant-${variant.id}`}>{title(variant, t)}</h3>
          <p className="hint">{hint(variant, plan, t)}</p>
          {unsolved ? <p className="hint">{running ? text.stillSolving : error ?? text.calcStopped}</p> : valid ? <>
            <dl className="variant-metrics" style={{ gridRow: `span ${rows.length}` }}>{rows.map(row => <div key={row.key}><dt>{row.label}</dt><dd>{row.value(variant)}</dd></div>)}</dl>
            <button className="secondary-button variant-choose" disabled={stale} onClick={() => { const next = solver.choose(variant.id); if (next) { setPlan(next); focusHeading(); } }}>{text.useVariant}</button>
          </> : <div className="alert error" role="alert"><div><strong>{text.statuses[result.status]}</strong><p>{result.message}</p><p>{text.cannotChoose(hasVariants)}</p></div></div>}
        </article>;
      })}</div>
      {hasVariants && <ModelNotes notes={[text.noteFrequencies, text.noteHiddenResources]} />}
      {!hasVariants && !running && <Results constructionScope={constructionScope} catalog={catalog} plan={report!.variants[0]?.plan ?? plan} result={solver.result} stale={stale} running={running} error={null} />}
    </section> : <>
      {selected && <div className="variant-bar">
        {solvedVariants.length > 1 && <div className="segmented variant-switch" role="group" aria-label={text.shownVariant}>
          {solvedVariants.map(v => <button key={v.id} type="button" aria-pressed={v.id === selected.id} disabled={stale} onClick={() => solver.preview(v.id)}>{v.label}</button>)}
        </div>}
        {!solver.accepted && <button className="secondary-button" disabled={stale} onClick={() => { const next = solver.choose(selected.id); if (next) setPlan(next); }}>{text.acceptVariant}</button>}
      </div>}
      {selected?.result.searchProgress && <p role="status">{selected.result.message}</p>}
      <Results constructionScope={constructionScope} key={selected?.id ?? 'pending'} catalog={catalog} plan={selected?.plan ?? plan} result={solver.result} stale={stale} running={running && !selected} error={selected ? null : error} onEnableRecipe={id => setPlan({ ...plan, settings: { ...plan.settings, enabledRecipeIds: [...plan.settings.enabledRecipeIds, id] } })} />
    </>}
  </>;
}
