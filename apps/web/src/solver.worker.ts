/// <reference lib="webworker" />
import loadHighs from '../../../packages/solver/vendor/highs.mjs';
import { emptyResult } from '../../../packages/solver/solve';
import { solveVariants, type VariantsMessage } from '../../../packages/solver/variants';
import { solvePareto } from '../../../packages/solver/pareto';
import type { Catalog, Plan, ProductionVariants } from '../../../packages/domain/types';
const highs = loadHighs({ locateFile: () => new URL('/solver/highs.wasm', self.location.origin).href });
self.onmessage = async (event: MessageEvent<{ catalog: Catalog; plan: Plan; previous?: ProductionVariants; requestId: string }>) => {
  const post = (message: Omit<VariantsMessage, 'requestId'>) => self.postMessage({ ...message, requestId: event.data.requestId } satisfies VariantsMessage);
  try {
    const { catalog, plan, previous } = event.data;
    const engine = await highs;
    const report = (plan.settings.pareto && (plan.mode === 'target' || plan.batch))
      ? solvePareto(catalog, plan, engine, performance.now() + 60000, partial => post({ report: partial, pending: [], done: false }), previous)
      : solveVariants(catalog, plan, engine, performance.now() + 25000, (partial, pending) => { if (pending.length) post({ report: partial, pending, done: false }); });
    post({ report, pending: [], done: true });
  }
  catch (error) { post({ report: { equivalent: false, variants: [{ id: 'maximum', label: 'Расчёт недоступен', plan: event.data.plan, result: emptyResult('error', error instanceof Error ? error.message : 'Ошибка загрузки решателя.') }] }, pending: [], done: true }); }
};
