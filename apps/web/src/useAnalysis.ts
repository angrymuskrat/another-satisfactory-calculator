import { useCallback, useEffect, useRef, useState } from 'react';
import type { Catalog, Plan } from '../../../packages/domain/types';
import type { AnalysisReport, AnalysisRequest } from '../../../packages/solver/analysis';
import type { AnalysisResponse } from './analysis.worker';

export function useAnalysis(catalog: Catalog, plan: Plan) {
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
    stop(); setState({ fingerprint, report: null, running: false, error: 'Анализ отменён.' });
  }, [fingerprint, stop]);
  const calculate = useCallback((request: AnalysisRequest) => {
    stop(); setState({ fingerprint, report: null, running: true, error: null });
    const fail = (error: string) => { stop(); setState({ fingerprint, report: null, running: false, error }); };
    try {
      const instance = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' });
      worker.current = instance;
      instance.onmessage = (event: MessageEvent<AnalysisResponse>) => {
        if (worker.current !== instance) return;
        stop();
        setState({ fingerprint, report: 'report' in event.data ? event.data.report : null, running: false, error: 'error' in event.data ? event.data.error : null });
      };
      instance.onerror = event => { if (worker.current === instance) fail(event.message || 'Не удалось загрузить анализ.'); };
      instance.onmessageerror = () => { if (worker.current === instance) fail('Не удалось прочитать результат анализа.'); };
      timer.current = setTimeout(() => { if (worker.current === instance) fail('Анализ остановлен по времени. Выберите меньше изменений.'); }, 25000);
      instance.postMessage({ catalog, plan, request });
    } catch (error) { fail(error instanceof Error ? error.message : 'Ошибка запуска анализа.'); }
  }, [catalog, plan, fingerprint, stop]);
  // Hide stale data on the first render, before the effect terminates the old worker.
  return { report: state.fingerprint === fingerprint ? state.report : null, running: state.fingerprint === fingerprint && state.running,
    error: state.fingerprint === fingerprint ? state.error : null, calculate, cancel };
}
