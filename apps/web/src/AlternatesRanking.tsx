import { useMemo } from 'react';
import type { Catalog, Plan, Result } from '../../../packages/domain/types';
import { hasSolution } from '../../../packages/domain/types';
import { alternateCandidates, type AnalysisVariant, type Benefit, type Delta } from '../../../packages/solver/analysis';
import { format } from './controls';
import { useAnalysis } from './useAnalysis';
import { useT } from './i18n';
import { gameName } from './i18n/gameNames';

const signed = (value: number, digits = 2) => Math.abs(value) < 1e-6 ? '0' : `${value > 0 ? '+' : '−'}${format(Math.abs(value), digits)}`;

/** Ranks disabled alternates for the solved chain; enabling one only changes the plan's recipe list. */
export function AlternatesRanking({ catalog, plan, result, onEnable }: { catalog: Catalog; plan: Plan; result: Result; onEnable?: (recipeId: string) => void }) {
  const text = useT().alternatesRanking;
  const analysis = useAnalysis(catalog, plan);
  const candidates = useMemo(() => { try { return alternateCandidates(catalog, plan, result); } catch { return { ids: [], omitted: 0 }; } }, [catalog, plan, result]);
  const report = analysis.report?.kind === 'alternates' ? analysis.report : null;
  const item = (id: string) => catalog.items.find(i => i.id === id);
  const outputGain = (v: AnalysisVariant) => v.comparison?.outputs.filter(o => plan.targets.some(t => t.itemId === o.itemId)) ?? [];
  const newResources = (v: AnalysisVariant) => v.comparison?.sources.filter(s => s.before < 1e-9 && s.after > 1e-9).map(s => gameName('item', s.itemId, item(s.itemId)?.name ?? s.itemId)) ?? [];
  const cell = (value: Delta | undefined, digits = 2) => value ? signed(value.delta, digits) : '—';
  return <section className="panel" aria-labelledby="alternates-title">
    <div className="section-heading"><h3 id="alternates-title">{text.title}</h3><span className="count-badge">{candidates.ids.length}</span></div>
    <p className="hint">{text.hint}</p>
    {!report && !analysis.running && <button type="button" className="secondary-button" disabled={!candidates.ids.length} onClick={() => analysis.calculate({ kind: 'alternates' })}>{candidates.ids.length ? text.check(candidates.ids.length, candidates.omitted) : text.nothingToCheck}</button>}
    <p className="sr-only" aria-live="polite">{analysis.running ? text.checking : report ? text.ready : ''}</p>
    {analysis.running && <p><span className="spinner" />{text.checking}{' '}<button type="button" className="secondary-button" onClick={analysis.cancel}>{text.cancel}</button></p>}
    {analysis.error && <p role="alert">{analysis.error}</p>}
    {report && <>
      {!report.complete && <p className="alert warning">{text.incomplete}</p>}
      <div className="table-scroll"><table><caption className="sr-only">{text.caption}</caption>
        <thead><tr><th scope="col">{text.colAlternative}</th><th scope="col">{text.colResult}</th><th scope="col">{text.colOutput}</th><th scope="col">{text.colMachines}</th><th scope="col">{text.colPower}</th><th scope="col">{text.colWeighted}</th>{onEnable && <th scope="col"><span className="sr-only">{text.colAction}</span></th>}</tr></thead>
        <tbody>{report.variants.map(v => {
          const c = v.comparison, fresh = newResources(v);
          const enabled = plan.settings.enabledRecipeIds.includes(v.id);
          const unused = v.benefit === 'none' && hasSolution(v.result) && !v.result.steps.some(s => s.recipeId === v.id);
          return <tr key={v.id}>
            <th scope="row">{v.label}{!!fresh.length && <small className="hint">{text.newResources(fresh.join(', '))}</small>}</th>
            <td>{unused ? text.unused : hasSolution(v.result) || v.result.status === 'infeasible' ? text.verdicts[v.benefit] : v.result.status === 'timeout' ? text.timeout : text.error}{c && c.resourceCost.delta > 1e-6 && (v.benefit === 'output' || v.benefit === 'cost') && <small className="hint">{text.moreWeighted}</small>}</td>
            <td>{outputGain(v).map(o => <span key={o.id}>{signed(o.delta, 3)}</span>)}{!c && '—'}</td>
            <td>{c ? signed(c.physical.total.delta, 0) : '—'}</td>
            <td>{cell(c?.power)}</td>
            <td>{cell(c?.resourceCost)}</td>
            {onEnable && <td>{!unused && <button type="button" className="secondary-button" disabled={enabled} onClick={() => onEnable(v.id)}>{enabled ? text.allowed : text.allowInPlan}</button>}</td>}
          </tr>;
        })}</tbody>
      </table></div>
      <ul className="hint">{report.notes.map((note, i) => <li key={i}>{note}</li>)}</ul>
      {onEnable && <p className="hint">{text.allowHint}</p>}
    </>}
  </section>;
}
