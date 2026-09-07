import type { Plan } from './types';
import type { Workspace } from './worlds';
import { parsePlan } from './validation';

export const legacyPlanMessage = 'План использует прежнюю цель расчёта. Создайте новый план с ровной нагрузкой.';
export const legacyCleanupMessage = 'Старые планы с прежними целями удалены. Миры и новые планы сохранены. Можно создать новый план с ровной нагрузкой.';
export function requirePlannerObjective(plan: Plan): Plan {
  if (plan.settings.objective !== 'smooth-power') throw new Error(legacyPlanMessage);
  return plan;
}
export function parsePlannerPlan(value: unknown): Plan {
  return requirePlannerObjective(parsePlan(value));
}
export function removeLegacyFactories(workspace: Workspace) {
  const factories = workspace.factories.filter(f => f.plan.settings.objective === 'smooth-power');
  return { workspace: { ...workspace, factories }, removed: workspace.factories.length - factories.length };
}
