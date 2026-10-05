import { useRef } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { Catalog, Plan, Result } from '../../../packages/domain/types';
import { hasSolution } from '../../../packages/domain/types';
import { ModelNotes, Results, usedResources } from './Results';
import { format, unit } from './controls';
import type { useSolver } from './useSolver';

const statuses = { approximate: 'Допустимое приближение', optimal: 'Оптимум модели', error: 'Ошибка расчёта', timeout: 'Время расчёта истекло', infeasible: 'Заказ невыполним', unbounded: 'Выпуск не ограничен' };
const metric = (value: number, digits = 2) => value !== 0 && Math.abs(value) < 10 ** -digits ? value.toExponential(3) : format(value, digits);
const weightedResources = (plan: Plan, result: Result) => result.resources.reduce((sum, r) => sum + r.rate * (plan.settings.resourceWeights[r.itemId] ?? 1), 0);
const difference = (value: number, baseline: number) => baseline > 0 ? `${value >= baseline ? '+' : '−'}${format(Math.abs(value / baseline - 1) * 100)}%` : '—';

export function ProductionVariants({ catalog, plan, setPlan, solver }: { catalog: Catalog; plan: Plan; setPlan: (plan: Plan) => void; solver: ReturnType<typeof useSolver> }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const { report, selected, choosing, stale, running, error } = solver;
  const hasVariants = report?.variants.some(v => hasSolution(v.result));
  const showCards = report !== null && choosing;
  const baseline = report?.variants[0];
  const variants = report?.variants.filter(v => !v.sameAs);
  const merged = report?.variants.filter(v => v.sameAs).map(v => `«${v.label}» совпадает с «${report.variants.find(o => o.id === v.sameAs)?.label}».`) ?? [];
  const focusHeading = () => requestAnimationFrame(() => heading.current?.focus());
  const item = (id: string) => catalog.items.find(i => i.id === id);
  // Общий набор строк: одинаковые метрики стоят на одной высоте во всех вариантах.
  const solved = (variants ?? []).filter(v => hasSolution(v.result));
  const productIds = [...new Set(solved.flatMap(v => v.result.products.map(p => p.itemId)))];
  const sourceIds = [...new Set(solved.flatMap(v => usedResources(v.plan, v.result.resources).map(r => r.sourceId)))];
  const withBudget = solved.some(v => v.result.machineBudget);
  const rowCount = productIds.length + 4 + (withBudget ? 1 : 0) + sourceIds.length;
  return <>
    {!showCards && selected && <button className="text-button variant-back" onClick={() => { solver.showChoices(); focusHeading(); }}><ArrowLeft size={14} />Вернуться к вариантам</button>}
    <h2 className="variant-title" ref={heading} tabIndex={-1}>{showCards || running ? 'Варианты производства' : selected ? selected.label : 'Расчёт производства'}</h2>
    {showCards ? <section aria-label="Выбор варианта производства" className="production-variants">
      <p role="status">{stale ? 'Требуется пересчёт' : hasVariants ? 'Выберите вариант, чтобы открыть подробный план строительства.' : 'Подбор завершён без доступного варианта. Статусы каждого расчёта показаны отдельно.'}</p>
      {error && <p role="alert" className="alert error">{error}</p>}
      {!!merged.length && <p className="alert">{report?.equivalent ? 'Все режимы дали одинаковый план. Показан один вариант.' : merged.join(' ')}</p>}
      <div className="variant-grid">{variants?.map(variant => {
        const { result } = variant;
        const valid = hasSolution(result);
        const machines = result.steps.reduce((total, step) => total + step.installedMachines, 0);
        return <article className={'panel variant-card' + (valid ? ' is-aligned' : '')} key={variant.id} aria-labelledby={`variant-${variant.id}`} style={{ gridRow: `span ${rowCount + 4}` }}>
          <span className={`status-badge ${result.status}`}>{statuses[result.status]}</span>
          <h3 id={`variant-${variant.id}`}>{variant.label}</h3>
          <p className="hint">{variant.id === 'maximum' ? 'Компактная фабрика с полным доступным выпуском или заданным заказом.' : `${variant.id === 'economy' ? `Экономия в пределах компактной фабрики + ${variant.plan.settings.smoothPowerExtraMachines ?? 0} машин.` : 'Сначала минимум взвешенного сырья, затем машины и энергия.'} ${plan.mode === 'maximize' && !plan.batch ? `Допустимая потеря выпуска: ${format(variant.plan.settings.outputSlack)}%.` : 'Заказ сохраняется полностью.'}`}</p>
          {valid ? <>
            <dl className="variant-metrics">
              {productIds.map(id => { const product = result.products.find(p => p.itemId === id); return <div key={id}><dt>{item(id)?.name ?? id}</dt><dd>{product ? <>{metric(product.rate, 6)} {unit(item(id))}{variant.id !== 'maximum' && <small>{difference(product.rate, baseline?.result.products.find(p => p.itemId === id)?.rate ?? 0)} к максимальному варианту</small>}</> : '—'}</dd></div>; })}
              <div><dt>Средняя мощность</dt><dd><span data-metric="power">{metric(result.power)}</span> МВт{variant.id !== 'maximum' && <small>{difference(result.power, baseline?.result.power ?? 0)} к максимальному варианту</small>}</dd></div>
              <div><dt>Пиковая мощность</dt><dd>{metric(result.installedPower)} МВт</dd></div>
              <div><dt>Машины производства</dt><dd>{machines}</dd></div>
              <div><dt>Взвешенное сырьё</dt><dd>{metric(weightedResources(variant.plan, result))}{variant.id !== 'maximum' && baseline && hasSolution(baseline.result) && <small>{difference(weightedResources(variant.plan, result), weightedResources(baseline.plan, baseline.result))} к максимальному варианту</small>}</dd></div>
              {withBudget && <div><dt>Общий бюджет машин</dt><dd>{result.machineBudget ? <>{result.machineBudget.used} / {result.machineBudget.limit}<small>Компактный вариант: {result.machineBudget.minimum}. Включены добытчики, скважины со спутниками и утилизаторы.</small></> : '—'}</dd></div>}
              {sourceIds.map(id => { const source = result.resources.find(r => r.sourceId === id); const configured = plan.sources.find(s => s.id === id); const itemId = source?.itemId ?? configured?.itemId ?? ''; return <div key={id}><dt>{configured?.name?.trim() || item(itemId)?.name || itemId}</dt><dd>{source ? `${metric(source.rate)} ${unit(item(itemId))}` : '—'}</dd></div>; })}
            </dl>
            <button className="secondary-button variant-choose" disabled={stale || running} onClick={() => { const next = solver.choose(variant.id); if (next) { setPlan(next); focusHeading(); } }}>Использовать вариант</button>
          </> : <div className="alert error" role="alert"><div><strong>{statuses[result.status]}</strong><p>{result.message}</p><p>Этот вариант выбрать нельзя.{hasVariants ? ' Успешный вариант остаётся доступен.' : ''}</p></div></div>}
        </article>;
      })}</div>
      {hasVariants && <ModelNotes notes={['Частоты подобраны для непрерывной работы, где это возможно. Энергия добычи и утилизации учитывается; неизвестная энергия внешних поставок исключена. Фактические колебания сети не моделируются.', 'Природные ресурсы без заданного источника и без расхода не показаны.']} />}
      {!hasVariants && <Results catalog={catalog} plan={report!.variants[0]?.plan ?? plan} result={solver.result} stale={stale} running={running} error={null} />}
    </section> : <>
      <Results key={selected?.id ?? 'pending'} catalog={catalog} plan={selected?.plan ?? plan} result={solver.result} stale={stale} running={running} error={error} onEnableRecipe={id => setPlan({ ...plan, settings: { ...plan.settings, enabledRecipeIds: [...plan.settings.enabledRecipeIds, id] } })} />
    </>}
  </>;
}
