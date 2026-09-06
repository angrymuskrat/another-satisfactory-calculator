import { useCallback, useEffect, useRef, useState } from 'react';
import type { Catalog, Plan, Result } from '../../../packages/domain/types';
export function useSolver(catalog: Catalog, plan: Plan) {
  const [result, setResult] = useState<Result | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [solvedInput, setSolvedInput] = useState('');
  const worker = useRef<Worker | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fingerprint = JSON.stringify(plan);
  const stop = useCallback(() => {
    worker.current?.terminate(); worker.current = null;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => () => stop(), [stop]);
  const calculate = useCallback(() => {
    stop(); setRunning(true); setError(null);
    try {
      const instance = new Worker(new URL('./solver.worker.ts', import.meta.url), { type: 'module' });
      worker.current = instance;
      instance.onmessage = (event: MessageEvent<Result>) => {
        if (worker.current !== instance) return;
        setResult(event.data); setSolvedInput(fingerprint); setRunning(false); stop();
      };
      instance.onerror = event => {
        if (worker.current !== instance) return;
        setError(event.message || 'Не удалось загрузить решатель. Обновите страницу.'); setRunning(false); stop();
      };
      timer.current = setTimeout(() => { setError('Расчёт остановлен по времени. Уменьшите количество альтернатив или целей.'); setRunning(false); stop(); }, 30000);
      instance.postMessage({ catalog, plan });
    } catch (error) { setError(error instanceof Error ? error.message : 'Ошибка запуска расчёта.'); setRunning(false); stop(); }
  }, [catalog, plan, fingerprint, stop]);
  const cancel = useCallback(() => { stop(); setRunning(false); setError('Расчёт отменён.'); }, [stop]);
  return { result, running, error, stale: result !== null && fingerprint !== solvedInput, calculate, cancel };
}
