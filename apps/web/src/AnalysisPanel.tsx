import { useMemo, useState } from 'react';
import type { Catalog, Plan, Result } from '../../../packages/domain/types';
import { constraintCandidates, type AnalysisReport, type AnalysisVariant, type Benefit, type Delta, type Summary } from '../../../packages/solver/analysis';
import { format, unit } from './controls';
import { useAnalysis } from './useAnalysis';

const statusLabels: Record<Result['status'], string> = { optimal: 'Оптимум подтверждён', infeasible: 'Невыполнимо', unbounded: 'Выпуск не ограничен', timeout: 'Время истекло', error: 'Ошибка' };
const benefitLabels: Record<Benefit, string> = { output: 'Подтверждён рост выпуска', feasibility: 'Заказ стал выполнимым', 'reachable-output': 'Подтверждён рост достижимой доли', cost: 'Подтверждена экономия по текущему порядку целей', none: 'Улучшения не обнаружено', unknown: 'Польза не установлена' };
const signed = (value: number) => `${value > 1e-6 ? '+' : ''}${format(Math.abs(value) < 1e-6 ? 0 : value, 3)}`;

export function AnalysisPanel({ catalog, plan }: { catalog: Catalog; plan: Plan }) {
  // Remount selection when its source restrictions change; results have their own stale guard.
  return <AnalysisControls key={JSON.stringify(plan)} catalog={catalog} plan={plan} />;
}
function AnalysisControls({ catalog, plan }: { catalog: Catalog; plan: Plan }) {
  const analysis = useAnalysis(catalog, plan);
  const candidates = useMemo(() => constraintCandidates(catalog, plan), [catalog, plan]);
  const [selected, setSelected] = useState<string[]>(() => candidates.slice(0, 8).map(c => c.id));
  const [query, setQuery] = useState('');
  return <section className="panel analysis-panel" aria-label="Анализ вариантов фабрики">
    <h2>Сравнить варианты фабрики</h2>
    <p>Полный пересчёт с тем же заказом, миром, частотами и ограничениями. Исходный план сохраняется.</p>
    <p>Частота производства: {format(plan.settings.clock)}%. Предел потери выпуска: {format(plan.settings.outputSlack)}%.</p>
    <button className="primary-button" disabled={analysis.running || !plan.targets.length} onClick={() => analysis.calculate({ kind: 'objectives' })}>Сравнить энергию, сырьё и здания</button>
    {!!plan.lines?.length && <button className="secondary-button" disabled={analysis.running} onClick={() => analysis.calculate({ kind: 'expansion' })}>Сравнить оставить / добавить / перестроить</button>}
    <details><summary>Проверить полезное расширение · выбрано {selected.length} из {candidates.length}</summary>
      <p>Каждое изменение проверяется отдельно; выбранные изменения также проверяются совместно. До 12 изменений за запуск.</p>
      <input aria-label="Поиск ограничений для анализа" placeholder="Источник, рецепт или здание" value={query} onChange={e => setQuery(e.target.value)} />
      <button className="text-button" onClick={() => setSelected([])}>Снять выбор проверок</button>
      <ul className="analysis-candidates">{candidates.filter(c => c.label.toLocaleLowerCase('ru').includes(query.toLocaleLowerCase('ru'))).map(c => <li key={c.id}>
        <label><input type="checkbox" checked={selected.includes(c.id)} disabled={analysis.running || (!selected.includes(c.id) && selected.length >= 12)} onChange={e => setSelected(e.target.checked ? [...selected, c.id] : selected.filter(id => id !== c.id))} /> {c.label}</label>
      </li>)}</ul>
      {!candidates.length && <p>Нет конечных источников, лимитов или выключенных технологий для таких проверок.</p>}
      <button className="secondary-button" disabled={analysis.running || !selected.length || !plan.targets.length} onClick={() => analysis.calculate({ kind: 'constraints', candidateIds: selected })}>Проверить выбранные изменения</button>
    </details>
    <AnalysisFeedback analysis={analysis} catalog={catalog} />
  </section>;
}
export function AnalysisFeedback({ analysis, catalog }: { analysis: ReturnType<typeof useAnalysis>; catalog: Catalog }) {
  return <div>
    <p className="sr-only" role="status">{analysis.running ? 'Пересчитываем варианты…' : analysis.report ? 'Сравнение вариантов завершено.' : ''}</p>
    {analysis.running && <p>Пересчитываем варианты… <button className="secondary-button" onClick={analysis.cancel}>Отменить анализ</button></p>}
    {analysis.error && <p role="alert">{analysis.error}</p>}
    {analysis.report && <AnalysisReportView catalog={catalog} report={analysis.report} />}
  </div>;
}
function SummaryTable({ summary }: { summary: Summary }) {
  return <div className="table-scroll"><table><caption>Показатели полного плана</caption><tbody>
    <tr><th scope="row">Средняя мощность, МВт</th><td>{format(summary.power, 3)}</td></tr>
    <tr><th scope="row">Максимальная нагрузка, МВт</th><td>{format(summary.installedPower, 3)}</td></tr>
    <tr><th scope="row">Условная стоимость сырья</th><td>{format(summary.resourceCost, 3)}</td></tr>
    <tr><th scope="row">Физические здания, всего</th><td>{summary.physical.total}</td></tr>
    <tr><th scope="row">Производство / добыча / Sink</th><td>{summary.physical.production} / {summary.physical.extraction} / {summary.physical.sinks}</td></tr>
  </tbody></table></div>;
}
function ResultFlows({ catalog, result }: { catalog: Catalog; result: Result }) {
  return <>
    {result.status === 'optimal' && <div className="table-scroll"><table><caption>Выпуск и источники</caption><thead><tr><th>Поток</th><th>Количество</th></tr></thead><tbody>
      {result.products.map(p => <tr key={`product:${p.itemId}`}><th scope="row">Выпуск: {catalog.items.find(i => i.id === p.itemId)?.name ?? p.itemId}</th><td>{format(p.rate, 3)} {unit(catalog.items.find(i => i.id === p.itemId))}</td></tr>)}
      {result.resources.map(r => <tr key={`source:${r.sourceId}`}><th scope="row">{catalog.items.find(i => i.id === r.itemId)?.name ?? r.itemId} · {r.sourceId}</th><td>{format(r.rate, 3)} {unit(catalog.items.find(i => i.id === r.itemId))}</td></tr>)}
      {result.surplus.map(r => <tr key={`sink:${r.itemId}`}><th scope="row">В Sink: {catalog.items.find(i => i.id === r.itemId)?.name ?? r.itemId}</th><td>{format(r.rate, 3)} {unit(catalog.items.find(i => i.id === r.itemId))}</td></tr>)}
    </tbody></table></div>}
    {result.feasibleAlternative && <div className="feasible-alternative"><p>Достижимо {format(result.feasibleAlternative.fraction * 100)}% заказа. Исходный заказ остаётся невыполнимым.</p>
      <ul>{result.feasibleAlternative.products.map(p => <li key={p.itemId}>{catalog.items.find(i => i.id === p.itemId)?.name ?? p.itemId}: {format(p.rate, 3)} {unit(catalog.items.find(i => i.id === p.itemId))}</li>)}</ul>
    </div>}
    {result.status !== 'optimal' && <p>{result.message}</p>}
    {result.warnings.length > 0 && <details><summary>Границы расчёта и предупреждения</summary><ul>{result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></details>}
  </>;
}
function ChangeRow({ label, value }: { label: string; value: Delta }) {
  return <tr><th scope="row">{label}</th><td>{format(value.before, 3)}</td><td>{format(value.after, 3)}</td><td>{signed(value.delta)}</td></tr>;
}
function Variant({ catalog, variant, kind }: { catalog: Catalog; variant: AnalysisVariant; kind: AnalysisReport['kind'] }) {
  const c = variant.comparison;
  return <details className="panel" open><summary>{variant.label} · {statusLabels[variant.result.status]}</summary>
    {kind !== 'objectives' && <p>{benefitLabels[variant.benefit]}</p>}
    {variant.id === 'joint' && <p>Проверено совместное изменение {variant.candidateIds.length} условий. Необходимость каждого из них по отдельности не доказана.</p>}
    {c ? <>
      <div className="table-scroll"><table><caption>Цена изменения относительно исходного плана</caption><thead><tr><th>Показатель</th><th>До</th><th>После</th><th>Разница</th></tr></thead><tbody>
        <ChangeRow label="Средняя мощность, МВт" value={c.power} /><ChangeRow label="Максимальная нагрузка, МВт" value={c.installedPower} /><ChangeRow label="Условная стоимость сырья" value={c.resourceCost} />
        <ChangeRow label="Все физические здания" value={c.physical.total} /><ChangeRow label="Производственные здания" value={c.physical.production} /><ChangeRow label="Добытчики" value={c.physical.extraction} /><ChangeRow label="Утилизаторы" value={c.physical.sinks} />
        {c.outputs.map(r => <ChangeRow key={r.id} label={`Выпуск: ${catalog.items.find(i => i.id === r.itemId)?.name ?? r.itemId}, ${unit(catalog.items.find(i => i.id === r.itemId))}`} value={r} />)}
        {c.sources.map(r => <ChangeRow key={r.id} label={`Источник: ${catalog.items.find(i => i.id === r.itemId)?.name ?? r.itemId} · ${r.id}, ${unit(catalog.items.find(i => i.id === r.itemId))}`} value={r} />)}
      </tbody></table></div>
      <div className="table-scroll"><table><caption>Изменённые рецепты</caption><thead><tr><th>Рецепт</th><th>Циклы/мин: до → после</th><th>Машины: до → после</th></tr></thead><tbody>
        {c.recipes.map(r => <tr key={r.id}><th scope="row">{catalog.recipes.find(recipe => recipe.id === r.id)?.name ?? r.id}</th><td>{format(r.cycles.before, 3)} → {format(r.cycles.after, 3)}</td><td>{r.machines.before} → {r.machines.after}</td></tr>)}
        {!c.recipes.length && <tr><td colSpan={3}>Производственная цепочка не изменилась.</td></tr>}
      </tbody></table></div>
      <ResultFlows catalog={catalog} result={variant.result} />
    </> : <>{variant.summary && <SummaryTable summary={variant.summary} />}<ResultFlows catalog={catalog} result={variant.result} /></>}
  </details>;
}
export function AnalysisReportView({ catalog, report }: { catalog: Catalog; report: AnalysisReport }) {
  return <section aria-label="Результаты анализа">
    <h3>{report.complete ? 'Результаты сравнения' : 'Частичные результаты сравнения'}</h3>
    {report.noProductionPath && <div className="empty-panel"><h3>Нет производственного пути при текущих ограничениях</h3><p>Расчёт подтвердил нулевой выпуск. Проверяйте источники, мощность, доступность рецептов и зданий, вывод побочных продуктов. Положительный выпуск после изменения ещё нужно подтвердить.</p></div>}
    <details><summary>Исходный план · {statusLabels[report.baseline.status]}</summary>{report.baselineSummary && <SummaryTable summary={report.baselineSummary} />}<ResultFlows catalog={catalog} result={report.baseline} /></details>
    {report.variants.map(v => <Variant key={v.id} catalog={catalog} variant={v} kind={report.kind} />)}
    <ul>{report.notes.map((note, i) => <li key={i}>{note}</li>)}</ul>
  </section>;
}
