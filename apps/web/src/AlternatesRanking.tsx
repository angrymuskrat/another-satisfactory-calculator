import { useMemo } from 'react';
import type { Catalog, Plan, Result } from '../../../packages/domain/types';
import { hasSolution } from '../../../packages/domain/types';
import { alternateCandidates, type AnalysisVariant, type Benefit, type Delta } from '../../../packages/solver/analysis';
import { format } from './controls';
import { useAnalysis } from './useAnalysis';

const verdicts: Record<Benefit, string> = { output: 'Больше выпуска', feasibility: 'Заказ выполним', 'reachable-output': 'Больше достижимой доли', cost: 'Дешевле по порядку целей', none: 'Нет улучшения', unknown: 'Не установлено' };
const signed = (value: number, digits = 2) => Math.abs(value) < 1e-6 ? '0' : `${value > 0 ? '+' : '−'}${format(Math.abs(value), digits)}`;

/** Ranks disabled alternates for the solved chain; enabling one only changes the plan's recipe list. */
export function AlternatesRanking({ catalog, plan, result, onEnable }: { catalog: Catalog; plan: Plan; result: Result; onEnable?: (recipeId: string) => void }) {
  const analysis = useAnalysis(catalog, plan);
  const candidates = useMemo(() => { try { return alternateCandidates(catalog, plan, result); } catch { return { ids: [], omitted: 0 }; } }, [catalog, plan, result]);
  const report = analysis.report?.kind === 'alternates' ? analysis.report : null;
  const item = (id: string) => catalog.items.find(i => i.id === id);
  const outputGain = (v: AnalysisVariant) => v.comparison?.outputs.filter(o => plan.targets.some(t => t.itemId === o.itemId)) ?? [];
  const newResources = (v: AnalysisVariant) => v.comparison?.sources.filter(s => s.before < 1e-9 && s.after > 1e-9).map(s => item(s.itemId)?.name ?? s.itemId) ?? [];
  const cell = (value: Delta | undefined, digits = 2) => value ? signed(value.delta, digits) : '—';
  return <section className="panel" aria-labelledby="alternates-title">
    <div className="section-heading"><h3 id="alternates-title">Что дадут альтернативы</h3><span className="count-badge">{candidates.ids.length}</span></div>
    <p className="hint">Выключенные альтернативы, доступные миру и разрешённым зданиям, которые производят предметы этой цепочки. Каждая проверяется отдельным полным пересчётом с тем же заказом и ограничениями.</p>
    {!report && !analysis.running && <button type="button" className="secondary-button" disabled={!candidates.ids.length} onClick={() => analysis.calculate({ kind: 'alternates' })}>{candidates.ids.length ? `Проверить альтернативы (${candidates.ids.length}${candidates.omitted ? ` из ${candidates.ids.length + candidates.omitted}` : ''})` : 'Нет альтернатив для проверки'}</button>}
    <p className="sr-only" aria-live="polite">{analysis.running ? 'Проверяем альтернативы…' : report ? 'Рейтинг альтернатив готов.' : ''}</p>
    {analysis.running && <p><span className="spinner" />Проверяем альтернативы… <button type="button" className="secondary-button" onClick={analysis.cancel}>Отменить</button></p>}
    {analysis.error && <p role="alert">{analysis.error}</p>}
    {report && <>
      {!report.complete && <p className="alert warning">Часть проверок не завершена: тайм-аут или ошибка не означают отсутствие пользы.</p>}
      <div className="table-scroll"><table><caption className="sr-only">Рейтинг альтернатив, лучшие сверху</caption>
        <thead><tr><th scope="col">Альтернатива</th><th scope="col">Итог</th><th scope="col">Выпуск</th><th scope="col">Машины</th><th scope="col">МВт</th><th scope="col">Взвешенное сырьё</th>{onEnable && <th scope="col"><span className="sr-only">Действие</span></th>}</tr></thead>
        <tbody>{report.variants.map(v => {
          const c = v.comparison, fresh = newResources(v);
          const enabled = plan.settings.enabledRecipeIds.includes(v.id);
          const unused = v.benefit === 'none' && hasSolution(v.result) && !v.result.steps.some(s => s.recipeId === v.id);
          return <tr key={v.id}>
            <th scope="row">{v.label}{!!fresh.length && <small className="hint"> · новое сырьё: {fresh.join(', ')}</small>}</th>
            <td>{unused ? 'Не используется решением' : hasSolution(v.result) || v.result.status === 'infeasible' ? verdicts[v.benefit] : v.result.status === 'timeout' ? 'Время истекло' : 'Ошибка'}{c && c.resourceCost.delta > 1e-6 && (v.benefit === 'output' || v.benefit === 'cost') && <small className="hint"> · больше взвешенного сырья</small>}</td>
            <td>{outputGain(v).map(o => <span key={o.id}>{signed(o.delta, 3)}</span>)}{!c && '—'}</td>
            <td>{c ? signed(c.physical.total.delta, 0) : '—'}</td>
            <td>{cell(c?.power)}</td>
            <td>{cell(c?.resourceCost)}</td>
            {onEnable && <td>{!unused && <button type="button" className="secondary-button" disabled={enabled} onClick={() => onEnable(v.id)}>{enabled ? 'Разрешён' : 'Разрешить в плане'}</button>}</td>}
          </tr>;
        })}</tbody>
      </table></div>
      <ul className="hint">{report.notes.map((note, i) => <li key={i}>{note}</li>)}</ul>
      {onEnable && <p className="hint">Разрешение рецепта меняет только список рецептов плана. Результат станет устаревшим до нового расчёта.</p>}
    </>}
  </section>;
}
