import type { Catalog, Plan } from '../../../packages/domain/types';
import { effectivePlan } from '../../../packages/domain/availability';
import { format } from './controls';

export function ConstraintSummary({ catalog, plan }: { catalog: Catalog; plan: Plan }) {
  let active: Plan;
  try { active = effectivePlan(catalog, plan); } catch (error) { return <p className="alert error" role="alert">{error instanceof Error ? error.message : 'Проверьте технологии мира.'}</p>; }
  const s = active.settings;
  const recipes = catalog.recipes.filter(r => s.enabledRecipeIds.includes(r.id) && s.enabledBuildingIds.includes(r.buildingId)).length;
  const order = s.objective === 'smooth-power' ? 'здания → энергия с подбором частот → условная стоимость сырья' : s.objective === 'buildings' ? 'здания → энергия → условная стоимость сырья' : s.objective === 'power' ? 'энергия → условная стоимость сырья' : 'условная стоимость сырья → энергия';
  return <aside className="constraint-summary" aria-label="Активные ограничения">
    <strong>{plan.batch ? `Партия за ${format(plan.batch.minutes)} мин` : plan.mode === 'maximize' ? 'Максимум выпуска' : 'Заданный заказ'} → {order}</strong>
    <p>Рецептов: {recipes} / {catalog.recipes.length} · типов зданий: {s.enabledBuildingIds.length} · {catalog.belts.find(b => b.id === s.beltId)?.name} · {catalog.pipes.find(p => p.id === s.pipeId)?.name} · {s.objective === 'smooth-power' ? 'предел частоты' : 'частота'} {format(s.clock)}%</p>
    <p>Средняя мощность: {s.powerLimit === null ? 'без лимита' : format(s.powerLimit) + ' МВт'} · максимум: {s.peakPowerLimit == null ? 'без лимита' : format(s.peakPowerLimit) + ' МВт'} · резерв: {format(s.powerReserve ?? 0)} МВт. Добыча и утилизация включены; неизвестная энергия внешних потоков исключена.</p>
    {(plan.lines?.length || plan.somersloopBudget) ? <p>Существующих линий: {plan.lines?.length ?? 0} · Somersloops: {plan.somersloopBudget ?? 0} · {plan.expansion === 'keep' ? 'оставить' : plan.expansion === 'rebuild' ? 'перестроить' : 'сохранить и добавить'}.</p> : null}
    {Object.keys(s.buildingLimits ?? {}).length > 0 && <p>Лимиты зданий: {Object.entries(s.buildingLimits!).map(([id, count]) => `${catalog.buildings.find(b => b.id === id)?.name ?? catalog.miners.find(m => m.id === id)?.name ?? id}: ${count}`).join(' · ')}</p>}
    {!plan.batch && plan.mode === 'maximize' && s.outputSlack > 0 && <p>Допустимая потеря выпуска: {format(s.outputSlack)}%; минимумы продуктов остаются обязательными.</p>}
  </aside>;
}
