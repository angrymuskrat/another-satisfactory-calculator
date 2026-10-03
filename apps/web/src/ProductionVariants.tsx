import { useRef } from 'react';
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
  return <>
    <h2 className="variant-title" ref={heading} tabIndex={-1}>{showCards || running ? 'Варианты производства' : selected ? selected.label : 'Расчёт производства'}</h2>
    {showCards ? <section aria-label="Выбор варианта производства" className="production-variants">
      <p role="status">{stale ? 'Требуется пересчёт' : hasVariants ? 'Выберите вариант, чтобы открыть подробный план строительства.' : 'Подбор завершён без доступного варианта. Статусы каждого расчёта показаны отдельно.'}</p>
      {error && <p role="alert" className="alert error">{error}</p>}
      {!!merged.length && <p className="alert">{report?.equivalent ? 'Все режимы дали одинаковый план. Показан один вариант.' : merged.join(' ')}</p>}
      <div className="variant-grid">{variants?.map(variant => {
        const { result } = variant;
        const valid = hasSolution(result);
        const item = (id: string) => catalog.items.find(i => i.id === id);
        const machines = result.steps.reduce((total, step) => total + step.installedMachines, 0);
        return <article className="panel variant-card" key={variant.id} aria-labelledby={`variant-${variant.id}`}>
          <span className={`status-badge ${result.status}`}>{statuses[result.status]}</span>
          <h3 id={`variant-${variant.id}`}>{variant.label}</h3>
          <p className="hint">{variant.id === 'maximum' ? 'Компактная фабрика с полным доступным выпуском или заданным заказом.' : `${variant.id === 'economy' ? `Экономия в пределах компактной фабрики + ${variant.plan.settings.smoothPowerExtraMachines ?? 0} машин.` : 'Сначала минимум взвешенного сырья, затем машины и энергия.'} ${plan.mode === 'maximize' && !plan.batch ? `Допустимая потеря выпуска: ${format(variant.plan.settings.outputSlack)}%.` : 'Заказ сохраняется полностью.'}`}</p>
          {valid ? <>
            <dl className="variant-metrics">
              {result.products.map(product => <div key={product.itemId}><dt>{item(product.itemId)?.name ?? product.itemId}</dt><dd>{metric(product.rate, 6)} {unit(item(product.itemId))}{variant.id !== 'maximum' && <small>{difference(product.rate, baseline?.result.products.find(p => p.itemId === product.itemId)?.rate ?? 0)} к максимальному варианту</small>}</dd></div>)}
              <div><dt>Средняя мощность</dt><dd><span data-metric="power">{metric(result.power)}</span> МВт{variant.id !== 'maximum' && <small>{difference(result.power, baseline?.result.power ?? 0)} к максимальному варианту</small>}</dd></div>
              <div><dt>Пиковая мощность</dt><dd>{metric(result.installedPower)} МВт</dd></div>
              <div><dt>Машины производства</dt><dd>{machines}</dd></div>
              <div><dt>Взвешенное сырьё</dt><dd>{metric(weightedResources(variant.plan, result))}{variant.id !== 'maximum' && baseline && hasSolution(baseline.result) && <small>{difference(weightedResources(variant.plan, result), weightedResources(baseline.plan, baseline.result))} к максимальному варианту</small>}</dd></div>
              {result.machineBudget && <div><dt>Общий бюджет машин</dt><dd>{result.machineBudget.used} / {result.machineBudget.limit}<small>Компактный вариант: {result.machineBudget.minimum}. Включены добытчики, скважины со спутниками и утилизаторы.</small></dd></div>}
              {usedResources(variant.plan, result.resources).map(source => <div key={source.sourceId}><dt>{plan.sources.find(s => s.id === source.sourceId)?.name || item(source.itemId)?.name || source.sourceId}</dt><dd>{metric(source.rate)} {unit(item(source.itemId))}</dd></div>)}
            </dl>
            <button className="primary-button" disabled={stale || running} onClick={() => { const next = solver.choose(variant.id); if (next) { setPlan(next); focusHeading(); } }}>Использовать вариант</button>
          </> : <div className="alert error" role="alert"><div><strong>{statuses[result.status]}</strong><p>{result.message}</p><p>Этот вариант выбрать нельзя.{hasVariants ? ' Успешный вариант остаётся доступен.' : ''}</p></div></div>}
        </article>;
      })}</div>
      {hasVariants && <ModelNotes notes={['Частоты подобраны для непрерывной работы, где это возможно. Энергия добычи и утилизации учитывается; неизвестная энергия внешних поставок исключена. Фактические колебания сети не моделируются.', 'Природные ресурсы без заданного источника и без расхода не показаны.']} />}
      {!hasVariants && <Results catalog={catalog} plan={report!.variants[0]?.plan ?? plan} result={solver.result} stale={stale} running={running} error={null} />}
    </section> : <>
      {selected && <button className="text-button" onClick={() => { solver.showChoices(); focusHeading(); }}>Вернуться к вариантам</button>}
      <Results key={selected?.id ?? 'pending'} catalog={catalog} plan={selected?.plan ?? plan} result={solver.result} stale={stale} running={running} error={error} onEnableRecipe={id => setPlan({ ...plan, settings: { ...plan.settings, enabledRecipeIds: [...plan.settings.enabledRecipeIds, id] } })} />
    </>}
  </>;
}
