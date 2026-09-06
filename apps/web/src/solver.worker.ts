/// <reference lib="webworker" />
import loadHighs from '../../../packages/solver/vendor/highs.mjs';
import { emptyResult, solve } from '../../../packages/solver/solve';
import type { Catalog, Plan } from '../../../packages/domain/types';
const highs = loadHighs({ locateFile: () => new URL('/solver/highs.wasm', self.location.origin).href });
self.onmessage = async (event: MessageEvent<{ catalog: Catalog; plan: Plan }>) => {
  try { self.postMessage(solve(event.data.catalog, event.data.plan, await highs)); }
  catch (error) { self.postMessage(emptyResult('error', error instanceof Error ? error.message : 'Ошибка загрузки решателя.')); }
};
