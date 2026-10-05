import type { Plan, Result } from './types';

export interface BuildComplexity { distinctRecipes: number; intermediateItems: number }

/** KPI простоты строительства по работающим этапам результата; добыча и Sink не входят. */
export function buildComplexity(plan: Pick<Plan, 'targets'>, result: Pick<Result, 'steps'>): BuildComplexity {
  const active = result.steps.filter(step => step.cycles > 0);
  const targets = new Set(plan.targets.map(target => target.itemId));
  const produced = new Set(active.flatMap(step => step.outputs.filter(flow => flow.rate > 0).map(flow => flow.itemId)));
  const consumed = new Set(active.flatMap(step => step.inputs.filter(flow => flow.rate > 0).map(flow => flow.itemId)));
  return {
    distinctRecipes: new Set(active.map(step => step.recipeId)).size,
    intermediateItems: [...produced].filter(id => consumed.has(id) && !targets.has(id)).length,
  };
}

/** Допустимое добавление машин варианта «Проще построить»; при percent > 0 и minimum > 0 — хотя бы одна. */
export const simplerMachineAllowance = (minimum: number, percent: number) => Math.ceil(minimum * percent / 100);
