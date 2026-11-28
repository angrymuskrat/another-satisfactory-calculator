import type { Catalog, Plan } from '../../../packages/domain/types';
import { effectivePlan } from '../../../packages/domain/availability';
import { format } from './controls';
import { useT } from './i18n';
import { gameName } from './i18n/gameNames';

export function ConstraintSummary({ catalog, plan }: { catalog: Catalog; plan: Plan }) {
  const t = useT();
  let active: Plan;
  try { active = effectivePlan(catalog, plan); } catch (error) { return <p className="alert error" role="alert">{error instanceof Error ? error.message : t.constraintSummary.checkTechnologies}</p>; }
  const s = active.settings;
  const transportName = (kind: 'belt' | 'pipe', id: string) => {
    const found = (kind === 'belt' ? catalog.belts : catalog.pipes).find(entry => entry.id === id);
    return found ? gameName(kind, found.id, found.name) : undefined;
  };
  const buildingName = (id: string) => {
    const building = catalog.buildings.find(b => b.id === id);
    if (building) return gameName('building', building.id, building.name);
    const miner = catalog.miners.find(m => m.id === id);
    return miner ? gameName('miner', miner.id, miner.name) : id;
  };
  const recipes = catalog.recipes.filter(r => s.enabledRecipeIds.includes(r.id) && s.enabledBuildingIds.includes(r.buildingId)).length;
  const order = s.pareto && (plan.mode === 'target' || plan.batch) ? t.constraintSummary.orderPareto : s.objective === 'smooth-power' ? s.recipesFirst ? t.constraintSummary.orderRecipesFirst(s.recipesFirst.extraPercent) : s.resourcesFirst ? t.constraintSummary.orderResourcesFirst : s.smoothPowerExtraMachines !== undefined ? t.constraintSummary.orderSmoothBudget(s.smoothPowerExtraMachines) : t.constraintSummary.orderSmooth : s.objective === 'buildings' ? t.constraintSummary.orderBuildings : s.objective === 'power' ? t.constraintSummary.orderPower : t.constraintSummary.orderResources;
  return <aside className="constraint-summary" aria-label={t.constraintSummary.label}>
    <strong>{plan.batch ? t.constraintSummary.batchIn(format(plan.batch.minutes)) : plan.mode === 'maximize' ? t.constraintSummary.maximize : t.constraintSummary.fixedOrder} → {order}</strong>
    <p>{t.constraintSummary.counts(recipes, catalog.recipes.length, s.enabledBuildingIds.length)} · {transportName('belt', s.beltId)} · {transportName('pipe', s.pipeId)} · {s.objective === 'smooth-power' ? t.constraintSummary.clockLimit : t.constraintSummary.clock} {format(s.clock)}%</p>
    <p>{t.constraintSummary.power(s.powerLimit === null ? t.constraintSummary.noLimit : t.constraintSummary.mw(format(s.powerLimit)), s.peakPowerLimit == null ? t.constraintSummary.noLimit : t.constraintSummary.mw(format(s.peakPowerLimit)), format(s.powerReserve ?? 0))}</p>
    {(plan.lines?.length || plan.somersloopBudget) ? <p>{t.constraintSummary.lines(plan.lines?.length ?? 0, plan.somersloopBudget ?? 0, plan.expansion === 'keep' ? t.constraintSummary.expansionKeep : plan.expansion === 'rebuild' ? t.constraintSummary.expansionRebuild : t.constraintSummary.expansionAdd)}</p> : null}
    {Object.keys(s.buildingLimits ?? {}).length > 0 && <p>{t.constraintSummary.buildingLimits(Object.entries(s.buildingLimits!).map(([id, count]) => `${buildingName(id)}: ${count}`).join(' · '))}</p>}
    {!plan.batch && plan.mode === 'maximize' && s.outputSlack > 0 && <p>{t.constraintSummary.outputLoss(format(s.outputSlack))}</p>}
  </aside>;
}
