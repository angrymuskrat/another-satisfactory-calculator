/// <reference lib="webworker" />
import loadHighs from '../../../packages/solver/vendor/highs.mjs';
import { emptyResult, solve } from '../../../packages/solver/solve';
import { solveVariants, type VariantsMessage } from '../../../packages/solver/variants';
import { searchDuration, usesPareto } from '../../../packages/domain/searchDuration';
import { attachSupplyDiagnosis } from '../../../packages/solver/diagnoseSupply';
import type { Catalog, Plan, ProductionVariants } from '../../../packages/domain/types';
export type SolverWorkerKey = 'orderLabel' | 'unavailableLabel' | 'loadFailed';
/** Тексты воркера приходят ключами: пакет языка подставляет принимающий хук. */
export type SolverMessage = VariantsMessage & { labelKeys?: Record<string, SolverWorkerKey>; resultKeys?: Record<string, SolverWorkerKey>; errorKey?: SolverWorkerKey };
const highs = loadHighs({ locateFile: () => new URL('/solver/highs.wasm', self.location.origin).href });
self.onmessage = async (event: MessageEvent<{ kind?: 'variants' | 'order'; catalog: Catalog; plan: Plan; previous?: ProductionVariants; requestId: string }>) => {
  let latest: Omit<SolverMessage, 'requestId'> | undefined;
  const post = (message: Omit<SolverMessage, 'requestId'>) => {
    latest = message;
    self.postMessage({ ...message, requestId: event.data.requestId } satisfies SolverMessage);
  };
  try {
    const { kind, catalog, plan, previous } = event.data;
    const engine = await highs;
    const deadline = performance.now() + searchDuration(plan, previous);
    let report: ProductionVariants;
    let labelKeys: SolverMessage['labelKeys'];
    if (kind === 'order' && !usesPareto(plan)) {
      const result = solve(catalog, plan, engine, deadline, { retainOnTimeout: true });
      report = { variants: [{ id: 'order', label: '', plan, result }], equivalent: false };
      labelKeys = { order: 'orderLabel' };
    } else {
      report = solveVariants(catalog, plan, engine, deadline, (partial, pending) => {
        if (partial.pareto || pending.length) post({ report: partial, pending, done: false });
      }, previous);
    }
    if (kind !== 'order') attachSupplyDiagnosis(catalog, plan, engine, report);
    post({ report, pending: [], done: true, labelKeys });
  }
  catch (error) {
    const failure = error instanceof Error ? { message: error.message, key: undefined } : { message: '', key: 'loadFailed' as const };
    if (latest) post({ ...latest, done: true, error: failure.message, errorKey: failure.key });
    else post({ report: { equivalent: false, variants: [{ id: 'maximum', label: '', plan: event.data.plan, result: emptyResult('error', failure.message) }] }, pending: [], done: true, labelKeys: { maximum: 'unavailableLabel' }, resultKeys: failure.key && { maximum: failure.key } });
  }
};
