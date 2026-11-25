/// <reference lib="webworker" />
import loadHighs from '../../../packages/solver/vendor/highs.mjs';
import { emptyResult } from '../../../packages/solver/solve';
import { solveVariants, type VariantsMessage } from '../../../packages/solver/variants';
import { searchDuration } from '../../../packages/domain/searchDuration';
import { attachSupplyDiagnosis } from '../../../packages/solver/diagnoseSupply';
import type { Catalog, Plan, ProductionVariants } from '../../../packages/domain/types';
const highs = loadHighs({ locateFile: () => new URL('/solver/highs.wasm', self.location.origin).href });
self.onmessage = async (event: MessageEvent<{ catalog: Catalog; plan: Plan; previous?: ProductionVariants; requestId: string }>) => {
  let latest: Omit<VariantsMessage, 'requestId'> | undefined;
  const post = (message: Omit<VariantsMessage, 'requestId'>) => {
    latest = message;
    self.postMessage({ ...message, requestId: event.data.requestId } satisfies VariantsMessage);
  };
  try {
    const { catalog, plan, previous } = event.data;
    const engine = await highs;
    const deadline = performance.now() + searchDuration(plan, previous);
    const report = solveVariants(catalog, plan, engine, deadline, (partial, pending) => {
      if (partial.pareto || pending.length) post({ report: partial, pending, done: false });
    }, previous);
    attachSupplyDiagnosis(catalog, plan, engine, report);
    post({ report, pending: [], done: true });
  }
  catch (error) {
    const message = error instanceof Error ? error.message : 'Ошибка загрузки решателя.';
    if (latest) post({ ...latest, done: true, error: message });
    else post({ report: { equivalent: false, variants: [{ id: 'maximum', label: 'Расчёт недоступен', plan: event.data.plan, result: emptyResult('error', message) }] }, pending: [], done: true });
  }
};
