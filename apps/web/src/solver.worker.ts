/// <reference lib="webworker" />
import loadHighs from '../../../packages/solver/vendor/highs.mjs';
import { emptyResult, solve } from '../../../packages/solver/solve';
import { solveVariants, type VariantsMessage } from '../../../packages/solver/variants';
import { solvePareto } from '../../../packages/solver/pareto';
import { variantDuration } from '../../../packages/domain/searchDuration';
import { attachSupplyDiagnosis } from '../../../packages/solver/diagnoseSupply';
import type { Catalog, Plan, ProductionVariants } from '../../../packages/domain/types';
const highs = loadHighs({ locateFile: () => new URL('/solver/highs.wasm', self.location.origin).href });
self.onmessage = async (event: MessageEvent<{ kind?: 'variants' | 'order'; catalog: Catalog; plan: Plan; previous?: ProductionVariants; requestId: string }>) => {
  let latest: Omit<VariantsMessage, 'requestId'> | undefined;
  const post = (message: Omit<VariantsMessage, 'requestId'>) => {
    latest = message;
    self.postMessage({ ...message, requestId: event.data.requestId } satisfies VariantsMessage);
  };
  try {
    const { kind, catalog, plan, previous } = event.data;
    const engine = await highs;
    let report: ProductionVariants;
    if (plan.settings.pareto && (plan.mode === 'target' || plan.batch)) {
      report = solvePareto(catalog, plan, engine, performance.now() + 60000, partial => post({ report: partial, pending: [], done: false }), previous);
    } else if (kind === 'order') {
      const result = solve(catalog, plan, engine, performance.now() + variantDuration(), { retainOnTimeout: true });
      report = { variants: [{ id: 'order', label: 'Расчёт заказа', plan, result }], equivalent: false };
    } else {
      report = solveVariants(catalog, plan, engine, performance.now() + variantDuration(previous), (partial, pending) => { if (pending.length) post({ report: partial, pending, done: false }); }, previous);
    }
    if (kind !== 'order') attachSupplyDiagnosis(catalog, plan, engine, report);
    post({ report, pending: [], done: true });
  }
  catch (error) {
    const message = error instanceof Error ? error.message : 'Ошибка загрузки решателя.';
    if (latest) post({ ...latest, done: true, error: message });
    else post({ report: { equivalent: false, variants: [{ id: 'maximum', label: 'Расчёт недоступен', plan: event.data.plan, result: emptyResult('error', message) }] }, pending: [], done: true });
  }
};
