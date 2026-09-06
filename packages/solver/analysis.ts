import type { Catalog, Plan, Result } from '../domain/types';
import { effectivePlan } from '../domain/availability';
import { emptyResult, solve } from './solve';

export type AnalysisRequest = { kind: 'objectives' } | { kind: 'recipes'; recipeIds: string[] } | { kind: 'constraints'; candidateIds?: string[] };
export type Benefit = 'output' | 'feasibility' | 'reachable-output' | 'cost' | 'none' | 'unknown';
type Change =
  | { kind: 'source-limit' | 'source-node'; id: string; value: number }
  | { kind: 'source-add'; itemId: string; sourceId: string; value: number }
  | { kind: 'powerLimit' | 'peakPowerLimit'; value: number }
  | { kind: 'building-limit'; id: string; value: number }
  | { kind: 'recipe' | 'building' | 'unlock-recipe' | 'unlock-building'; id: string }
  | { kind: 'sink' };
export interface ConstraintCandidate { id: string; label: string; change: Change }
export interface Delta { before: number; after: number; delta: number }
export interface FlowDelta extends Delta { id: string; itemId: string }
export interface Summary {
  power: number; installedPower: number; resourceCost: number;
  physical: { production: number; extraction: number; sinks: number; total: number };
}
export interface Comparison {
  power: Delta; installedPower: Delta; resourceCost: Delta;
  physical: Record<keyof Summary['physical'], Delta>;
  outputs: FlowDelta[]; sources: FlowDelta[];
  recipes: { id: string; cycles: Delta; machines: Delta }[];
}
export interface AnalysisVariant {
  id: string; label: string; candidateIds: string[]; result: Result;
  summary: Summary | null; comparison: Comparison | null; benefit: Benefit;
}
export interface AnalysisReport {
  kind: AnalysisRequest['kind']; baseline: Result; baselineSummary: Summary | null;
  variants: AnalysisVariant[]; noProductionPath: boolean; complete: boolean;
  omittedCandidates: number; notes: string[];
}
const EPSILON = 1e-5;
const delta = (before: number, after: number): Delta => ({ before, after, delta: after - before });
const differs = (a: number, b: number) => Math.abs(a - b) > EPSILON + Math.max(Math.abs(a), Math.abs(b)) * 1e-7;
const increasedLimit = (value: number, minimum: number) => Math.min(1e9, value + Math.max(minimum, value));
export const objectiveLabels: Record<Plan['settings']['objective'], string> = { power: 'Экономия энергии', resources: 'Экономия выбранного сырья', buildings: 'Меньше зданий' };

