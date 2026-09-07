import { useCallback, useEffect, useRef, useState } from 'react';
import type { Catalog, Plan } from '../../../packages/domain/types';
import { hasSolution } from '../../../packages/domain/types';
import type { ProductionVariants, ProductionVariant } from '../../../packages/solver/variants';
export function useSolver(catalog: Catalog, plan: Plan) {
  const [report, setReport] = useState<ProductionVariants | null>(null);
  const [selected, setSelected] = useState<ProductionVariant | null>(null);
  const [choosing, setChoosing] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [solvedInput, setSolvedInput] = useState('');
  const worker = useRef<Worker | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fingerprint = JSON.stringify(plan);
  const currentInput = useRef(fingerprint);
  currentInput.current = fingerprint;
  const requestInput = useRef('');
  const stop = useCallback(() => {
    worker.current?.terminate(); worker.current = null;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => () => stop(), [stop]);
  useEffect(() => {
    if (worker.current && requestInput.current !== fingerprint) {
      stop(); setRunning(false); setError('Настройки изменились. Запустите подбор вариантов заново.');
    }
  }, [fingerprint, stop]);
  const calculate = useCallback(() => {
    stop(); setRunning(true); setError(null); setReport(null); setSelected(null); setChoosing(true);
    requestInput.current = fingerprint;
    try {
      const instance = new Worker(new URL('./solver.worker.ts', import.meta.url), { type: 'module' });
      worker.current = instance;
      instance.onmessage = (event: MessageEvent<ProductionVariants>) => {
        if (worker.current !== instance) return;
        if (currentInput.current !== fingerprint) { setError('Настройки изменились. Запустите подбор вариантов заново.'); }
        else { setReport(event.data); setSolvedInput(fingerprint); }
        setRunning(false); stop();
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
  const stale = report !== null && fingerprint !== solvedInput;
  const choose = (id: ProductionVariant['id']): Plan | null => {
    if (running || currentInput.current !== solvedInput) return null;
    const variant = report?.variants.find(v => v.id === id);
    if (!variant || !hasSolution(variant.result)) return null;
    const next = structuredClone(variant);
    setSelected(next); setChoosing(false); setSolvedInput(JSON.stringify(next.plan));
    return next.plan;
  };
  const failure = report?.variants.every(v => !hasSolution(v.result)) ? report.variants[0] : null;
  return { report, selected, choosing, result: selected?.result ?? failure?.result ?? null,
    running, error, stale, calculate, cancel, choose, showChoices: () => setChoosing(true) };
}
