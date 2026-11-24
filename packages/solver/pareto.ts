import type { Catalog, Plan, ProductionVariants, Result } from '../domain/types';
import { hasSolution } from '../domain/types';
import { parsePlan } from '../domain/validation';
import { solve, emptyResult, type SolveOptions } from './solve';

type Metrics = Pick<Result, 'power'> & { resources: { itemId: string; rate: number }[] };
export function coordinates(result: Metrics): Record<string, number> {
  const vector: Record<string, number> = { power: result.power };
  for (const r of result.resources) vector[r.itemId] = (vector[r.itemId] ?? 0) + r.rate;
  return vector;
}
// Relative tolerance, capped by the smaller positive coordinate: never merge zero
// and a positive trace. Display rounding is deliberately unrelated to dominance.
const tolerance = (a: number, b: number) => a === 0 || b === 0 ? 0 : Math.min(1e-7 + Math.max(a, b) * 1e-8, Math.min(a, b) * 1e-6);
export function dominates(a: Metrics, b: Metrics): boolean {
  const x = coordinates(a), y = coordinates(b), keys = new Set([...Object.keys(x), ...Object.keys(y)]);
  return [...keys].every(k => (x[k] ?? 0) <= (y[k] ?? 0) + tolerance(x[k] ?? 0, y[k] ?? 0))
    && [...keys].some(k => (x[k] ?? 0) < (y[k] ?? 0) - tolerance(x[k] ?? 0, y[k] ?? 0));
}
function same(a: Metrics, b: Metrics) {
  const x = coordinates(a), y = coordinates(b);
  return [...new Set([...Object.keys(x), ...Object.keys(y)])].every(k => Math.abs((x[k] ?? 0) - (y[k] ?? 0)) <= tolerance(x[k] ?? 0, y[k] ?? 0));
}
function trim(report: ProductionVariants) {
  if (report.variants.length <= 12) return;
  const vectors = report.variants.map(v => coordinates(v.result));
  const keys = [...new Set(vectors.flatMap(v => Object.keys(v)))];
  const distances = vectors.map(() => 0);
  for (const key of keys) {
    const order = vectors.map((v, i) => ({ i, value: v[key] ?? 0 })).sort((a, b) => a.value - b.value);
    const span = order.at(-1)!.value - order[0].value; if (!span) continue;
    distances[order[0].i] = Infinity; distances[order.at(-1)!.i] = Infinity;
    for (let i = 1; i < order.length - 1; i++) distances[order[i].i] += (order[i + 1].value - order[i - 1].value) / span;
  }
  let index = distances.indexOf(Math.min(...distances));
  // More than twelve distinct extremes: retain a deterministic visible sample.
  if (distances[index] === Infinity) index = report.variants.length - 2;
  report.variants.splice(index, 1);
}
export function solvePareto(catalog: Catalog, input: Plan, highs: Parameters<typeof solve>[2], deadline = performance.now() + 60000,
  progress?: (report: ProductionVariants) => void, previous?: ProductionVariants): ProductionVariants {
  const plan = structuredClone(input); plan.settings.pareto = true; delete plan.settings.smoothPowerExtraMachines;
  if (previous && previous.variants.some(v => JSON.stringify(v.plan) !== JSON.stringify(plan))) previous = undefined;
  let report: ProductionVariants = { variants: [], equivalent: false, pareto: { attempted: 0, covered: [], pending: [], complete: false, pass: (previous?.pareto?.pass ?? 0) + 1, failures: [] } };
  try { parsePlan(plan); } catch (error) { report.variants.push({ id: 'error', label: 'Обзор недоступен', plan, result: emptyResult('error', String(error)) }); return report; }
  if (plan.mode !== 'target' && !plan.batch) { report.variants.push({ id: 'error', label: 'Обзор недоступен', plan, result: emptyResult('error', 'Задайте фиксированный выпуск или партию.') }); return report; }
  const ids = [...new Set([...plan.sources.map(s => s.itemId), ...(plan.settings.resourcePolicy === 'unlimited-unlisted' ? catalog.items.filter(i => i.raw).map(i => i.id) : [])])].sort();
  const directions = ['power', ...ids];
  if (previous?.pareto) {
    report.variants = structuredClone(previous.variants.filter(v => hasSolution(v.result)));
    report.pareto!.covered = [...previous.pareto.covered];
    report.pareto!.attempted = previous.pareto.attempted;
    report.pareto!.searched = previous.pareto.searched;
  }
  const meta = report.pareto!;
  const name = (id: string) => id === 'power' ? 'энергии' : catalog.items.find(i => i.id === id)?.name ?? id;
  const publish = () => { meta.pending = directions.filter(id => !meta.covered.includes(id)); progress?.(structuredClone(report)); };
  let attempts = 0;
  const run = (label: string, options: SolveOptions) => {
    attempts++; meta.attempted++;
    const result = solve(catalog, plan, highs, Math.min(deadline, performance.now() + Math.max(500, (deadline - performance.now()) / Math.max(1, 12 - attempts))), options);
    if (hasSolution(result)) {
      if (!report.variants.some(v => dominates(v.result, result) || same(v.result, result))) {
        report.variants = report.variants.filter(v => !dominates(result, v.result));
        report.variants.push({ id: `pareto-${meta.attempted}`, label, plan: structuredClone(plan), result });
        trim(report);
      }
    } else meta.failures.push({ label, status: result.status, message: result.message });
    return hasSolution(result);
  };
  for (const id of directions.filter(id => !meta.covered.includes(id))) {
    if (performance.now() >= deadline - 100 || attempts >= 12) break;
    if (run(`Минимум ${name(id)}`, { primary: id })) meta.covered.push(id);
    publish();
  }
  // Refine the widest normalized adjacent gaps using epsilon constraints.
  // A pass remembers tried gaps; subsequent passes refine the newly found set.
  const tried = new Set<string>(meta.searched ?? []);
  while (attempts < 12 && performance.now() < deadline - 100) {
    const gaps: { id: string; cap: number; width: number; key: string }[] = [];
    for (const id of ids) {
      const values = [...new Set(report.variants.map(v => coordinates(v.result)[id] ?? 0))].sort((a, b) => a - b);
      const span = values.at(-1)! - values[0];
      for (let i = 1; i < values.length; i++) {
        const cap = (values[i - 1] + values[i]) / 2, key = `${id}:${cap}`;
        if (values[i] - values[i - 1] > tolerance(values[i], values[i - 1]) && !tried.has(key)) gaps.push({ id, cap, key, width: (values[i] - values[i - 1]) / span });
      }
    }
    gaps.sort((a, b) => b.width - a.width || a.key.localeCompare(b.key));
    const gap = gaps[0]; if (!gap) break;
    tried.add(gap.key); meta.searched = [...tried]; run(`${name(gap.id)} ≤ ${gap.cap.toPrecision(4)}/мин`, { primary: 'power', inputCaps: { [gap.id]: gap.cap } }); publish();
  }
  // complete means only that all extreme directions were covered, never that
  // the continuous frontier has been enumerated.
  meta.complete = directions.every(id => meta.covered.includes(id));
  if (!report.variants.length) report.variants.push({ id: 'error', label: 'Обзор недоступен', plan,
    result: emptyResult(meta.failures[0]?.status ?? 'timeout', meta.failures[0]?.message ?? 'Время обзора истекло до получения проверенного варианта.') });
  publish(); return report;
}
