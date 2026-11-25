import type { Plan, ProductionVariants } from './types';
export const variantDuration = (previous?: ProductionVariants) => previous ? Math.min(120000, 25000 * 2 ** (previous.pass ?? 1)) : 25000;

export const usesPareto = (plan: Plan) => !!plan.settings.pareto && (plan.mode === 'target' || !!plan.batch);
export const searchDuration = (plan: Plan, previous?: ProductionVariants) => usesPareto(plan) ? 60000 : variantDuration(previous);
