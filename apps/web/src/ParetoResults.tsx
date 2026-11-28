import { useState } from 'react';
import type { Catalog, Plan, Result } from '../../../packages/domain/types';
import { hasSolution } from '../../../packages/domain/types';
import { coordinates } from '../../../packages/solver/pareto';
import { buildConstruction } from '../../../packages/domain/construction';
import { Results } from './Results';
import { InputLimits } from './ParetoSettings';
import { format, unit } from './controls';
import { compareFactories } from './paretoComparison';
import type { useSolver } from './useSolver';
import { useT } from './i18n';
import { gameName } from './i18n/gameNames';
const metric = (v: number) => v !== 0 && Math.abs(v) < .001 ? v.toExponential(3) : format(v, 3);
export function ParetoResults({ catalog, plan, setPlan, solver, constructionScope }: { catalog: Catalog; plan: Plan; setPlan: (p: Plan) => void; solver: ReturnType<typeof useSolver>; constructionScope?: string }) {
  const text = useT().paretoResults;
  const [sort, setSort] = useState('power'); const [hidden, setHidden] = useState<string[]>([]);
  const { report, selected, baseline, running, stale, error, choosing } = solver;
  const meta = report?.pareto;
  const valid = report?.variants.filter(v => hasSolution(v.result)) ?? [];
  const comparison = selected ?? baseline;
  const ids = [...new Set([...valid.flatMap(v => v.result.resources.map(s => s.itemId)), ...(comparison?.result.resources.map(s => s.itemId) ?? [])])];
  const items = catalog.items.filter(i => ids.includes(i.id));
  const itemName = (id: string) => gameName('item', id, catalog.items.find(i => i.id === id)?.name ?? id);
  const machines = (result: Result, p: Plan) => { try { return buildConstruction(catalog, p, result).materials.totalMachines; } catch { return result.steps.reduce((n, s) => n + s.installedMachines, 0); } };
  const delta = (v: number, old: number) => `${v - old > 0 ? '+' : ''}${metric(v - old)}`;
  return <>
    <h2 tabIndex={-1}>{text.heading}</h2>
    <p role="status">{running ? text.searching(valid.length) : stale ? text.settingsChanged : text.checked(valid.length)}</p>
    {error && <p className="alert error" role="alert">{error}</p>}
    <p className="hint">{text.intro}</p>
    {meta && <p>{text.explored(meta.attempted, meta.covered.length, meta.pending.length ? meta.pending.map(id => id === 'power' ? text.energy : itemName(id)).join(', ') : text.noneUnexplored)}</p>}
    <section className="panel"><InputLimits catalog={catalog} plan={plan} setPlan={setPlan} />
      <button className="primary-button" disabled={running} onClick={() => solver.calculate()}>{text.recalculate}</button>{meta && <button className="secondary-button" disabled={running || stale} onClick={() => solver.calculate(true)}>{text.continueSearch}</button>}
    </section>
    {comparison && <p className="hint">{text.comparisonBase(comparison.label, comparison.result.products.map(p => text.orderRate(itemName(p.itemId), metric(p.rate))).join(', '))}</p>}
    {choosing && valid.length > 0 && <section className="panel" aria-label={text.tradeoffsLabel}>
      <label>{text.sortBy}{' '}<select aria-label={text.sortLabel} value={sort} onChange={e => setSort(e.target.value)}><option value="power">{text.sortPower}</option><option value="peak">{text.sortPeak}</option><option value="machines">{text.sortMachines}</option>{items.map(i => <option key={i.id} value={i.id}>{itemName(i.id)}</option>)}</select></label>
      <details><summary>{text.resourceColumns}</summary>{items.map(i => <label key={i.id} className="inline-check"><input type="checkbox" checked={!hidden.includes(i.id)} onChange={() => setHidden(hidden.includes(i.id) ? hidden.filter(id => id !== i.id) : [...hidden, i.id])} />{itemName(i.id)}</label>)}</details>
      <p className="hint">{text.tableHint}</p>
      <div className="pareto-table-scroll" tabIndex={0} role="region" aria-label={text.tableLabel}><table><thead><tr><th>{text.colVariant}</th><th>{text.colPower}</th><th>{text.colPeak}</th><th>{text.colMachines}</th>{items.filter(i => !hidden.includes(i.id)).map(i => <th key={i.id}>{itemName(i.id)}<br />{unit(i)}</th>)}<th>{text.colChoice}</th></tr></thead><tbody>
        {[...valid].sort((a, b) => {
          const value = (v: typeof a) => sort === 'peak' ? v.result.installedPower : sort === 'machines' ? machines(v.result, v.plan) : coordinates(v.result)[sort] ?? 0;
          return value(a) - value(b);
        }).map(v => { const c = coordinates(v.result), old = comparison ? coordinates(comparison.result) : null; const changes = comparison ? compareFactories(catalog, comparison, v) : null; return <tr key={v.id}>
          <th scope="row">{v.label}<small>{v.result.status === 'approximate' ? text.approximate : text.optimal}</small></th>
          <td>{metric(v.result.power)}{old && <small>Δ {delta(v.result.power, old.power)}</small>}</td><td>{metric(v.result.installedPower)}</td><td>{machines(v.result, v.plan)}{changes && <><small>{text.machinesDelta(`${changes.machines > 0 ? '+' : ''}${changes.machines}`)}</small><details><summary>{text.recipeChanges}</summary>{changes.added.map(id => <p key={id}>+ {gameName('recipe', id, catalog.recipes.find(r => r.id === id)?.name ?? id)}</p>)}{changes.removed.map(id => <p key={id}>− {gameName('recipe', id, catalog.recipes.find(r => r.id === id)?.name ?? id)}</p>)}{!changes.added.length && !changes.removed.length && <p>{text.sameRecipes}</p>}</details></>}</td>
          {items.filter(i => !hidden.includes(i.id)).map(i => <td key={i.id}>{metric(c[i.id] ?? 0)}{old && <small>Δ {delta(c[i.id] ?? 0, old[i.id] ?? 0)}</small>}</td>)}
          <td><button className="secondary-button" disabled={stale} aria-label={text.useLabel(v.label)} onClick={() => { const next = solver.choose(v.id); if (next) setPlan(next); }}>{text.use}</button></td>
        </tr>; })}</tbody></table></div>
    </section>}
    {!!meta?.failures.length && <details><summary>{text.failures(meta.failures.length)}</summary>{meta.failures.map((f, i) => <p key={i}>{f.label}: {f.message} ({f.status})</p>)}</details>}
    {!valid.length && report?.variants.filter(v => !hasSolution(v.result)).map(v => <p key={v.id} role="alert" className="alert error">{v.result.message}</p>)}
    {selected && !choosing && <><button className="text-button" onClick={solver.showChoices}>{text.backToVariants}</button><Results constructionScope={constructionScope} catalog={catalog} plan={selected.plan} result={selected.result} running={false} stale={stale} error={null} /></>}
  </>;
}
