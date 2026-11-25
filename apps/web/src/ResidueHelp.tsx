import { useEffect, useMemo, useRef, useState } from 'react';
import type { Catalog, Plan, ProductResult } from '../../../packages/domain/types';
import { residueCandidates, sinkAvailable, type ResidueContext, type ResidueRoute } from '../../../packages/solver/residues';
import { sourceLabel } from '../../../packages/domain/sourceLabel';
import { format, NumberField, unit } from './controls';
import { useAnalysis } from './useAnalysis';

type Props = { catalog: Catalog; plan: Plan; result: ResidueContext | null; setPlan: (p: Plan) => void };
const signed = (n: number) => (n > 1e-6 ? '+' : '') + format(n, 3);
const statusLabels = { approximate: 'Допустимое приближение', optimal: 'Оптимум модели', infeasible: 'Заказ невыполним', timeout: 'Истекло время', error: 'Ошибка расчёта', unbounded: 'Выпуск не ограничен' };
export const residueHref = (id: string) => '#residue-' + encodeURIComponent(id);

export function ResidueHelp({ catalog, plan, result, setPlan }: Props) {
  const ids = useMemo(() => {
    try { return residueCandidates(catalog, plan, result); }
    catch { return []; } // The calculation already reports an invalid world or plan.
  }, [catalog, plan, result]);
  const [choice, setChoice] = useState('');
  const selector = useRef<HTMLSelectElement>(null);
  const optionsKey = JSON.stringify(ids);
  useEffect(() => {
    const follow = () => {
      const itemId = Array.from(selector.current?.options ?? []).find(option => residueHref(option.value) === location.hash)?.value;
      if (!itemId) return;
      setChoice(itemId);
      selector.current?.focus();
      selector.current?.scrollIntoView({ block: 'center' });
    };
    follow();
    window.addEventListener('hashchange', follow);
    return () => window.removeEventListener('hashchange', follow);
  }, [optionsKey]);
  const id = ids.includes(choice) ? choice : ids[0];
  if (!id || !result) return null;
  return <section className="panel" aria-label="Назначение побочных продуктов">
    <h3>{result.products?.some(p => p.rate > 0) ? 'Куда направить побочный поток?' : 'Что мешает выпуску?'}</h3>
    {!result.products?.some(p => p.rate > 0) && <p>Рецепты цепочки могут давать остаток. Проверьте, позволит ли его отвод или переработка выполнить заказ.</p>}
    <label className="field-label">Побочный продукт<select id={'residue-' + id} ref={selector} value={id} onChange={e => {
      setChoice(e.target.value);
      if (location.hash.startsWith('#residue-')) history.replaceState(history.state, '', residueHref(e.target.value));
    }}>
      {ids.map(key => <option key={key} value={key}>{catalog.items.find(i => i.id === key)?.name ?? key}</option>)}
    </select></label>
    <ResidueOptions key={JSON.stringify([id, plan.exports, result.products])} catalog={catalog} plan={plan} itemId={id} result={result} setPlan={setPlan} />
  </section>;
}