/** Each proposal changes one named restriction. Node count and its optional cap are independent. */
export function constraintCandidates(catalog: Catalog, plan: Plan): ConstraintCandidate[] {
  const candidates: ConstraintCandidate[] = [];
  for (const source of plan.sources) {
    const label = `${catalog.items.find(i => i.id === source.itemId)?.name ?? source.itemId} · ${source.name || source.id}`;
    if (source.limit !== null && source.limit < 1e9) {
      const value = increasedLimit(source.limit, 60);
      candidates.push({ id: `source-limit:${source.id}`, label: `${label}: лимит ${source.limit} → ${value} ${catalog.items.find(i => i.id === source.itemId)?.fluid ? 'м³/мин' : 'шт/мин'}`, change: { kind: 'source-limit', id: source.id, value } });
    }
    if (source.kind === 'node' && source.count < 10000) candidates.push({ id: `source-node:${source.id}`, label: `${label}: добавить один добытчик (${source.count} → ${source.count + 1}); дополнительный лимит сохраняется`, change: { kind: 'source-node', id: source.id, value: source.count + 1 } });
  }
  if (plan.settings.resourcePolicy === 'listed-only' && plan.sources.length < 512) {
    for (const item of catalog.items.filter(i => i.raw && !plan.sources.some(s => s.itemId === i.id))) {
      let sourceId = `analysis:source:${item.id}`;
      while (plan.sources.some(s => s.id === sourceId)) sourceId += ':new';
      candidates.push({ id: `source-add:${item.id}`, label: `Добавить ${item.name}: внешний поток 60 ${item.fluid ? 'м³/мин' : 'шт/мин'}; энергия поставки неизвестна и исключена`, change: { kind: 'source-add', itemId: item.id, sourceId, value: 60 } });
    }
  }
  for (const kind of ['powerLimit', 'peakPowerLimit'] as const) {
    const limit = plan.settings[kind];
    if (limit != null && limit < 1e9) {
      const value = increasedLimit(limit, 10);
      candidates.push({ id: kind, label: `${kind === 'powerLimit' ? 'Средняя мощность' : 'Максимальная нагрузка'}: ${limit} → ${value} МВт; резерв сохраняется`, change: { kind, value } });
    }
  }
  for (const [id, limit] of Object.entries(plan.settings.buildingLimits ?? {})) {
    if (limit >= 10000) continue;
    candidates.push({ id: `building-limit:${id}`, label: `${catalog.buildings.find(b => b.id === id)?.name ?? catalog.miners.find(b => b.id === id)?.name ?? id}: лимит зданий ${limit} → ${limit + 1}`, change: { kind: 'building-limit', id, value: limit + 1 } });
  }
  const buildings = [...new Map([...catalog.buildings, ...catalog.miners].map(b => [b.id, b])).values()];
  for (const building of buildings) {
    if (catalog.buildings.some(b => b.id === building.id) && !plan.settings.enabledBuildingIds.includes(building.id)) candidates.push({ id: `building:${building.id}`, label: `Разрешить здание в плане: ${building.name}`, change: { kind: 'building', id: building.id } });
    if (plan.world && !plan.world.unlockedBuildingIds.includes(building.id)) candidates.push({ id: `unlock-building:${building.id}`, label: `Открыть в мире здание: ${building.name} (локальный выбор сохраняется)`, change: { kind: 'unlock-building', id: building.id } });
  }
  if (!plan.settings.allowSink && catalog.buildings.some(b => b.id === 'awesome-sink')) candidates.push({ id: 'sink', label: 'Разрешить утилизацию в Sink; доступность здания проверяется отдельно', change: { kind: 'sink' } });
  for (const recipe of catalog.recipes) {
    if (!plan.settings.enabledRecipeIds.includes(recipe.id)) candidates.push({ id: `recipe:${recipe.id}`, label: `Разрешить рецепт в плане: ${recipe.name}`, change: { kind: 'recipe', id: recipe.id } });
    if (plan.world && !plan.world.unlockedRecipeIds.includes(recipe.id)) candidates.push({ id: `unlock-recipe:${recipe.id}`, label: `Открыть в мире рецепт: ${recipe.name} (локальный выбор сохраняется)`, change: { kind: 'unlock-recipe', id: recipe.id } });
  }
  return candidates;
}
function applyChanges(input: Plan, changes: Change[]): Plan {
  const plan = structuredClone(input);
  for (const change of changes) {
    switch (change.kind) {
      case 'source-limit': plan.sources.find(s => s.id === change.id)!.limit = change.value; break;
      case 'source-node': plan.sources.find(s => s.id === change.id)!.count = change.value; break;
      case 'source-add': plan.sources.push({ id: change.sourceId, itemId: change.itemId, kind: 'flow', limit: change.value, count: 1, purity: 1, minerId: '', clock: 100 }); break;
      case 'powerLimit': case 'peakPowerLimit': plan.settings[change.kind] = change.value; break;
      case 'building-limit': plan.settings.buildingLimits = { ...plan.settings.buildingLimits, [change.id]: change.value }; break;
      case 'recipe': plan.settings.enabledRecipeIds.push(change.id); break;
      case 'building': plan.settings.enabledBuildingIds.push(change.id); break;
      case 'unlock-recipe': plan.world!.unlockedRecipeIds.push(change.id); break;
      case 'unlock-building': plan.world!.unlockedBuildingIds.push(change.id); break;
      case 'sink': plan.settings.allowSink = true; break;
    }
  }
  return plan;
}

