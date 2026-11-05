/// <reference lib="webworker" />
import loadHighs from '../../../packages/solver/vendor/highs.mjs';
import { emptyResult } from '../../../packages/solver/solve';
import { solveVariants } from '../../../packages/solver/variants';
import { solvePareto } from '../../../packages/solver/pareto';
import type { Catalog, Plan, ProductionVariants } from '../../../packages/domain/types';
const highs = loadHighs({ locateFile: () => new URL('/solver/highs.wasm', self.location.origin).href });
self.onmessage = async (event: MessageEvent<{ catalog: Catalog; plan: Plan; previous?: ProductionVariants; requestId: string }>) => {
  try {
    const { catalog, plan, previous, requestId } = event.data;
    const engine = await highs;
    if (plan.settings.pareto && (plan.mode === 'target' || plan.batch)) {
      const report = solvePareto(catalog, plan, engine, performance.now() + 60000, report => self.postMessage({ report, requestId, partial: true }), previous);
      self.postMessage({ report, requestId, partial: false });
    } else self.postMessage(solveVariants(catalog, plan, engine, performance.now() + 25000));
  }
  catch (error) { self.postMessage({ equivalent: false, variants: [{ id: 'maximum', label: 'Расчёт недоступен', plan: event.data.plan, result: emptyResult('error', error instanceof Error ? error.message : 'Ошибка загрузки решателя.') }] }); }
};