function ResidueOptions({ catalog, plan, itemId, result, setPlan }: Props & { itemId: string }) {
  const item = catalog.items.find(i => i.id === itemId)!;
  const outlet = plan.exports?.find(e => e.itemId === itemId);
  const transport = item.fluid ? catalog.pipes.find(p => p.id === plan.settings.pipeId) : catalog.belts.find(b => b.id === plan.settings.beltId);
  const [limit, setLimit] = useState(outlet?.limit ?? transport?.rate ?? 60);
  const [receiver, setReceiver] = useState(outlet?.name ?? '');
  const [capacity, setCapacity] = useState(0);
  const [reference, setReference] = useState('');
  const [criterion, setCriterion] = useState(plan.settings.objective === 'buildings' || (plan.settings.objective === 'smooth-power' && !plan.settings.pareto && plan.settings.smoothPowerExtraMachines === undefined) ? 'machines' : 'energy');
  const [submitted, setSubmitted] = useState('');
  const analysis = useAnalysis(catalog, plan);
  const request = { kind: 'residues' as const, itemId, limit, receiver, products: result?.products };
  const query = JSON.stringify(request);
  const report = submitted === query ? analysis.report?.residues : null;
  const base = report?.routes.find(r => r.id === reference) ?? report?.routes[0];
  const ranked = report?.routes.filter(r => !r.conditionalReceiver).sort((a, b) => {
    const metric = (route: ResidueRoute) => criterion === 'machines' ? route.machines : criterion === 'energy' ? route.result.power
      : route.result.resources.filter(f => f.itemId === criterion).reduce((sum, f) => sum + f.rate, 0);
    return metric(a) - metric(b);
  }) ?? [];
  const inputs = new Set(ranked.flatMap(r => r.result.resources.filter(f => f.rate > 0).map(f => f.itemId)));
  const discharge = report?.routes.find(r => r.id === 'export')?.result.exports?.find(f => f.itemId === itemId)?.rate;
  const calculate = () => { setSubmitted(query); setReference(''); analysis.calculate(request); };
  const unlock = catalog.unlocks?.find(u => u.buildingIds.includes('awesome-sink'));
  const sink = catalog.buildings.find(b => b.id === 'awesome-sink');
  return <>
    <div className="target-bounds"><label className="field-label">Постоянный получатель<input maxLength={120} value={receiver} placeholder="Для условной проверки можно оставить пустым" onChange={e => setReceiver(e.target.value)} /></label>
      <label className="field-label">Предел отгрузки, {unit(item)}<NumberField label="Предел пробной отгрузки" value={limit} max={1e9} onChange={setLimit} /></label></div>
    <button className="secondary-button" disabled={analysis.running} onClick={calculate}>Подобрать переработку</button>
    {!item.fluid && item.sinkable && sinkAvailable(catalog, plan) && <button className="text-button" disabled={analysis.running} onClick={calculate}>Сравнить с утилизатором</button>}
    {analysis.running && <p role="status">Проверяем назначения на копиях заказа… <button className="text-button" onClick={analysis.cancel}>Отменить проверку</button></p>}
    {analysis.error && <p role="alert">{analysis.error}</p>}
    {report && <>
      <p role="status">{report.complete ? 'Сравнение завершено.' : 'Часть вариантов осталась без решения.'} Проверенных вариантов с одинаковым выпуском: {report.routes.length}.</p>
      {discharge !== undefined && <><p>При отводе {format(discharge, 4)} {unit(item)} ({item.name}) получаем {describeFlows(catalog, report.routes.find(r => r.id === 'export')!.result.products)}.</p>
        <details><summary>Временное накопление остатка</summary><label className="field-label">Свободная вместимость, {item.fluid ? 'м³' : 'шт.'}<NumberField label="Свободная вместимость для остатка" value={capacity} onChange={setCapacity} /></label>
          {capacity > 0 && <p>При таком чистом притоке запас заполнится за {format(capacity / discharge, 2)} мин. Затем для этого выпуска потребуется постоянное назначение остатка.</p>}
          <p>Срок и запас готовой продукции для одного строительства можно задать в режиме «Партия».</p></details></>}
      {ranked.length > 1 && <><label className="field-label">Что экономить при этом выпуске<select value={criterion} onChange={e => setCriterion(e.target.value)}>
        <option value="machines">Физические машины</option><option value="energy">Учтённую энергию</option>
        {[...inputs].map(id => <option key={id} value={id}>{catalog.items.find(i => i.id === id)?.name ?? id}</option>)}</select></label>
        <p>По выбранному критерию среди проверенных подходит «{ranked[0].label}».</p></>}
      {base && <><label className="field-label">С чем сравнить затраты<select value={base.id} onChange={e => setReference(e.target.value)}>
        {report.routes.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select></label>
        {report.routes.map(route => <RouteCard key={route.id} catalog={catalog} input={plan} itemId={itemId} route={route} base={base} setPlan={setPlan} />)}</>}
      {!report.routes.length && <p>Проверенные изменения пока не дали подходящего пути. Проверьте доступность сырья, расходников, технологий и постоянного получателя.</p>}
      {!!report.attempts.length && <details><summary>Остальные проверки ({report.attempts.length})</summary><ul>{report.attempts.map((a, index) => <li key={index}>{a.label} · {statusLabels[a.status]}. {a.message}</li>)}</ul></details>}
      {sink && (report.routes.some(r => r.result.sinkPower > 0) || (item.sinkable && !item.fluid && !sinkAvailable(catalog, plan))) && <details><summary>Доступность и строительство ЧУДО-утилизатора</summary>
        <p>{unlock && `Открытие — ${unlock.kind === 'hub' ? 'HUB ' + unlock.tier + ', ' : ''}${unlock.name}. `}{sink.power} МВт на установку.
        {plan.world && !plan.world.unlockedBuildingIds.includes(sink.id) && ' Здание ещё закрыто в этом мире.'}
        {!plan.world && ' Сверьте доступность здания со своим прогрессом в игре.'}</p>
        <p>{sink.buildCost?.length ? 'На одну установку потребуется ' + sink.buildCost.map(f => `${catalog.items.find(i => i.id === f.itemId)?.name ?? f.itemId} × ${format(f.amount)}`).join(', ') : 'Строительная стоимость неизвестна.'}</p></details>}
    </>}
  </>;
}

function describeFlows(catalog: Catalog, flows: ProductResult[]) {
  return flows.map(f => { const item = catalog.items.find(i => i.id === f.itemId); return `${item?.name ?? f.itemId} ${format(f.rate, 4)} ${unit(item)}`; }).join(', ');
}

function RouteCard({ catalog, input, route, base, itemId, setPlan }: { catalog: Catalog; input: Plan; route: ResidueRoute; base: ResidueRoute; itemId: string; setPlan: (p: Plan) => void }) {
  const r = route.result;
  const resourceIds = [...new Set([...r.resources, ...base.result.resources].filter(f => f.rate > 0).map(f => f.sourceId))];
  const inputItems = [...new Set([...r.resources, ...base.result.resources].filter(f => f.rate > 0).map(f => f.itemId))];
  const totalInput = (variant: ResidueRoute, id: string) => variant.result.resources.reduce((sum, f) => sum + (f.itemId === id ? f.rate : 0), 0);
  const materials = [...new Set([...route.materials.items, ...base.materials.items].map(f => f.itemId))];
  const machines = new Map([...base.equipment, ...route.equipment].map(g => [g.id, g]));
  const changed = JSON.stringify(route.plan) !== JSON.stringify(input);
  const recipeName = (id: string) => catalog.recipes.find(x => x.id === id)?.name ?? id;
  const enabled = route.plan.settings.enabledRecipeIds.filter(id => !input.settings.enabledRecipeIds.includes(id));
  const disabled = input.settings.enabledRecipeIds.filter(id => !route.plan.settings.enabledRecipeIds.includes(id));
  const unknown = resourceIds.map(id => {
    const source = input.sources.find(s => s.id === id);
    const difference = (r.resources.find(f => f.sourceId === id)?.rate ?? 0) - (base.result.resources.find(f => f.sourceId === id)?.rate ?? 0);
    const itemId = (r.resources.find(f => f.sourceId === id) ?? base.result.resources.find(f => f.sourceId === id))!.itemId;
    return { id, itemId, difference, source };
  }).filter(f => (!f.source || (f.source.kind === 'flow' && f.source.importPower == null)) && Math.abs(f.difference) > 1e-6);
  const sameUnknownItem = unknown.length > 0 && unknown.every(f => f.itemId === unknown[0].itemId);
  const unknownRate = sameUnknownItem ? unknown.reduce((sum, f) => sum + f.difference, 0) : 0;
  const unknownLabel = unknown.length === 1 ? sourceLabel(catalog, input, unknown[0].id, unknown[0].itemId)
    : catalog.items.find(i => i.id === unknown[0]?.itemId)?.name;
  const energyDelta = r.power - base.result.power;
  const threshold = Math.abs(unknownRate) > 1e-6 ? -energyDelta * 60 / unknownRate : null;
  const alteredExports = route.plan.exports?.filter(e => {
    const old = input.exports?.find(x => x.itemId === e.itemId);
    return !old || old.limit !== e.limit || old.name !== e.name;
  }) ?? [];
  const receivers = r.steps.filter(s => s.inputs.some(f => f.itemId === itemId && f.rate > 0));
  return <details className="source-card" open><summary>{route.label} · {statusLabels[r.status]}</summary>
    <p>Выпуск — {describeFlows(catalog, r.products)}. На площадке {format(route.localPower, 3)} МВт ({signed(route.localPower - base.localPower)} МВт). С известной энергией поставок {format(r.power, 3)} МВт. Физических машин {route.machines} ({signed(route.machines - base.machines)}).</p>
    {!!receivers.length && <p>Внутреннее потребление — {receivers.map(s => `${recipeName(s.recipeId)}: ${describeFlows(catalog, s.inputs.filter(f => f.itemId === itemId))}`).join(', ')}.</p>}
    {!!r.exports?.length && <p>Отгрузка — {r.exports.map(f => `${route.plan.exports?.find(e => e.itemId === f.itemId)?.name}: ${describeFlows(catalog, [f])}`).join(', ')}.</p>}
    {r.surplus.length > 0 && <p>В ЧУДО-утилизатор — {describeFlows(catalog, r.surplus)}. Установок {Math.round(r.sinkPower / catalog.buildings.find(b => b.id === 'awesome-sink')!.power)}, {format(r.sinkPower)} МВт.</p>}
    <details><summary>Какие машины построить</summary><ul>{[...machines.values()].map(g => {
      const current = route.equipment.find(f => f.id === g.id);
      const difference = (current?.added ?? 0) - (base.equipment.find(f => f.id === g.id)?.added ?? 0);
      const building = catalog.buildings.find(b => b.id === g.buildingId)?.name ?? catalog.miners.find(b => b.id === g.buildingId)?.name ?? g.name;
      return <li key={g.id}>{building}{building !== g.name && ` · ${g.name}`} — построить {current?.added ?? 0} ({signed(difference)}), всего {current?.count ?? 0}{current && `, частота ${format(current.clock)}%`}</li>;
    })}</ul></details>
    <details><summary>Сырьё, расходники и материалы строительства</summary><ul>{inputItems.map(id => {
      const item = catalog.items.find(i => i.id === id);
      const amount = totalInput(route, id);
      return <li key={id}>{item?.name ?? id} — {format(amount, 4)} {unit(item)} ({signed(amount - totalInput(base, id))})</li>;
    })}</ul><p>Материалы на новые здания</p><ul>{materials.map(id => {
      const quantity = route.materials.items.find(f => f.itemId === id)?.amount ?? 0;
      return <li key={id}>{catalog.items.find(i => i.id === id)?.name ?? id} × {format(quantity)} ({signed(quantity - (base.materials.items.find(f => f.itemId === id)?.amount ?? 0))})</li>;
    })}</ul>{!route.materials.complete && <p>Неизвестна стоимость зданий: {route.materials.unknown.map(b => b.name).join(', ')}.</p>}</details>
    {!!unknown.length && <p>Энергия части внешних поставок неизвестна. {threshold !== null && threshold > 0 ?
      `При прочих равных энергозатраты сравняются при ${format(threshold, 2)} МДж на единицу «${unknownLabel}»${unknown.length > 1 ? ' для одинаковой стоимости всех поставок этого предмета' : ''}. Выше этой стоимости выгоднее «${unknownRate > 0 ? base.label : route.label}».`
      : 'Для сравнения полной энергии задайте стоимость меняющихся входов в настройках источников.'}</p>}
    {changed && !route.conditionalReceiver && <details><summary>Изменения настроек перед применением</summary>
      {input.settings.allowSink !== route.plan.settings.allowSink && <p>{route.plan.settings.allowSink ? 'Разрешить ЧУДО-утилизатор.' : 'Выключить утилизацию.'}{route.plan.settings.allowSink && !input.world && ' Применяйте, если здание уже открыто в игре.'}</p>}
      {!!input.settings.processFluidsOnSite !== !!route.plan.settings.processFluidsOnSite && <p>Переработка жидкостей на месте — {route.plan.settings.processFluidsOnSite ? 'включить' : 'выключить'}.</p>}
      {alteredExports.map(e => <p key={e.itemId}>Отгрузка «{e.name}» — предел {e.limit} {unit(catalog.items.find(i => i.id === e.itemId))}.</p>)}
      {enabled.length > 0 && <p>Разрешить рецепты — {enabled.map(recipeName).join(', ')}.</p>}
      {disabled.length > 0 && <p>Выключить рецепты — {disabled.map(recipeName).join(', ')}.</p>}
      <button className="secondary-button" onClick={() => setPlan(route.plan)}>Применить настройки варианта</button>
    </details>}
    {route.conditionalReceiver && <p>Для применения укажите постоянного получателя и повторите проверку.</p>}
  </details>;
}