export function summarizeResult(catalog: Catalog, input: Plan, result: Result): Summary {
  const plan = effectivePlan(catalog, input);
  const production = result.steps.reduce((sum, r) => sum + r.installedMachines, 0);
  const extraction = result.resources.reduce((sum, r) => {
    const source = plan.sources.find(s => s.id === r.sourceId);
    return sum + (source?.kind === 'node' && r.rate > 1e-12 ? r.installedMachines ?? source.count : 0);
  }, 0);
  const sinkPower = catalog.buildings.find(b => b.id === 'awesome-sink')?.power ?? 30;
  const sinks = sinkPower > 0 ? Math.round(result.sinkPower / sinkPower)
    : Math.ceil(result.surplus.reduce((sum, r) => sum + r.rate, 0) / (catalog.belts.find(b => b.id === plan.settings.beltId)?.rate ?? 1) - 1e-7);
  return { power: result.power, installedPower: result.installedPower,
    resourceCost: result.resources.reduce((sum, r) => sum + r.rate * (plan.settings.resourceWeights[r.itemId] ?? 1), 0),
    physical: { production, extraction, sinks: Math.max(0, sinks), total: production + extraction + Math.max(0, sinks) } };
}
function compare(before: Result, after: Result, a: Summary, b: Summary): Comparison {
  const flows = (left: { id: string; itemId: string; rate: number }[], right: { id: string; itemId: string; rate: number }[]): FlowDelta[] =>
    [...new Set([...left, ...right].map(r => r.id))].map(id => ({ id, itemId: [...left, ...right].find(r => r.id === id)!.itemId, ...delta(left.find(r => r.id === id)?.rate ?? 0, right.find(r => r.id === id)?.rate ?? 0) }));
  const recipes = [...new Set([...before.steps, ...after.steps].map(r => r.recipeId))].map(id => {
    const left = before.steps.find(r => r.recipeId === id), right = after.steps.find(r => r.recipeId === id);
    return { id, cycles: delta(left?.cycles ?? 0, right?.cycles ?? 0), machines: delta(left?.installedMachines ?? 0, right?.installedMachines ?? 0) };
  }).filter(r => differs(r.cycles.before, r.cycles.after) || r.machines.delta !== 0);
  return { power: delta(a.power, b.power), installedPower: delta(a.installedPower, b.installedPower), resourceCost: delta(a.resourceCost, b.resourceCost),
    physical: { production: delta(a.physical.production, b.physical.production), extraction: delta(a.physical.extraction, b.physical.extraction), sinks: delta(a.physical.sinks, b.physical.sinks), total: delta(a.physical.total, b.physical.total) },
    outputs: flows(before.products.map(r => ({ ...r, id: r.itemId })), after.products.map(r => ({ ...r, id: r.itemId }))),
    sources: flows(before.resources.map(r => ({ ...r, id: r.sourceId })), after.resources.map(r => ({ ...r, id: r.sourceId }))), recipes };
}
function benefit(plan: Plan, baseline: Result, result: Result, comparison: Comparison | null): Benefit {
  if (baseline.status === 'infeasible' && result.status === 'optimal') return 'feasibility';
  if (baseline.status === 'infeasible' && result.status === 'infeasible') {
    const a = baseline.feasibleAlternative?.fraction, b = result.feasibleAlternative?.fraction;
    return a != null && b != null ? b > a && differs(a, b) ? 'reachable-output' : 'none' : 'unknown';
  }
  if (!comparison) return 'unknown';
  if (plan.mode === 'maximize') {
    const changes = plan.targets.map(t => comparison.outputs.find(r => r.id === t.itemId)!);
    if (plan.policy === 'weighted') {
      const maxWeight = Math.max(...plan.targets.map(t => t.weight / t.scale));
      const score = (key: 'before' | 'after') => changes.reduce((sum, r, i) => sum + r[key] * (plan.targets[i].weight / plan.targets[i].scale / maxWeight), 0);
      const a = score('before'), b = score('after');
      if (differs(a, b)) return b > a ? 'output' : 'none';
    } else {
      const changed = changes.find(r => differs(r.before, r.after));
      if (changed) return changed.delta > 0 ? 'output' : 'none';
    }
  }
  const costs = plan.settings.objective === 'power' ? [comparison.power, comparison.resourceCost, comparison.physical.total]
    : plan.settings.objective === 'resources' ? [comparison.resourceCost, comparison.power, comparison.physical.total]
      : [comparison.physical.total, comparison.power, comparison.resourceCost];
  const changed = costs.find(r => differs(r.before, r.after));
  return changed && changed.delta < 0 ? 'cost' : 'none';
}

