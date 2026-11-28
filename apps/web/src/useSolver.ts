import { useCallback, useEffect, useRef, useState } from 'react';
import type { Catalog, Plan } from '../../../packages/domain/types';
import { hasSolution } from '../../../packages/domain/types';
import type { ProductionVariants, ProductionVariant } from '../../../packages/solver/variants';
import { searchDuration } from '../../../packages/domain/searchDuration';
import type { SolverMessage } from './solver.worker';
import { useT, type Messages } from './i18n';
function localize(message: SolverMessage, t: Messages): ProductionVariants {
  const { labelKeys, resultKeys } = message;
  if (!labelKeys && !resultKeys) return message.report;
  return { ...message.report, variants: message.report.variants.map(variant => {
    const labelKey = labelKeys?.[variant.id], resultKey = resultKeys?.[variant.id];
    return { ...variant, label: labelKey ? t.solverWorker[labelKey] : variant.label,
      result: resultKey ? { ...variant.result, message: t.solverWorker[resultKey] } : variant.result };
  }) };
}
export function useSolver(catalog: Catalog, plan: Plan, kind: 'variants' | 'order' = 'variants') {
  const t = useT();
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
      stop(); setRunning(false); setError(t.useSolver.settingsChanged);
    }
  }, [fingerprint, stop, t]);
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
      instance.onmessage = (event: MessageEvent<SolverMessage>) => {
        if (worker.current !== instance) return;
        if (event.data.requestId !== requestId) return;
        if (!live(currentInput.current)) { setError(t.useSolver.settingsChanged); setRunning(false); stop(); return; }
        setReport(localize(event.data, t)); setPending(event.data.pending);
        const failure = event.data.errorKey ? t.solverWorker[event.data.errorKey] : event.data.error;
        if (failure) setError(failure);
        if (acceptedInput.current === null) setSolvedInput(fingerprint);
        if (event.data.done) { setRunning(false); stop(); }
      };
      instance.onerror = event => {
        if (worker.current !== instance) return;
        setError(event.message || t.useSolver.loadFailed); setRunning(false); stop();
      };
      timer.current = setTimeout(() => { setError(t.useSolver.timedOut); setRunning(false); stop(); }, searchDuration(plan, previous) + 5000);
      instance.postMessage({ kind, catalog, plan, previous, requestId });
    } catch (error) { setError(error instanceof Error ? error.message : t.useSolver.startFailed); setRunning(false); stop(); }
  }, [catalog, plan, kind, fingerprint, stop, report, selected, solvedInput, t]);
  const cancel = useCallback(() => { stop(); setRunning(false); setError(t.useSolver.cancelled); }, [stop, t]);
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
  const preview = (id: ProductionVariant['id']) => {
    if (currentInput.current !== solvedInput) return;
    const variant = report?.variants.find(v => v.id === id) ?? report?.workingPlans?.find(v => v.id === id);
    if (!variant || !hasSolution(variant.result)) return;
    setSelected(structuredClone(variant)); setChoosing(false);
  };
  const accepted = selected !== null && fingerprint === JSON.stringify(selected.plan);
  const failure = !running && !report?.workingPlans?.length && report?.variants.every(v => !hasSolution(v.result)) ? report.variants[0] : null;
  return { report, pending, selected, baseline, choosing, result: selected?.result ?? failure?.result ?? null,
    running, error, stale, accepted, calculate, cancel, choose, preview, showChoices: () => setChoosing(true) };
}
