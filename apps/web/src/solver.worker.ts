/// <reference lib="webworker" />
import loadHighs from '../../../packages/solver/vendor/highs.mjs';
import { emptyResult } from '../../../packages/solver/solve';
import { solveVariants, type VariantsMessage } from '../../../packages/solver/variants';
import type { Catalog, Plan } from '../../../packages/domain/types';
const highs = loadHighs({ locateFile: () => new URL('/solver/highs.wasm', self.location.origin).href });
const post = (message: VariantsMessage) => self.postMessage(message);
self.onmessage = async (event: MessageEvent<{ catalog: Catalog; plan: Plan }>) => {
  try {
    const report = solveVariants(event.data.catalog, event.data.plan, await highs, performance.now() + 25000, (partial, pending) => { if (pending.length) post({ report: partial, pending, done: false }); });
    post({ report, pending: [], done: true });
  }
  catch (error) { post({ report: { equivalent: false, variants: [{ id: 'maximum', label: 'Расчёт недоступен', plan: event.data.plan, result: emptyResult('error', error instanceof Error ? error.message : 'Ошибка загрузки решателя.') }] }, pending: [], done: true }); }
};
