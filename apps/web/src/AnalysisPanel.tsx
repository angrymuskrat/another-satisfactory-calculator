import { useEffect, useMemo, useState } from 'react';
import type { Catalog, Plan, Result } from '../../../packages/domain/types';
import { hasSolution } from '../../../packages/domain/types';
import { constraintCandidates, type AnalysisReport, type AnalysisVariant, type Benefit, type Delta, type Summary } from '../../../packages/solver/analysis';
import { format, normalize, unit } from './controls';
import { useAnalysis } from './useAnalysis';
import { sourceLabel } from '../../../packages/domain/sourceLabel';
import { useT } from './i18n';
import { gameName } from './i18n/gameNames';

const itemName = (catalog: Catalog, id: string) => gameName('item', id, catalog.items.find(i => i.id === id)?.name ?? id);
const signed = (value: number) => `${value > 1e-6 ? '+' : ''}${format(Math.abs(value) < 1e-6 ? 0 : value, 3)}`;

export function AnalysisPanel({ catalog, plan }: { catalog: Catalog; plan: Plan }) {
  const text = useT().analysisPanel;
  const analysis = useAnalysis(catalog, plan);
  const candidates = useMemo(() => constraintCandidates(catalog, plan), [catalog, plan]);
  const [selected, setSelected] = useState<string[]>(() => candidates.slice(0, 8).map(c => c.id));
  const [query, setQuery] = useState('');
  useEffect(() => {
    setSelected(previous => previous.filter(id => candidates.some(c => c.id === id)));
  }, [candidates]);
  return <details className="panel analysis-panel" aria-label={text.title}>
    <summary>{text.title}</summary>
    <p>{text.intro}</p>
    <p>{text.limits(format(plan.settings.clock), format(plan.settings.outputSlack))}</p>
    {!!plan.lines?.length && <button className="secondary-button" disabled={analysis.running} onClick={() => analysis.calculate({ kind: 'expansion' })}>{text.compare}</button>}
    <details><summary>{text.usefulExpansion(selected.length, candidates.length)}</summary>
      <p>{text.eachChecked}</p>
      <input aria-label={text.searchLabel} placeholder={text.searchPlaceholder} value={query} onChange={e => setQuery(e.target.value)} />
      <button className="text-button" onClick={() => setSelected([])}>{text.clearSelection}</button>
      <ul className="analysis-candidates">{candidates.filter(c => normalize(c.label).includes(normalize(query))).map(c => <li key={c.id}>
        <label><input type="checkbox" checked={selected.includes(c.id)} disabled={analysis.running || (!selected.includes(c.id) && selected.length >= 12)} onChange={e => setSelected(e.target.checked ? [...selected, c.id] : selected.filter(id => id !== c.id))} /> {c.label}</label>
      </li>)}</ul>
      {!candidates.length && <p>{text.noCandidates}</p>}
      <button className="secondary-button" disabled={analysis.running || !selected.length || !plan.targets.length} onClick={() => analysis.calculate({ kind: 'constraints', candidateIds: selected })}>{text.checkSelected}</button>
    </details>
    <AnalysisFeedback analysis={analysis} catalog={catalog} plan={plan} />
  </details>;
}
export function AnalysisFeedback({ analysis, catalog, plan }: { analysis: ReturnType<typeof useAnalysis>; catalog: Catalog; plan: Plan }) {
  const text = useT().analysisPanel;
  return <div>
    <p className="sr-only" role="status">{analysis.running ? text.recalculating : analysis.report ? text.comparisonDone : ''}</p>
    {analysis.running && <p>{text.recalculating}{' '}<button className="secondary-button" onClick={analysis.cancel}>{text.cancelAnalysis}</button></p>}
    {analysis.error && <p role="alert">{analysis.error}</p>}
    {analysis.report && <AnalysisReportView catalog={catalog} plan={plan} report={analysis.report} />}
  </div>;
}
function SummaryTable({ summary }: { summary: Summary }) {
  const text = useT().analysisPanel;
  return <div className="table-scroll"><table><caption>{text.fullPlanCaption}</caption><tbody>
    <tr><th scope="row">{text.averagePower}</th><td>{format(summary.power, 3)}</td></tr>
    <tr><th scope="row">{text.maxLoad}</th><td>{format(summary.installedPower, 3)}</td></tr>
    <tr><th scope="row">{text.idlePower}</th><td>{format(summary.productionIdlePower, 3)}</td></tr>
    <tr><th scope="row">{text.resourceCost}</th><td>{format(summary.resourceCost, 3)}</td></tr>
    <tr><th scope="row">{text.physicalTotal}</th><td>{summary.physical.total}</td></tr>
    <tr><th scope="row">{text.productionExtractionSink}</th><td>{summary.physical.production} / {summary.physical.extraction} / {summary.physical.sinks}</td></tr>
  </tbody></table></div>;
}
function ResultFlows({ catalog, plan, result }: { catalog: Catalog; plan: Plan; result: Result }) {
  const text = useT().analysisPanel;
  return <>
    {hasSolution(result) && <div className="table-scroll"><table><caption>{text.flowsCaption}</caption><thead><tr><th>{text.colFlow}</th><th>{text.colAmount}</th></tr></thead><tbody>
      {result.products.map(p => <tr key={`product:${p.itemId}`}><th scope="row">{text.outputRow(itemName(catalog, p.itemId))}</th><td>{format(p.rate, 3)} {unit(catalog.items.find(i => i.id === p.itemId))}</td></tr>)}
      {result.resources.map(r => <tr key={`source:${r.sourceId}`}><th scope="row">{sourceLabel(catalog, plan, r.sourceId, r.itemId)}</th><td>{format(r.rate, 3)} {unit(catalog.items.find(i => i.id === r.itemId))}</td></tr>)}
      {result.surplus.map(r => <tr key={`sink:${r.itemId}`}><th scope="row">{text.sinkRow(itemName(catalog, r.itemId))}</th><td>{format(r.rate, 3)} {unit(catalog.items.find(i => i.id === r.itemId))}</td></tr>)}
    </tbody></table></div>}
    {result.feasibleAlternative && <div className="feasible-alternative"><p>{text.reachable(format(result.feasibleAlternative.fraction * 100))}</p>
      <ul>{result.feasibleAlternative.products.map(p => <li key={p.itemId}>{itemName(catalog, p.itemId)}: {format(p.rate, 3)} {unit(catalog.items.find(i => i.id === p.itemId))}</li>)}</ul>
    </div>}
    {!hasSolution(result) && <p>{result.message}</p>}
    {result.warnings.length + (result.modelNotes?.length ?? 0) > 0 && <details><summary>{text.boundaries}</summary><ul>{[...result.warnings, ...result.modelNotes ?? []].map((w, i) => <li key={i}>{w}</li>)}</ul></details>}
  </>;
}
function ChangeRow({ label, value }: { label: string; value: Delta }) {
  return <tr><th scope="row">{label}</th><td>{format(value.before, 3)}</td><td>{format(value.after, 3)}</td><td>{signed(value.delta)}</td></tr>;
}
function Variant({ catalog, plan, variant, kind }: { catalog: Catalog; plan: Plan; variant: AnalysisVariant; kind: AnalysisReport['kind'] }) {
  const text = useT().analysisPanel;
  const c = variant.comparison;
  return <details className="panel" open><summary>{text.variantTitle(variant.label, text.statusLabels[variant.result.status])}</summary>
    {kind !== 'objectives' && <p>{text.benefitLabels[variant.benefit]}</p>}
    {variant.id === 'joint' && <p>{text.joint(variant.candidateIds.length)}</p>}
    {c ? <>
      <div className="table-scroll"><table><caption>{text.changeCaption}</caption><thead><tr><th>{text.colMetric}</th><th>{text.colBefore}</th><th>{text.colAfter}</th><th>{text.colDifference}</th></tr></thead><tbody>
        <ChangeRow label={text.averagePower} value={c.power} /><ChangeRow label={text.maxLoad} value={c.installedPower} /><ChangeRow label={text.idlePower} value={c.productionIdlePower} /><ChangeRow label={text.resourceCost} value={c.resourceCost} />
        <ChangeRow label={text.allBuildings} value={c.physical.total} /><ChangeRow label={text.productionBuildings} value={c.physical.production} /><ChangeRow label={text.extractors} value={c.physical.extraction} /><ChangeRow label={text.sinks} value={c.physical.sinks} />
        {c.outputs.map(r => <ChangeRow key={r.id} label={text.outputChange(itemName(catalog, r.itemId), unit(catalog.items.find(i => i.id === r.itemId)))} value={r} />)}
        {c.sources.map(r => <ChangeRow key={r.id} label={text.sourceChange(sourceLabel(catalog, plan, r.id, r.itemId), unit(catalog.items.find(i => i.id === r.itemId)))} value={r} />)}
      </tbody></table></div>
      <div className="table-scroll"><table><caption>{text.changedRecipes}</caption><thead><tr><th>{text.colRecipe}</th><th>{text.colCycles}</th><th>{text.colMachinesBeforeAfter}</th></tr></thead><tbody>
        {c.recipes.map(r => <tr key={r.id}><th scope="row">{gameName('recipe', r.id, catalog.recipes.find(recipe => recipe.id === r.id)?.name ?? r.id)}</th><td>{format(r.cycles.before, 3)} → {format(r.cycles.after, 3)}</td><td>{r.machines.before} → {r.machines.after}</td></tr>)}
        {!c.recipes.length && <tr><td colSpan={3}>{text.chainUnchanged}</td></tr>}
      </tbody></table></div>
      <ResultFlows catalog={catalog} plan={plan} result={variant.result} />
    </> : <>{variant.summary && <SummaryTable summary={variant.summary} />}<ResultFlows catalog={catalog} plan={plan} result={variant.result} /></>}
  </details>;
}
export function AnalysisReportView({ catalog, plan, report }: { catalog: Catalog; plan: Plan; report: AnalysisReport }) {
  const text = useT().analysisPanel;
  return <section aria-label={text.resultsLabel}>
    <h3>{report.complete ? text.comparisonResults : text.partialResults}</h3>
    {report.noProductionPath && <div className="empty-panel"><h3>{text.noPathTitle}</h3><p>{text.noPathBody}</p></div>}
    <details><summary>{text.baselineTitle(text.statusLabels[report.baseline.status])}</summary>{report.baselineSummary && <SummaryTable summary={report.baselineSummary} />}<ResultFlows catalog={catalog} plan={plan} result={report.baseline} /></details>
    {report.variants.map(v => <Variant key={v.id} catalog={catalog} plan={plan} variant={v} kind={report.kind} />)}
    <ul>{report.notes.map((note, i) => <li key={i}>{note}</li>)}</ul>
  </section>;
}
