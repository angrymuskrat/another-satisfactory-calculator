import { useEffect, useEffectEvent, useId, useMemo, useState } from 'react';
import { Calculator, ChevronDown, Play, SlidersHorizontal, Square } from 'lucide-react';
import { buildConstruction } from '../../../packages/domain/construction';
import { sourceLabel } from '../../../packages/domain/sourceLabel';
import { hasSolution, type Catalog, type Plan, type ProductResult, type Result } from '../../../packages/domain/types';
import { ItemIcon, ItemSelect, format, unit } from './controls';
import { firstProductionBlock, quickOrderPlan } from './quickOrderPlan';
import { ShareOrder } from './ShareOrder';
import { useSolver } from './useSolver';
import './quickOrder.css';

const statuses: Record<Result['status'], string> = {
  optimal: 'Оптимум модели', approximate: 'Допустимое приближение', infeasible: 'Заказ невыполним',
  unbounded: 'Выпуск не ограничен', timeout: 'Время расчёта истекло', error: 'Ошибка расчёта',
};

interface QuickOrderProps {
  catalog: Catalog;
  open: boolean;
  onToggle: (open: boolean) => void;
  onAdvanced: (plan: Plan) => void;
}
export function QuickOrder({ catalog, open, onToggle, onAdvanced }: QuickOrderProps) {
  const [productId, setProductId] = useState('iron-plate');
  const [text, setText] = useState('20');
  const [submitted, setSubmitted] = useState<Plan | null>(null);
  const id = useId();
  const product = catalog.items.find(item => item.id === productId) ?? catalog.items[0];
  const rate = Number(text.trim().replace(',', '.'));
  const valid = /^[\d.,]+$/.test(text.trim()) && Number.isFinite(rate) && rate >= 1e-6 && rate <= 1e9;
  const plan = useMemo(() => valid ? quickOrderPlan(catalog, product, rate) : null, [catalog, product, rate, valid]);

  return <section className="panel quick-order" aria-labelledby={id + '-title'}>
    <h2 id={id + '-title'}><button type="button" className="quick-order-toggle" aria-expanded={open} aria-controls={id}
      onClick={() => { onToggle(!open); setSubmitted(null); }}>
      <Calculator size={19} aria-hidden="true" />Рассчитать по продукту<ChevronDown size={18} aria-hidden="true" />
    </button></h2>
    <div id={id} hidden={!open} className="quick-order-content">
      <div className="quick-order-fields">
        <div><span className="field-label">Продукт</span>
          <ItemSelect label="Продукт быстрого заказа" items={catalog.items} value={product.id}
            onChange={value => { setProductId(value); setSubmitted(null); }} />
        </div>
        <form onSubmit={event => { event.preventDefault(); if (plan) setSubmitted(plan); }}>
          <label><span className="field-label">Выпуск в минуту</span>
            <span className="number-field"><input type="text" inputMode="decimal" aria-label="Выпуск в минуту"
              aria-invalid={!valid} aria-describedby={!valid ? id + '-error' : undefined} value={text}
              onChange={event => { setText(event.target.value); setSubmitted(null); }} /><span>{unit(product)}</span></span>
          </label>
          <button type="submit" className="primary-button" disabled={!plan || !!submitted}>
            <Play size={15} aria-hidden="true" />Рассчитать заказ
          </button>
        </form>
      </div>
      {!valid && <p id={id + '-error'} className="form-error" role="status">Введите выпуск от 0,000001 до 1 000 000 000 в минуту.</p>}
      <p className="quick-order-assumptions">Сырьё поступает извне без ограничения. Энергия его добычи неизвестна.
        {' '}Доступны обычные рецепты и все производственные здания. Частота до 100%.</p>
      <small>Каталог {catalog.version}</small>
      {submitted && <OrderCalculation catalog={catalog} plan={submitted} />}
      {plan && <div className="quick-order-actions"><ShareOrder plan={plan} />
        <button type="button" className="secondary-button" onClick={() => { onToggle(false); setSubmitted(null); onAdvanced(plan); }}>
          <SlidersHorizontal size={16} aria-hidden="true" />Расширенные настройки
        </button>
      </div>}
    </div>
  </section>;
}

export function OrderCalculation({ catalog, plan }: { catalog: Catalog; plan: Plan }) {
  return <SnapshotCalculation key={JSON.stringify(plan)} catalog={catalog} plan={plan} />;
}

