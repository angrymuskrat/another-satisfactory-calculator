import { useRef, type ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { Catalog, Plan, Result } from '../../../packages/domain/types';
import { hasSolution } from '../../../packages/domain/types';
import { ModelNotes, Results, usedResources } from './Results';
import { format, unit } from './controls';
import type { useSolver } from './useSolver';
import { sourceLabel } from '../../../packages/domain/sourceLabel';

const statuses = { approximate: 'Допустимое приближение', optimal: 'Оптимум модели', error: 'Ошибка расчёта', timeout: 'Время расчёта истекло', infeasible: 'Заказ невыполним', unbounded: 'Выпуск не ограничен' };
const metric = (value: number, digits = 2) => value !== 0 && Math.abs(value) < 10 ** -digits ? value.toExponential(3) : format(value, digits);
const weightedResources = (plan: Plan, result: Result) => result.resources.reduce((sum, r) => sum + r.rate * (plan.settings.resourceWeights[r.itemId] ?? 1), 0);
type Variant = NonNullable<ReturnType<typeof useSolver>['report']>['variants'][number];
type MetricRow = { key: string; label: string; value: (variant: Variant) => ReactNode };
/** Строки карточки вне таблицы метрик: статус, название, описание, кнопка выбора. */
const CARD_ROWS = 4;
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
  const sources = new Map(solved.flatMap(v => usedResources(v.plan, v.result.resources).map(r => [r.sourceId, r.itemId] as const)));
  const versus = (variant: Variant, value: number, base: number | undefined) => variant.id !== 'maximum' && base !== undefined && <small>{difference(value, base)} к максимальному варианту</small>;
  const baseResult = baseline && hasSolution(baseline.result) ? baseline.result : null;
  const rows: MetricRow[] = [
    ...productIds.map(id => ({ key: `product:${id}`, label: item(id)?.name ?? id, value: (v: Variant) => {
      const product = v.result.products.find(p => p.itemId === id);
      return product ? <>{metric(product.rate, 6)} {unit(item(id))}{versus(v, product.rate, baseline?.result.products.find(p => p.itemId === id)?.rate ?? 0)}</> : '—';
    } })),
    { key: 'power', label: 'Средняя мощность', value: v => <><span data-metric="power">{metric(v.result.power)}</span> МВт{versus(v, v.result.power, baseline?.result.power ?? 0)}</> },
    { key: 'peak', label: 'Пиковая мощность', value: v => `${metric(v.result.installedPower)} МВт` },
    { key: 'machines', label: 'Машины производства', value: v => v.result.steps.reduce((total, step) => total + step.installedMachines, 0) },
    { key: 'weighted', label: 'Взвешенное сырьё', value: v => <>{metric(weightedResources(v.plan, v.result))}{baseResult && baseline && versus(v, weightedResources(v.plan, v.result), weightedResources(baseline.plan, baseResult))}</> },
    ...(solved.some(v => v.result.machineBudget) ? [{ key: 'budget', label: 'Общий бюджет машин', value: (v: Variant) => v.result.machineBudget ? <>{v.result.machineBudget.used} / {v.result.machineBudget.limit}<small>Компактный вариант: {v.result.machineBudget.minimum}. Включены добытчики, скважины со спутниками и утилизаторы.</small></> : '—' }] : []),
    ...[...sources].map(([id, itemId]) => ({ key: `source:${id}`, label: sourceLabel(catalog, plan, id, itemId), value: (v: Variant) => {
      const source = v.result.resources.find(r => r.sourceId === id);
      return source ? `${metric(source.rate)} ${unit(item(itemId))}` : '—';
    } })),
  ];
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
        return <article className={'panel variant-card' + (valid ? ' is-aligned' : '')} key={variant.id} aria-labelledby={`variant-${variant.id}`} style={{ gridRow: `span ${rows.length + CARD_ROWS}` }}>
          <span className={`status-badge ${result.status}`}>{statuses[result.status]}</span>
          <h3 id={`variant-${variant.id}`}>{variant.label}</h3>
          <p className="hint">{variant.id === 'maximum' ? 'Компактная фабрика с полным доступным выпуском или заданным заказом.' : `${variant.id === 'economy' ? `Экономия в пределах компактной фабрики + ${variant.plan.settings.smoothPowerExtraMachines ?? 0} машин.` : 'Сначала минимум взвешенного сырья, затем машины и энергия.'} ${plan.mode === 'maximize' && !plan.batch ? `Допустимая потеря выпуска: ${format(variant.plan.settings.outputSlack)}%.` : 'Заказ сохраняется полностью.'}`}</p>
          {valid ? <>
            <dl className="variant-metrics" style={{ gridRow: `span ${rows.length}` }}>{rows.map(row => <div key={row.key}><dt>{row.label}</dt><dd>{row.value(variant)}</dd></div>)}</dl>
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
