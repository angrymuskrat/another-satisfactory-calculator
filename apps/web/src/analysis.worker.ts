/// <reference lib="webworker" />
import loadHighs from '../../../packages/solver/vendor/highs.mjs';
import { analyze, type AnalysisRequest, type AnalysisReport } from '../../../packages/solver/analysis';
import type { Catalog, Plan } from '../../../packages/domain/types';

export type AnalysisWorkerKey = 'loadFailed';
export type AnalysisResponse = { report: AnalysisReport } | { error: string } | { errorKey: AnalysisWorkerKey };
const highs = loadHighs({ locateFile: () => new URL('/solver/highs.wasm', self.location.origin).href });
self.onmessage = async (event: MessageEvent<{ catalog: Catalog; plan: Plan; request: AnalysisRequest }>) => {
  const deadline = performance.now() + (['alternates', 'residues'].includes(event.data.request.kind) ? 55000 : 20000);
  try {
    const { catalog, plan, request } = event.data;
    self.postMessage({ report: analyze(catalog, plan, await highs, request, deadline) } satisfies AnalysisResponse);
  } catch (error) {
    self.postMessage((error instanceof Error ? { error: error.message } : { errorKey: 'loadFailed' }) satisfies AnalysisResponse);
  }
};
