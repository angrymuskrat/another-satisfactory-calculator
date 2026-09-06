/// <reference lib="webworker" />
import loadHighs from '../../../packages/solver/vendor/highs.mjs';
import { analyze, type AnalysisRequest, type AnalysisReport } from '../../../packages/solver/analysis';
import type { Catalog, Plan } from '../../../packages/domain/types';

export type AnalysisResponse = { report: AnalysisReport } | { error: string };
const highs = loadHighs({ locateFile: () => new URL('/solver/highs.wasm', self.location.origin).href });
self.onmessage = async (event: MessageEvent<{ catalog: Catalog; plan: Plan; request: AnalysisRequest }>) => {
  const deadline = performance.now() + 20000;
  try {
    const { catalog, plan, request } = event.data;
    self.postMessage({ report: analyze(catalog, plan, await highs, request, deadline) } satisfies AnalysisResponse);
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Ошибка загрузки анализа.' } satisfies AnalysisResponse);
  }
};