/** Full independent solves; one shared deadline and a per-solve allowance leave room for other probes. */
export function analyze(catalog: Catalog, input: Plan, highs: Parameters<typeof solve>[2], request: AnalysisRequest, deadline = performance.now() + 20000): AnalysisReport {
  const plan = structuredClone(input);
  const run = (variant: Plan) => performance.now() >= deadline ? emptyResult('timeout', 'Бюджет времени анализа исчерпан.')
    : solve(catalog, variant, highs, Math.min(deadline, performance.now() + 5000));
  const baseline = run(plan);
  const baselineSummary = baseline.status === 'optimal' ? summarizeResult(catalog, plan, baseline) : null;
  const report: AnalysisReport = { kind: request.kind, baseline, baselineSummary, variants: [],
    noProductionPath: plan.mode === 'maximize' && baseline.status === 'optimal' && baseline.objectiveValue <= 0 && baseline.products.every(p => p.rate === 0),
    complete: !['timeout', 'error'].includes(baseline.status), omittedCandidates: 0, notes: [] };
  const add = (id: string, label: string, variant: Plan, candidateIds: string[] = []) => {
    const result = run(variant), summary = result.status === 'optimal' ? summarizeResult(catalog, variant, result) : null;
    const comparison = baselineSummary && summary ? compare(baseline, result, baselineSummary, summary) : null;
    report.variants.push({ id, label, candidateIds, result, summary, comparison, benefit: benefit(plan, baseline, result, comparison) });
    if (['timeout', 'error'].includes(result.status)) report.complete = false;
  };
  if (request.kind === 'objectives') {
    for (const objective of ['power', 'resources', 'buildings'] as const) add(objective, objectiveLabels[objective], { ...structuredClone(plan), settings: { ...structuredClone(plan.settings), objective } });
    report.notes.push('Заказ, разрешённая потеря выпуска, частоты, мир и все ограничения одинаковы. Меняется только порядок целей. Расход сырья — условная стоимость с весами плана, а не универсальная мера дефицита.');
  } else if (request.kind === 'recipes') {
    const ids = [...new Set(request.recipeIds)];
    if (!ids.length || ids.some(id => !catalog.recipes.some(r => r.id === id))) throw new Error('Выберите существующие рецепты для сравнения.');
    const selected = ids.slice(0, 12); report.omittedCandidates = ids.length - selected.length;
    const toggle = (recipeIds: string[]) => {
      const variant = structuredClone(plan), enabled = new Set(variant.settings.enabledRecipeIds);
      for (const id of recipeIds) { if (enabled.has(id)) enabled.delete(id); else enabled.add(id); }
      variant.settings.enabledRecipeIds = [...enabled]; return variant;
    };
    const label = (id: string) => `${plan.settings.enabledRecipeIds.includes(id) ? 'Выключить' : 'Разрешить'}: ${catalog.recipes.find(r => r.id === id)!.name}`;
    for (const id of selected) add(id, label(id), toggle([id]), [id]);
    if (selected.length > 1) add('joint', `Совместно: ${selected.map(label).join('; ')}`, toggle(selected), selected);
    report.notes.push('Меняется только разрешение указанных рецептов. Открытия мира и здания сохраняются. Совместная польза проверяется отдельным решением.');
  } else {
    const candidates = constraintCandidates(catalog, plan);
    const ids = [...new Set(request.candidateIds ?? candidates.slice(0, 8).map(c => c.id))];
    if (ids.some(id => !candidates.some(c => c.id === id))) throw new Error('Ограничения изменились. Повторите выбор проверок.');
    const selected = ids.slice(0, 12).map(id => candidates.find(c => c.id === id)!);
    report.omittedCandidates = candidates.length - selected.length;
    for (const candidate of selected) add(candidate.id, candidate.label, applyChanges(plan, [candidate.change]), [candidate.id]);
    if (selected.length > 1) add('joint', `Совместно: ${selected.map(c => c.label).join('; ')}`, applyChanges(plan, selected.map(c => c.change)), selected.map(c => c.id));
    report.notes.push('Заполненный источник — признак насыщения, не доказательство пользы расширения. «Нет улучшения» относится только к названному изменению и его величине. Совместный результат не доказывает необходимость каждого изменения; минимальный набор причин не установлен.');
    if (report.omittedCandidates) report.notes.push(`Другие проверки не выполнены: ${report.omittedCandidates}. Выберите их отдельно. Отсутствие пользы одиночных изменений не исключает совместных ограничений или отсутствующих источников.`);
  }
  if (!report.complete) report.notes.push('Анализ завершён частично: тайм-аут или ошибка не доказывают отсутствие пользы.');
  return report;
}
