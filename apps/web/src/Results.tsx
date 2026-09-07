import { useMemo, useState } from 'react';
import { ArrowRight, Boxes, Factory, Info, Layers, TriangleAlert, Zap } from 'lucide-react';
import type { Catalog, Plan, Result } from '../../../packages/domain/types';
import { hasSolution } from '../../../packages/domain/types';
import { buildConstruction } from '../../../packages/domain/construction';
import { CatalogStatus, Construction, CopyNumber } from './Construction';
import { BatchResult } from './Batch';
import { format, ItemIcon, unit } from './controls';

const statusLabels = { optimal: 'Оптимум найден', approximate: 'Допустимое приближение', infeasible: 'Заказ невыполним', unbounded: 'Выпуск не ограничен', error: 'Ошибка расчёта', timeout: 'Время расчёта истекло' };
export function Results({ catalog, plan, result, stale, running, error }: { catalog: Catalog; plan: Plan; result: Result | null; stale: boolean; running: boolean; error: string | null }) {
  const [building, setBuilding] = useState(false);
  const item = (id: string) => catalog.items.find(i => i.id === id);
  const calculated = useMemo(() => {
    if (!hasSolution(result) || stale) return { model: null, error: '' };
    try { return { model: buildConstruction(catalog, plan, result), error: '' }; }
    catch (e) { return { model: null, error: e instanceof Error ? e.message : 'Не удалось проверить конфигурацию.' }; }
  }, [catalog, plan, result, stale]);
  const model = calculated.model;
  const empty = !plan.batch?.items.every(i => i.stock >= i.required) && hasSolution(result) && !result.products.some(p => p.rate > 0);
  const settings = plan.settings;
  const peakLimit = settings.peakPowerLimit ?? null, reserve = settings.powerReserve ?? 0;
  const margin = model && peakLimit !== null ? peakLimit - reserve - model.peakPower : null;
  const lines = (id: string, rate: number) => {
    const fluid = item(id)?.fluid;
    const capacity = (fluid ? model?.transport.pipe : model?.transport.belt)?.rate;
    if (!capacity) return '—';
    const count = rate > 0 ? Math.max(1, Math.ceil(rate / capacity - Math.min(1e-7, rate / capacity * 1e-8))) : 0;
    const plural = new Intl.PluralRules('ru').select(count);
    const names = fluid ? { one: 'труба', few: 'трубы', many: 'труб', other: 'трубы' } : { one: 'лента', few: 'ленты', many: 'лент', other: 'ленты' };
    return count + ' ' + (names[plural as keyof typeof names] ?? names.other);
  };
  return <div className="results-column">
    <p className="sr-only" role="status">{running ? 'Подбираем рецепты и балансируем потоки…' : error ? '' : result ? stale ? 'Настройки изменились. Требуется пересчёт.' : empty ? 'Нулевой выпуск' : statusLabels[result.status] : 'Результат ещё не рассчитан.'}</p>
    <div className="results-heading"><div><span className="eyebrow">ПРОИЗВОДСТВЕННЫЙ ПЛАН</span><h2>Результат расчёта</h2></div>{result && <span className={'status-badge ' + (stale ? 'stale' : result.status)}><span />{stale ? 'Требуется пересчёт' : empty ? 'Нулевой выпуск' : statusLabels[result.status]}</span>}</div>
    {error && <div role="alert" className="alert error"><TriangleAlert size={18} />{error}</div>}
    {running && <div className="alert"><span className="spinner" />Подбираем рецепты и балансируем потоки…</div>}
    {!result ? <div className="empty-result"><div className="factory-illustration"><span className="orbit one" /><span className="orbit two" /><Factory size={72} strokeWidth={1.2} /><span className="factory-dot" /></div><span className="eyebrow">ОТ РУДЫ ДО ГОТОВОГО ПРОДУКТА</span><h3>У каждого ресурса есть потенциал</h3><p>Задайте выпуск и доступное сырьё.<br />Мы подберём рецепты, рассчитаем машины<br />и проверим материальный баланс.</p><div className="empty-steps"><span><Boxes size={16} />Ресурсы</span><ArrowRight size={14} /><span><Factory size={16} />Производство</span><ArrowRight size={14} /><span><Layers size={16} />Продукты</span></div></div>
      : <div className={stale ? 'result-content stale-content' : 'result-content'}>
        {stale ? <section className="panel"><h3>Настройки изменились</h3><p>Пересчитайте план, чтобы получить потоки, мощность и инструкцию строительства для текущей конфигурации.</p></section>
          : !hasSolution(result) ? <div className="panel result-problem"><TriangleAlert size={32} /><h3>{statusLabels[result.status]}</h3><p>{result.message}</p>{result.status === 'infeasible' && <p className="hint">Проверьте лимиты сырья и мощности, доступность зданий и рецептов, а также назначение побочных продуктов. Заказ не был автоматически уменьшен.</p>}{result.status === 'unbounded' && <p className="hint">Укажите конечные лимиты источников или мощности.</p>}</div>
            : empty ? <section className="panel result-problem"><Factory size={32} /><h3>{result.status === 'approximate' ? 'В этом плане выпуск нулевой' : 'Нет производственного пути с положительным выпуском'}</h3><p>{result.status === 'approximate' ? 'В приближённой модели положительный выпуск не найден. Это не доказывает невыполнимость точной модели.' : 'Решатель подтвердил математический оптимум с нулевым выпуском. Строить производственную линию по этому результату не требуется.'}</p><p>Проверьте доступное сырьё, рецепты и здания, лимиты средней и пиковой мощности, ограничения числа машин и возможность утилизации побочных продуктов.</p></section>
              : calculated.error ? <section className="panel" role="alert"><h3>Инструкция не прошла перепроверку</h3><p>{calculated.error}</p></section>
                : model && <>
                  <div className="kpi-grid"><div className="kpi"><span><Layers size={16} />{result.products.length === 1 ? item(result.products[0].itemId)?.name ?? result.products[0].itemId : 'Продукты'}</span><strong>{result.products.length === 1 ? format(result.products[0].rate, 6) : result.products.filter(p => p.rate > 0).length}<small>{result.products.length === 1 ? unit(item(result.products[0].itemId)) : 'позиций с выпуском'}</small></strong></div><div className="kpi"><span><Zap size={16} />Средняя мощность</span><strong>{format(model.averagePower)}<small>МВт</small></strong></div><div className="kpi"><span><Factory size={16} />Машины производства</span><strong>{model.production.reduce((sum, group) => sum + group.count, 0)}<small>зданий</small></strong></div></div>
                  <section className="panel output-panel"><div className="section-heading"><h3>Готовая продукция</h3></div>{result.products.map(product => <div className="output-row" key={product.itemId}><ItemIcon item={item(product.itemId)} size={42} /><div><strong>{item(product.itemId)?.name ?? product.itemId}</strong><small>{lines(product.itemId, product.rate)} параллельно · средний поток</small></div><CopyNumber value={product.rate} label={'Выпуск: ' + (item(product.itemId)?.name ?? product.itemId)} suffix={unit(item(product.itemId))} /></div>)}</section>
                  <section className="panel"><div className="section-heading"><h3>Загрузка источников</h3><span className="count-badge">{result.resources.length}</span></div>{result.resources.map(source => {
                    const configured = plan.sources.find(s => s.id === source.sourceId);
                    const sourceName = configured?.name?.trim() || source.sourceId;
                    return <div className="utilization" key={source.sourceId}><div><span><ItemIcon item={item(source.itemId)} size={24} />{item(source.itemId)?.name ?? source.itemId} · {sourceName}</span><strong>{format(source.rate, 6)} <small>/ {source.limit === null ? '∞' : format(source.limit)} {unit(item(source.itemId))}</small></strong></div><small>{configured?.kind === 'node' ? 'Месторождение · ' + (catalog.miners.find(m => m.id === configured.minerId)?.name ?? configured.minerId) + ' · ' + format(configured.clock) + '% · доступно узлов: ' + configured.count : configured?.kind === 'well' ? `Скважина · один компенсатор · ${format(configured.clock)}% · ${format(source.power)} МВт` : configured?.importPower != null ? `Внешняя поставка · энергия учтена: ${format(source.power)} МВт` : 'Внешняя поставка · энергия получения неизвестна'}</small><div className="progress-track"><span className={source.limit !== null && source.limit > 0 && source.rate / source.limit > .98 ? 'full' : ''} style={{ width: source.limit === null ? '20%' : Math.min(100, source.limit > 0 ? source.rate / source.limit * 100 : 0) + '%' }} /></div></div>;
                  })}{!result.resources.length && <p className="hint">Внешние источники не используются.</p>}</section>
                  <section className="panel energy-panel"><div className="section-heading"><h3><Zap size={17} /> Энергия и границы модели</h3></div><dl>
                    <div><dt>Производство · средняя</dt><dd>{format(model.productionPower)} МВт</dd></div><div><dt>Добыча · средняя</dt><dd>{format(model.extractionPower)} МВт</dd></div><div><dt>Утилизация · средняя</dt><dd>{format(model.sinkPower)} МВт</dd></div>
                    <div><dt>Незагруженная мощность производств</dt><dd>{format(model.productionIdlePower)} МВт</dd></div>
                    <div><dt>Бюджет средней мощности</dt><dd>{plan.settings.powerLimit === null ? 'Не ограничен' : format(plan.settings.powerLimit) + ' МВт'}</dd></div>
                    {plan.settings.powerLimit !== null && <div><dt>Остаток среднего бюджета</dt><dd>{format(plan.settings.powerLimit - model.averagePower)} МВт</dd></div>}
                    <div className="total"><dt>Консервативный пик физических машин</dt><dd>{format(model.peakPower)} МВт</dd></div>
                    <div><dt>Допустимая максимальная нагрузка сети</dt><dd>{peakLimit === null ? 'Не ограничена' : format(peakLimit) + ' МВт'}</dd></div><div><dt>Резерв пользователя</dt><dd>{format(reserve)} МВт</dd></div>
                    {margin !== null && <div className="total"><dt>Запас сети после резерва и пика</dt><dd>{format(margin)} МВт</dd></div>}
                  </dl>{margin !== null && <p className={margin < -1e-6 ? 'alert error' : 'hint'} role={margin < -1e-6 ? 'alert' : undefined}>{format(peakLimit!)} − {format(reserve)} − {format(model.peakPower)} = {format(margin)} МВт.{margin < -1e-6 ? ' Пиковая нагрузка с резервом превышает лимит.' : ' По оценке модели лимит соблюдён.'}</p>}
                    <p className="hint">MW пересчитаны из каталога для показанных физических машин и заданных частот. Средняя мощность учитывает долю времени работы; пик предполагает одновременную работу всех необходимых машин на максимумах рецептов. Простои standby, пуски, накопители и фазовые сдвиги не моделируются.</p>
                    <p className="hint">Неизвестная энергия внешних поставок не включена; заданная стоимость импорта учтена. Запас относится только к учтённой фабрике; резерв не заменяет динамическую симуляцию сети.</p>{model.externalSources.map(source => <p key={source.sourceId}>{source.power === null ? 'Вне энергетической границы' : 'Учтённый импорт'}: {source.name} — {format(source.rate, 6)} {unit(item(source.itemId))}{source.power !== null && ` · ${format(source.power)} МВт`}.</p>)}
                  </section>
                  <div className="toolbar-actions" role="group" aria-label="Представление результата"><button className={building ? 'secondary-button' : 'primary-button'} aria-pressed={!building} onClick={() => setBuilding(false)}>Обзор</button><button className={building ? 'primary-button' : 'secondary-button'} aria-pressed={building} onClick={() => setBuilding(true)}>Построить</button></div>
                  <Construction key={model.fingerprint} catalog={catalog} model={model} building={building} destinations={{ products: result.products, exports: result.exports?.map(e => ({ ...e, name: plan.exports?.find(x => x.itemId === e.itemId)?.name })) }} />
                </>}
        {!stale && result.status === 'infeasible' && result.feasibleAlternative && <section className="panel feasible-alternative" aria-labelledby="alternative-title"><div className="section-heading"><div><span className="eyebrow">ОТДЕЛЬНЫЙ РАСЧЁТ</span><h3 id="alternative-title">Достижимый выпуск</h3></div><span className="status-badge stale">{format(result.feasibleAlternative.fraction * 100, 8)}% заказа</span></div><p className="hint">Выполнимая доля исходного заказа при тех же ограничениях. Пропорции продуктов сохранены. Исходный заказ остаётся невыполнимым, его количества в плане не изменены.</p>{result.feasibleAlternative.products.map(product => <div className="output-row" key={product.itemId}><ItemIcon item={item(product.itemId)} size={36} /><div><strong>{item(product.itemId)?.name ?? product.itemId}</strong></div><strong className="output-rate">{format(product.rate, 6)}<small>{unit(item(product.itemId))}</small></strong></div>)}<div className="simple-row"><span>Средняя мощность альтернативы</span><strong>{format(result.feasibleAlternative.power)} МВт</strong></div>{!!result.feasibleAlternative.bottlenecks.length && <div className="alternative-bottlenecks"><h4>Ограничивающие факторы</h4><ul>{result.feasibleAlternative.bottlenecks.map((bottleneck, index) => <li key={index}>{bottleneck}</li>)}</ul></div>}</section>}
        {!stale && !!result.warnings.length && <div className="alert warning"><Info size={18} /><div>{result.warnings.map(w => <p key={w}>{w}</p>)}</div></div>}
        <details className="diagnostics"><summary>Диагностика {stale ? 'предыдущего ' : ''}расчёта</summary><p>Статус решателя: {statusLabels[result.status]}</p><p>{result.message}</p><p>Максимальная ошибка баланса: {result.maxBalanceError.toExponential(3)}</p>{result.diagnostics.map((d, i) => <p key={i}>{d}</p>)}</details>
      </div>}
    {!stale && hasSolution(result) && <><BatchResult catalog={catalog} plan={plan} result={result} /><section className="panel"><p>Somersloops занято: {result.somersloops ?? 0} / {plan.somersloopBudget ?? 0}</p>{result.exports?.map(e => <p key={e.itemId}>Отгрузка: {item(e.itemId)?.name} — {format(e.rate)} {unit(item(e.itemId))} · {plan.exports?.find(x => x.itemId === e.itemId)?.name}</p>)}</section></>}<CatalogStatus catalog={catalog} />
    <p className="result-footnote"><Info size={14} />Стационарная модель средних потоков · заданные частоты · конечный бюджет усилителей</p>
  </div>;
}
