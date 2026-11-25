import { useCallback, useEffect, useRef, useState } from 'react';
import type { Catalog, Plan } from '../../../packages/domain/types';
import { hasSolution } from '../../../packages/domain/types';
import type { ProductionVariants, ProductionVariant, VariantsMessage } from '../../../packages/solver/variants';
import { searchDuration } from '../../../packages/domain/searchDuration';
export function useSolver(catalog: Catalog, plan: Plan, kind: 'variants' | 'order' = 'variants') {
  const [report, setReport] = useState<ProductionVariants | null>(null);
  const [pending, setPending] = useState<ProductionVariant['id'][]>([]);
  const [selected, setSelected] = useState<ProductionVariant | null>(null);
  const [baseline, setBaseline] = useState<ProductionVariant | null>(null);
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
  // Снимок, принятый до конца расчёта: остальные варианты того же запроса дорешиваются.
  const acceptedInput = useRef<string | null>(null);
  const live = (input: string) => input === requestInput.current || input === acceptedInput.current;
  const stop = useCallback(() => {
    worker.current?.terminate(); worker.current = null;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => () => stop(), [stop]);
  useEffect(() => {
    if (worker.current && !live(fingerprint)) {
      stop(); setRunning(false); setError('Настройки изменились. Запустите подбор вариантов заново.');
    }
  }, [fingerprint, stop]);
  const calculate = useCallback((continueSearch = false) => {
    const previous = continueSearch && fingerprint === solvedInput ? report ?? undefined : undefined;
    if (selected) setBaseline(structuredClone(selected));
    stop(); setRunning(true); setError(null);
    if (!previous) { setReport(null); setPending([]); }
    setSelected(null); setChoosing(true);
    const requestId = crypto.randomUUID();
    requestInput.current = fingerprint; acceptedInput.current = null;
    try {
      const instance = new Worker(new URL('./solver.worker.ts', import.meta.url), { type: 'module' });
      worker.current = instance;
      instance.onmessage = (event: MessageEvent<VariantsMessage>) => {
        if (worker.current !== instance) return;
        if (event.data.requestId !== requestId) return;
        if (!live(currentInput.current)) { setError('Настройки изменились. Запустите подбор вариантов заново.'); setRunning(false); stop(); return; }
        setReport(event.data.report); setPending(event.data.pending);
        if (event.data.error) setError(event.data.error);
        if (acceptedInput.current === null) setSolvedInput(fingerprint);
        if (event.data.done) { setRunning(false); stop(); }
      };
      instance.onerror = event => {
        if (worker.current !== instance) return;
        setError(event.message || 'Не удалось загрузить решатель. Обновите страницу.'); setRunning(false); stop();
      };
      timer.current = setTimeout(() => { setError('Расчёт остановлен по времени. Проверенные варианты сохранены.'); setRunning(false); stop(); }, searchDuration(plan, previous) + 5000);
      instance.postMessage({ kind, catalog, plan, previous, requestId });
    } catch (error) { setError(error instanceof Error ? error.message : 'Ошибка запуска расчёта.'); setRunning(false); stop(); }
  }, [catalog, plan, kind, fingerprint, stop, report, selected, solvedInput]);
  const cancel = useCallback(() => { stop(); setRunning(false); setError('Расчёт отменён.'); }, [stop]);
  const stale = report !== null && fingerprint !== solvedInput;
  const choose = (id: ProductionVariant['id']): Plan | null => {
    if (currentInput.current !== solvedInput) return null;
    const variant = report?.variants.find(v => v.id === id) ?? report?.workingPlans?.find(v => v.id === id);
    if (!variant || !hasSolution(variant.result)) return null;
    const next = structuredClone(variant);
    const input = JSON.stringify(next.plan);
    if (running) acceptedInput.current = input;
    setSelected(next); setChoosing(false); setSolvedInput(input);
    return next.plan;
  };
  const failure = !running && !report?.workingPlans?.length && report?.variants.every(v => !hasSolution(v.result)) ? report.variants[0] : null;
  return { report, pending, selected, baseline, choosing, result: selected?.result ?? failure?.result ?? null,
    running, error, stale, calculate, cancel, choose, showChoices: () => setChoosing(true) };
}
