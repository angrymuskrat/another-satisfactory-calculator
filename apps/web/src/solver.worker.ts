/// <reference lib="webworker" />
import loadHighs from '../../../packages/solver/vendor/highs.mjs';
import { emptyResult } from '../../../packages/solver/solve';
import { solveVariants } from '../../../packages/solver/variants';
import type { Catalog, Plan } from '../../../packages/domain/types';
const highs = loadHighs({ locateFile: () => new URL('/solver/highs.wasm', self.location.origin).href });
self.onmessage = async (event: MessageEvent<{ catalog: Catalog; plan: Plan }>) => {
  try { self.postMessage(solveVariants(event.data.catalog, event.data.plan, await highs, performance.now() + 25000)); }
  catch (error) { self.postMessage({ equivalent: false, variants: [{ id: 'maximum', label: 'Расчёт недоступен', plan: event.data.plan, result: emptyResult('error', error instanceof Error ? error.message : 'Ошибка загрузки решателя.') }] }); }
};
