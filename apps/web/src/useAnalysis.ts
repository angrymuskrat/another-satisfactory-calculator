import { useCallback, useEffect, useRef, useState } from 'react';
import type { Catalog, Plan } from '../../../packages/domain/types';
import type { AnalysisReport, AnalysisRequest } from '../../../packages/solver/analysis';
import type { AnalysisResponse } from './analysis.worker';
import { useT } from './i18n';

export function useAnalysis(catalog: Catalog, plan: Plan) {
  const t = useT();
  const fingerprint = JSON.stringify({ catalog, plan });
  const [state, setState] = useState<{ fingerprint: string; report: AnalysisReport | null; running: boolean; error: string | null }>({ fingerprint, report: null, running: false, error: null });
  const worker = useRef<Worker | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stop = useCallback(() => {
    worker.current?.terminate(); worker.current = null;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => {
    stop(); setState({ fingerprint, report: null, running: false, error: null });
    return stop;
  }, [fingerprint, stop]);
  const cancel = useCallback(() => {
    stop(); setState({ fingerprint, report: null, running: false, error: t.useAnalysis.cancelled });
  }, [fingerprint, stop, t]);
  const calculate = useCallback((request: AnalysisRequest) => {
    stop(); setState({ fingerprint, report: null, running: true, error: null });
    const fail = (error: string) => { stop(); setState({ fingerprint, report: null, running: false, error }); };
    try {
      const instance = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' });
      worker.current = instance;
      instance.onmessage = (event: MessageEvent<AnalysisResponse>) => {
        if (worker.current !== instance) return;
        stop();
        setState({ fingerprint, report: 'report' in event.data ? event.data.report : null, running: false, error: 'error' in event.data ? event.data.error : 'errorKey' in event.data ? t.analysisWorker[event.data.errorKey] : null });
      };
      instance.onerror = event => { if (worker.current === instance) fail(event.message || t.useAnalysis.loadFailed); };
      instance.onmessageerror = () => { if (worker.current === instance) fail(t.useAnalysis.unreadable); };
      timer.current = setTimeout(() => { if (worker.current === instance) fail(t.useAnalysis.timeout); }, request.kind === 'alternates' || request.kind === 'residues' ? 60000 : 25000);
      instance.postMessage({ catalog, plan, request });
    } catch (error) { fail(error instanceof Error ? error.message : t.useAnalysis.startFailed); }
  }, [catalog, plan, fingerprint, stop, t]);
  // Hide stale data on the first render, before the effect terminates the old worker.
  return { report: state.fingerprint === fingerprint ? state.report : null, running: state.fingerprint === fingerprint && state.running,
    error: state.fingerprint === fingerprint ? state.error : null, calculate, cancel };
}
