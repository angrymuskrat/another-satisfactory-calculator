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
const metric = (v: number) => v !== 0 && Math.abs(v) < .001 ? v.toExponential(3) : format(v, 3);
export function ParetoResults({ catalog, plan, setPlan, solver, constructionScope }: { catalog: Catalog; plan: Plan; setPlan: (p: Plan) => void; solver: ReturnType<typeof useSolver>; constructionScope?: string }) {
  const [sort, setSort] = useState('power'); const [hidden, setHidden] = useState<string[]>([]);
  const { report, selected, baseline, running, stale, error, choosing } = solver;
  const meta = report?.pareto;
  const valid = report?.variants.filter(v => hasSolution(v.result)) ?? [];
  const comparison = selected ?? baseline;
  const ids = [...new Set([...valid.flatMap(v => v.result.resources.map(s => s.itemId)), ...(comparison?.result.resources.map(s => s.itemId) ?? [])])];
  const items = catalog.items.filter(i => ids.includes(i.id));
  const machines = (result: Result, p: Plan) => { try { return buildConstruction(catalog, p, result).materials.totalMachines; } catch { return result.steps.reduce((n, s) => n + s.installedMachines, 0); } };
  const delta = (v: number, old: number) => `${v - old > 0 ? '+' : ''}${metric(v - old)}`;
  return <>
    <h2 tabIndex={-1}>Приближённый обзор Парето</h2>
    <p role="status">{running ? `Поиск продолжается · найдено вариантов: ${valid.length}` : stale ? 'Настройки изменились. Требуется пересчёт.' : `Проверенных вариантов: ${valid.length}`}</p>
    {error && <p className="alert error" role="alert">{error}</p>}
    <p className="hint">Каждый вариант выполняет тот же заказ. Расходы ресурсов сравниваются отдельно; полнота границы и глобальный нелинейный оптимум не доказаны. Неизвестная энергия внешних поставок исключена. Число машин не минимизируется заранее.</p>
    {meta && <p>Расчётов: {meta.attempted}. Крайних направлений проверено: {meta.covered.length}. Не исследованы: {meta.pending.length ? meta.pending.map(id => id === 'power' ? 'Энергия' : catalog.items.find(i => i.id === id)?.name ?? id).join(', ') : 'нет; промежуточные компромиссы можно уточнять'}.</p>}
    <section className="panel"><InputLimits catalog={catalog} plan={plan} setPlan={setPlan} />
      <button className="primary-button" disabled={running} onClick={() => solver.calculate()}>Пересчитать обзор</button>{meta && <button className="secondary-button" disabled={running || stale} onClick={() => solver.calculate(true)}>Продолжить поиск</button>}
    </section>
    {comparison && <p className="hint">База сравнения: {comparison.label}; заказ {comparison.result.products.map(p => `${catalog.items.find(i => i.id === p.itemId)?.name ?? p.itemId}: ${metric(p.rate)}/мин`).join(', ')}. Изменения лимитов не закрепляют рецепты этой фабрики.</p>}
    {choosing && valid.length > 0 && <section className="panel" aria-label="Компромиссы по ресурсам и энергии">
      <label>Сортировать по <select aria-label="Сортировка вариантов" value={sort} onChange={e => setSort(e.target.value)}><option value="power">Энергии</option><option value="peak">Пику</option><option value="machines">Числу машин</option>{items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
      <details><summary>Столбцы ресурсов</summary>{items.map(i => <label key={i.id} className="inline-check"><input type="checkbox" checked={!hidden.includes(i.id)} onChange={() => setHidden(hidden.includes(i.id) ? hidden.filter(id => id !== i.id) : [...hidden, i.id])} />{i.name}</label>)}</details>
      <p className="hint">Таблицу можно прокручивать по горизонтали. Скрытие столбца не меняет сравнение вариантов.</p>
      <div className="pareto-table-scroll" tabIndex={0} role="region" aria-label="Таблица вариантов, горизонтальная прокрутка"><table><thead><tr><th>Вариант</th><th>МВт</th><th>Пик, МВт</th><th>Машины</th>{items.filter(i => !hidden.includes(i.id)).map(i => <th key={i.id}>{i.name}<br />{unit(i)}</th>)}<th>Выбор</th></tr></thead><tbody>
        {[...valid].sort((a, b) => {
          const value = (v: typeof a) => sort === 'peak' ? v.result.installedPower : sort === 'machines' ? machines(v.result, v.plan) : coordinates(v.result)[sort] ?? 0;
          return value(a) - value(b);
        }).map(v => { const c = coordinates(v.result), old = comparison ? coordinates(comparison.result) : null; const changes = comparison ? compareFactories(catalog, comparison, v) : null; return <tr key={v.id}>
          <th scope="row">{v.label}<small>{v.result.status === 'approximate' ? 'Допустимое приближение' : 'Оптимум модели'}</small></th>
          <td>{metric(v.result.power)}{old && <small>Δ {delta(v.result.power, old.power)}</small>}</td><td>{metric(v.result.installedPower)}</td><td>{machines(v.result, v.plan)}{changes && <><small>Δ машин {changes.machines > 0 ? '+' : ''}{changes.machines}</small><details><summary>Изменения рецептов</summary>{changes.added.map(id => <p key={id}>+ {catalog.recipes.find(r => r.id === id)?.name ?? id}</p>)}{changes.removed.map(id => <p key={id}>− {catalog.recipes.find(r => r.id === id)?.name ?? id}</p>)}{!changes.added.length && !changes.removed.length && <p>Набор рецептов прежний; загрузка может отличаться.</p>}</details></>}</td>
          {items.filter(i => !hidden.includes(i.id)).map(i => <td key={i.id}>{metric(c[i.id] ?? 0)}{old && <small>Δ {delta(c[i.id] ?? 0, old[i.id] ?? 0)}</small>}</td>)}
          <td><button className="secondary-button" disabled={stale} aria-label={`Использовать: ${v.label}`} onClick={() => { const next = solver.choose(v.id); if (next) setPlan(next); }}>Использовать</button></td>
        </tr>; })}</tbody></table></div>
    </section>}
    {!!meta?.failures.length && <details><summary>Статусы отдельных расчётов ({meta.failures.length})</summary>{meta.failures.map((f, i) => <p key={i}>{f.label}: {f.message} ({f.status})</p>)}</details>}
    {!valid.length && report?.variants.filter(v => !hasSolution(v.result)).map(v => <p key={v.id} role="alert" className="alert error">{v.result.message}</p>)}
    {selected && !choosing && <><button className="text-button" onClick={solver.showChoices}>Вернуться к вариантам</button><Results constructionScope={constructionScope} catalog={catalog} plan={selected.plan} result={selected.result} running={false} stale={stale} error={null} /></>}
  </>;
}