function SnapshotCalculation({ catalog, plan }: { catalog: Catalog; plan: Plan }) {
  const { report, error, calculate, running, cancel } = useSolver(catalog, plan, 'order');
  const start = useEffectEvent(() => calculate());
  useEffect(() => { start(); }, [catalog]);
  const variant = report?.variants.find(candidate => hasSolution(candidate.result)) ?? report?.variants[0];
  const failure = variant ? (!hasSolution(variant.result) ? variant.result : null) : report?.pareto?.failures[0];
  return <section className="quick-order-result" aria-label="Результат заказа">
    {running && <div className="quick-order-progress"><span role="status">Рассчитываем заказ…</span>
      <button type="button" className="secondary-button" onClick={cancel}><Square size={14} aria-hidden="true" />Отменить расчёт</button>
    </div>}
    {error && <p className="alert warning" role="status">{error}</p>}
    {variant && <>
      <p role="status" className={'status-badge ' + variant.result.status}>{statuses[variant.result.status]}</p>
      {report?.pareto && <p className="hint">Вариант обзора Парето · {variant.label}</p>}
      {hasSolution(variant.result) && <OrderSummary catalog={catalog} plan={variant.plan} result={variant.result} />}
    </>}
    {failure && <div className="alert warning"><div>
      {!variant && <strong>{report?.pareto?.failures[0].label} · {statuses[failure.status]}</strong>}
      <p>{failure.message}</p>
      {failure.status === 'infeasible' && <p>В расширенных настройках проверьте поставки сырья, доступные рецепты и получателей побочных продуктов.</p>}
      {failure.status === 'unbounded' && <p>Чтобы ограничить выпуск, задайте пределы источников или мощности в расширенных настройках.</p>}
    </div></div>}
    {!running && (error || failure) &&
      <button type="button" className="secondary-button" onClick={() => calculate()}>Повторить расчёт</button>}
  </section>;
}

function flowRate(value: number) {
  return value > 0 && value < 1e-6 ? value.toExponential(2) : format(value, 6);
}

function OrderSummary({ catalog, plan, result }: { catalog: Catalog; plan: Plan; result: Result }) {
  const construction = useMemo(() => {
    try {
      const model = buildConstruction(catalog, plan, result);
      return { block: firstProductionBlock(model.production), extraction: model.extraction.length > 0 };
    } catch (cause) {
      return { error: cause instanceof Error ? cause.message : 'Не удалось проверить первый производственный блок.' };
    }
  }, [catalog, plan, result]);
  const item = (id: string) => catalog.items.find(value => value.id === id);
  const flows = (rows: ProductResult[]) => rows.map(row => {
    const product = item(row.itemId);
    return `${product?.name ?? row.itemId} · ${flowRate(row.rate)} ${unit(product)}`;
  }).join(', ');
  const used = result.resources.filter(source => source.rate > 0);
  return <>
    <div className="quick-order-totals">
      <section><h3>Выпуск</h3><ul>{result.products.map(row => <li key={row.itemId}>
        <ItemIcon item={item(row.itemId)} size={25} /><span>{item(row.itemId)?.name}</span>
        <strong>{flowRate(row.rate)} {unit(item(row.itemId))}</strong>
      </li>)}</ul></section>
      <section><h3>Расход сырья</h3>{used.length ? <ul>{used.map(source => <li key={source.sourceId}>
        <ItemIcon item={item(source.itemId)} size={25} /><span>{sourceLabel(catalog, plan, source.sourceId, source.itemId)}</span>
        <strong>{flowRate(source.rate)} {unit(item(source.itemId))}</strong>
      </li>)}</ul> : <p>Подача сырья не требуется.</p>}</section>
    </div>
    <section className="quick-order-block"><h3>Первый производственный блок</h3>
      {construction.error ? <p role="alert">{construction.error}</p> : construction.block ? <>
        {construction.block.cyclic && <p>Это замкнутый цикл. Подготовьте все указанные машины и запустите их совместно.</p>}
        {construction.block.groups.map(group => <div key={group.id} className="quick-order-machine">
          <strong>{catalog.buildings.find(building => building.id === group.buildingId)?.name} × {format(group.count)}</strong>
          <span>{catalog.recipes.find(recipe => recipe.id === group.recipeId)?.name ?? group.name} · частота {format(group.clock)}%
            {group.activeDuty < 1 - 1e-8 && ` · доля работы ${format(group.activeDuty * 100, 4)}%`}
            {!!group.somersloops && ` · усилителей на машину ${group.somersloops}`}
          </span>
          {group.averageInputs.length > 0 && <p>На входе — {flows(group.averageInputs)}.</p>}
          {group.averageOutputs.length > 0 && <p>На выходе — {flows(group.averageOutputs)}.</p>}
          {group.generatedPower !== undefined && <p>Выработка {format(group.generatedPower)} МВт.</p>}
        </div>)}
      </> : <p>{plan.batch?.items.every(row => row.stock >= row.required)
        ? 'Партия уже есть на складе.'
        : construction.extraction ? 'Продукт поступает из добывающих установок. Переработка не требуется.'
        : used.length ? 'Подайте продукт напрямую из внешних поставок. Переработка не требуется.'
        : 'Производственные машины для этого выпуска не используются.'}</p>}
    </section>
  </>;
}
