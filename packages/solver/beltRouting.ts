import type { Catalog, Plan, Result } from '../domain/types';
import { hasSolution } from '../domain/types';
import { effectivePlan } from '../domain/availability';
import { applyBatch } from '../domain/batch';
import { parsePlan } from '../domain/validation';
import { productionConfigurations, wellConfiguration } from '../domain/production';
import { beltEndpointId, type BeltRoutingResult } from '../domain/beltRoutingResult';
import { add, dot, type Expression } from './model';
import { addBeltNetwork, type SymbolicBeltEndpoint } from './beltNetwork';
import { tryBeltTemplate } from './beltTemplate';
import type { buildModel } from './build';

export interface RoutingAttempt {
  reference?: { production: Record<string, number>; sources: Record<string, number>; products: Record<string, number>; exports: Record<string, number>; surplus: Record<string, number> };
  generalTopology?: boolean;
  outputFloors?: number[];
  machineBudget?: { minimum: number; limit: number };
  production: Record<string, number>;
  sources: Record<string, number>;
  externalLanes: Record<string, number>;
  deliveryLanes: Record<string, number>;
  sinkCounts: Record<string, number>;
}
type Built = ReturnType<typeof buildModel>;
type BaseSolve = (plan: Plan, deadline: number, routing?: RoutingAttempt) => Result;

/** Re-optimise each discrete composition with topology constraints present BEFORE
 * all production goals. Finite-time composition search is explicitly approximate;
 * an infeasible restricted composition never proves the original order infeasible.
 */
export function solveWithBeltRouting(catalog: Catalog, input: Plan, deadline: number, baseSolve: BaseSolve): Result {
  const plan = effectivePlan(catalog, applyBatch(parsePlan(input)));
  const started = performance.now();
  const refining = plan.settings.outputSlack > 0 || plan.settings.smoothPowerExtraMachines !== undefined;
  const unrestrained = structuredClone(input); unrestrained.settings.beltRouting = { ...input.settings.beltRouting!, enabled: false };
  unrestrained.settings.outputSlack = 0; delete unrestrained.settings.smoothPowerExtraMachines;
  const seed = baseSolve(unrestrained, performance.now() + Math.max(0, deadline - performance.now()) * .18);
  if (!hasSolution(seed)) {
    delete seed.feasibleAlternative;
    if (seed.status === 'unbounded') { seed.status = 'timeout'; seed.message = 'Свободная модель не ограничена; допустимая конвейерная схема не найдена. Ограничьте источники или мощность.'; }
    return seed;
  }
  const capacity = catalog.belts.find(b => b.id === plan.settings.beltId)!.rate;
  const numberOfLanes = (rate: number) => Math.max(1, Math.ceil(rate / capacity - 1e-7));
  const initial: RoutingAttempt = { production: {}, sources: {}, externalLanes: {}, deliveryLanes: {}, sinkCounts: {}, reference: {
    production: Object.fromEntries(seed.steps.map(s => [s.configurationId ?? s.recipeId, s.cycles])),
    sources: Object.fromEntries(seed.resources.map(s => [s.sourceId, s.rate])),
    products: Object.fromEntries(seed.products.map(s => [s.itemId, s.rate])),
    exports: Object.fromEntries((seed.exports ?? []).map(s => [s.itemId, s.rate])),
    surplus: Object.fromEntries(seed.surplus.map(s => [s.itemId, s.rate])),
  } };
  for (const step of seed.steps) initial.production[step.configurationId ?? step.recipeId] = step.installedMachines;
  for (const source of seed.resources) {
    initial.sources[source.sourceId] = Math.max(1, source.installedMachines ?? 1);
    initial.externalLanes[source.sourceId] = numberOfLanes(source.rate);
  }
  seed.products.forEach((p, i) => initial.deliveryLanes[`product:${i}`] = numberOfLanes(p.rate));
  for (const e of plan.exports ?? []) initial.deliveryLanes[`export:${e.itemId}`] = numberOfLanes(seed.exports?.find(p => p.itemId === e.itemId)?.rate ?? 0);
  for (const item of catalog.items.filter(i => i.sinkable && !i.fluid)) initial.sinkCounts[item.id] = numberOfLanes(seed.surplus.find(p => p.itemId === item.id)?.rate ?? 0);
  const attempts: RoutingAttempt[] = [initial];
  // Neighbours alter the machine composition, including previously unused alternatives.
  // No claim of exhaustive enumeration is made for this bounded-time search.
  const configurations = productionConfigurations(catalog, plan);
  const known = new Set([JSON.stringify(initial)]);
  const expand = (current: RoutingAttempt) => {
    const change = (field: 'production' | 'sources' | 'deliveryLanes' | 'sinkCounts', key: string, maximum = Number.MAX_SAFE_INTEGER) => {
      const count = current[field][key] ?? 0;
      for (const n of [count + 1, count - 1]) {
        if (n < 1 || n > maximum || performance.now() >= deadline) continue;
        const candidate = structuredClone(current); candidate[field][key] = n;
        const fingerprint = JSON.stringify(candidate);
        if (!known.has(fingerprint)) { known.add(fingerprint); attempts.push(candidate); }
      }
    };
    for (const c of configurations.filter(c => !c.existing)) change('production', c.id, plan.settings.buildingLimits?.[c.recipe.buildingId]);
    for (const s of plan.sources.filter(s => s.kind === 'node' && !catalog.items.find(i => i.id === s.itemId)?.fluid)) change('sources', s.id, s.count);
    for (const key of Object.keys(current.deliveryLanes)) change('deliveryLanes', key);
    if (plan.settings.allowSink) for (const key of Object.keys(current.sinkCounts)) change('sinkCounts', key);
  };
  expand(initial);
  // A suggested topology is a restricted candidate; retain the unrestricted
  // topology search as a separate candidate when the relaxation is not reached.
  attempts.splice(1, 0, { ...initial, generalTopology: true });
  const compactPlan = structuredClone(input); compactPlan.settings.outputSlack = 0; delete compactPlan.settings.smoothPowerExtraMachines;
  const compactEffective = { ...plan, settings: { ...compactPlan.settings } };
  let best: Result | null = null, searched = 0, last: Result = seed;
  const phaseOneEnd = refining ? started + (deadline - started) * .55 : deadline;
  let expanded = 1;
  for (let cursor = 0; cursor < attempts.length; cursor++) {
    const attempt = attempts[cursor];
    if (performance.now() >= phaseOneEnd - 50) break;
    // Reserve time for other compositions after a difficult topology search.
    const remaining = phaseOneEnd - performance.now();
    last = baseSolve(compactPlan, performance.now() + Math.min(remaining, Math.max(400, remaining * .55)), attempt);
    searched++;
    if (hasSolution(last) && (!best || better(last, best, compactEffective, catalog))) best = last;
    if (best && matchesRelaxation(best, seed, compactEffective, catalog)) break;
    // Keep searching meaningful neighbours, never return restricted infeasible.
    if (!best && cursor === attempts.length - 1 && expanded < attempts.length) {
      const end = attempts.length;
      for (; expanded < end && performance.now() < phaseOneEnd - 50; expanded++) expand(attempts[expanded]);
    }
  }
  if (!best) return { status: 'timeout', message: 'Поиск допустимой конвейерной схемы не завершён. Невыполнимость заказа не доказана. Увеличьте глубину, сократите фабрику или отключите учёт схем.', products: [], steps: [], resources: [], surplus: [], power: 0, productionPower: 0, extractionPower: 0, sinkPower: 0, installedPower: 0, objectiveValue: 0, maxBalanceError: 0, warnings: [], diagnostics: ['Перебор составов машин и физических лент не исчерпан.'] };
  if (refining) {
    // One common routed output baseline for every composition. Never apply loss
    // independently to a weaker composition or to the unrestricted LP optimum.
    const floors = outputScore(best, plan).map(v => v * (1 - plan.settings.outputSlack / 100));
    const relaxed = structuredClone(compactPlan); relaxed.settings.outputSlack = 100;
    const candidates: Result[] = [best];
    const extra = plan.settings.smoothPowerExtraMachines;
    const compactEnd = extra && extra > 0 ? performance.now() + (deadline - performance.now()) * .5 : deadline;
    for (const attempt of attempts) {
      if (performance.now() >= compactEnd - 50) break;
      const remaining = compactEnd - performance.now();
      const candidate = baseSolve(relaxed, performance.now() + Math.min(remaining, Math.max(400, remaining * .55)), { ...attempt, outputFloors: floors });
      searched++;
      if (hasSolution(candidate)) candidates.push(candidate);
    }
    const minimum = Math.min(...candidates.map(r => physicalMachines(r, plan, catalog)));
    const limit = minimum + (extra ?? 0);
    const eligible = extra === undefined ? candidates : candidates.filter(r => physicalMachines(r, plan, catalog) <= limit);
    best = eligible.reduce((a, b) => betterCosts(b, a, plan, catalog) ? b : a);
    if (extra !== undefined && extra > 0) {
      const economical = structuredClone(input); economical.settings.outputSlack = 100;
      for (const attempt of attempts) {
        if (performance.now() >= deadline - 50) break;
        const remaining = deadline - performance.now();
        const candidate = baseSolve(economical, performance.now() + Math.min(remaining, Math.max(400, remaining * .55)), { ...attempt, outputFloors: floors, machineBudget: { minimum, limit } });
        searched++;
        if (hasSolution(candidate) && betterCosts(candidate, best, plan, catalog)) best = candidate;
      }
    }
    if (extra !== undefined) best.machineBudget = { minimum, limit, used: physicalMachines(best, plan, catalog) };
  }
  best.status = 'approximate';
  best.message = 'Найдена допустимая фабрика с проверенной конвейерной схемой. Поиск состава машин и оптимизация энергии приближённые.';
  best.beltRouting!.searchedConfigurations = searched;
  best.warnings.push('Разводка проверена для каждой физической машины. Поиск проверяет исходный состав и соседние варианты; при отсутствии решения расширяет поиск до истечения срока. Глобальные максимум выпуска и минимум машин с учётом логистики не доказаны.');
  if (best.resources.some(r => r.rate > 0 && !catalog.items.find(i => i.id === r.itemId)?.fluid && (plan.sources.find(s => s.id === r.sourceId)?.kind ?? 'flow') === 'flow')) best.warnings.push('Внешняя поставка представлена указанным в схеме числом независимых лент с равной подачей. Обеспечьте эти входные потоки отдельно; разделение до границы фабрики не рассчитано.');
  return best;
}
function outputScore(result: Result, plan: Plan): number[] {
  const rates = plan.targets.map(t => result.products.find(p => p.itemId === t.itemId)?.rate ?? 0);
  if (plan.mode === 'target') return [];
  const weightScale = Math.max(...plan.targets.map(t => t.weight / t.scale));
  return plan.policy === 'priority' ? rates : plan.policy === 'weighted'
    ? [rates.reduce((s, v, i) => s + v * (plan.targets[i].weight / plan.targets[i].scale / weightScale), 0)] : [rates[0] * (Math.max(...plan.targets.map(t => t.rate)) / plan.targets[0].rate)];
}
function physicalMachines(result: Result, plan: Plan, catalog: Catalog) {
  const wells = result.resources.reduce((n, r) => {
    const source = plan.sources.find(s => s.id === r.sourceId);
    return n + (r.rate > 1e-12 && source?.kind === 'well' ? wellConfiguration(catalog, plan, source).count : 0);
  }, 0);
  const sinkPower = catalog.buildings.find(b => b.id === 'awesome-sink')?.power ?? 30;
  return wells + result.steps.reduce((n, s) => n + s.installedMachines, 0) + result.resources.reduce((n, s) => n + (s.installedMachines ?? 0), 0) + Math.round(result.sinkPower / sinkPower);
}
function costs(result: Result, plan: Plan, catalog: Catalog): number[] {
  const count = physicalMachines(result, plan, catalog);
  const resources = result.resources.reduce((n, r) => n + r.rate * (plan.settings.resourceWeights[r.itemId] ?? 1), 0);
  return plan.settings.smoothPowerExtraMachines !== undefined ? [result.power, resources, count]
    : plan.settings.objective === 'smooth-power' || plan.settings.objective === 'buildings' ? [count, result.power, resources]
      : plan.settings.objective === 'resources' ? [resources, result.power, count] : [result.power, resources, count];
}
function betterCosts(a: Result, b: Result, plan: Plan, catalog: Catalog) {
  return compare(costs(a, plan, catalog), costs(b, plan, catalog));
}
function better(a: Result, b: Result, plan: Plan, catalog: Catalog) {
  return compare([...outputScore(a, plan).map(v => -v), ...costs(a, plan, catalog)], [...outputScore(b, plan).map(v => -v), ...costs(b, plan, catalog)]);
}
function compare(left: number[], right: number[]) {
  for (let i = 0; i < left.length; i++) if (Math.abs(left[i] - right[i]) > 1e-6 + Math.abs(right[i]) * 1e-8) return left[i] < right[i];
  return false;
}
function matchesRelaxation(a: Result, b: Result, plan: Plan, catalog: Catalog) {
  const left = [...outputScore(a, plan), ...costs(a, plan, catalog)], right = [...outputScore(b, plan), ...costs(b, plan, catalog)];
  return left.every((v, i) => Math.abs(v - right[i]) <= 1e-6 + Math.abs(right[i]) * 1e-8);
}

export function configureBeltRouting(built: Built, catalog: Catalog, plan: Plan, attempt: RoutingAttempt, deadline: number) {
  const { model } = built, depth = plan.settings.beltRouting!.maxDepth;
  const capacity = catalog.belts.find(b => b.id === plan.settings.beltId)!.rate;
  const endpoints = new Map<string, SymbolicBeltEndpoint[]>();
  const referenceValues: Record<string, number> = {};
  if (attempt.reference) {
    for (const r of built.recipeVariables) referenceValues[r.variable] = attempt.reference.production[r.configuration.id] ?? 0;
    for (const s of built.sourceVariables) referenceValues[s.variable] = attempt.reference.sources[s.source.id] ?? 0;
    for (const t of built.targets) referenceValues[t.variable] = attempt.reference.products[t.target.itemId] ?? 0;
    for (const e of built.exports) referenceValues[e.variable] = attempt.reference.exports[e.itemId] ?? 0;
    for (const d of built.disposal) referenceValues[d.variable] = attempt.reference.surplus[d.itemId] ?? 0;
  }
  if (attempt.outputFloors && plan.mode === 'maximize') {
    const goals = plan.policy === 'priority' ? built.targets.map(t => new Map([[t.variable, 1]]))
      : plan.policy === 'weighted' ? [new Map(built.targets.map(t => [t.variable, t.target.weight / t.target.scale / Math.max(...built.targets.map(t => t.target.weight / t.target.scale))]))]
        : [new Map([[built.targets[0].variable, Math.max(...built.targets.map(t => t.target.rate)) / built.targets[0].target.rate]])];
    goals.forEach((goal, i) => model.constrain(goal, '>=', Math.max(0, attempt.outputFloors![i] - 1e-8 - Math.abs(attempt.outputFloors![i]) * 1e-9)));
  }
  const addEndpoint = (itemId: string, direction: 'supply' | 'demand', group: string, count: number, variable: string, coefficient = 1) => {
    if (catalog.items.find(i => i.id === itemId)?.fluid) return;
    if (!Number.isSafeInteger(count) || count < 1 || count > 100000) throw new Error('Слишком много физических концов конвейеров.');
    const entries = endpoints.get(itemId) ?? [];
    for (let i = 0; i < count; i++) entries.push({ id: beltEndpointId(direction, group, i, itemId), direction, expression: new Map([[variable, coefficient / count]]) });
    endpoints.set(itemId, entries);
  };
  const optionalCount = (variable: string, n: number) => {
    if (n === 0) { model.variables.get(variable)!.upper = 0; return; }
    const active = model.variable(1, true); model.constrain(new Map([[variable, 1], [active, -n]]), '=', 0);
  };
  for (const r of built.recipeVariables) {
    const n = r.configuration.existing || attempt.production[r.configuration.id] || 0;
    if (!r.configuration.existing) optionalCount(r.countVariable!, n);
    if (!n) continue;
    const group = r.configuration.id === r.recipe.id ? `recipe:${r.recipe.id}` : r.configuration.id;
    for (const i of r.recipe.inputs) addEndpoint(i.itemId, 'demand', group, n, r.variable, i.amount);
    for (const i of r.recipe.outputs) addEndpoint(i.itemId, 'supply', group, n, r.variable, i.amount);
  }
  for (const s of built.sourceVariables) {
    if (catalog.items.find(i => i.id === s.source.itemId)?.fluid) continue;
    if (s.source.kind === 'flow') addEndpoint(s.source.itemId, 'supply', `external:${s.source.id}`, attempt.externalLanes[s.source.id] ?? 1, s.variable);
    else {
      const n = Math.min(s.source.count, attempt.sources[s.source.id] ?? 1);
      optionalCount(s.countVariable!, n); addEndpoint(s.source.itemId, 'supply', `source:${s.source.id}`, n, s.variable);
    }
  }
  built.targets.forEach((t, i) => addEndpoint(t.target.itemId, 'demand', `product:${i}`, attempt.deliveryLanes[`product:${i}`] ?? 1, t.variable));
  built.exports.forEach(e => addEndpoint(e.itemId, 'demand', `export:${e.itemId}`, attempt.deliveryLanes[`export:${e.itemId}`] ?? 1, e.variable));
  const sinkVariables = new Map<string, string>();
  const sinkSum: Expression = new Map(built.sinkCount ? [[built.sinkCount, -1]] : []);
  for (const d of built.disposal) {
    // Dedicated single-item Sink belts; mixing items is outside this routing model.
    const n = attempt.sinkCounts[d.itemId] ?? 1, count = model.variable(n, true);
    optionalCount(count, n); add(sinkSum, count, 1); sinkVariables.set(d.itemId, count);
    model.constrain(new Map([[d.variable, 1 / capacity], [count, -1]]), '<=', 0);
    addEndpoint(d.itemId, 'demand', `sink:${d.itemId}`, n, d.variable);
  }
  if (built.sinkCount) model.constrain(sinkSum, '=', 0);
  const networks: { decode(values: Record<string, number>): import('../domain/beltNetwork').BeltNetwork }[] = [];
  for (const [item, ends] of endpoints) {
    const s = ends.filter(e => e.direction === 'supply'), d = ends.filter(e => e.direction === 'demand');
    if (!s.length || !d.length) { for (const e of ends) model.constrain(e.expression, '=', 0); continue; }
    if (s.length === 1 && d.length === 1) {
      const balance = new Map(s[0].expression); for (const [v, c] of d[0].expression) add(balance, v, -c);
      model.constrain(balance, '=', 0); model.constrain(s[0].expression, '<=', capacity);
      networks.push({ decode(values) { const rate = dot(s[0].expression, values); return { itemId: item, nodes: rate > 0 ? [{ id: s[0].id, kind: 'supply' }, { id: d[0].id, kind: 'demand' }] : [], edges: rate > 0 ? [{ from: s[0].id, to: d[0].id, rate }] : [] }; } });
    } else networks.push((attempt.reference && !attempt.generalTopology
      ? tryBeltTemplate(model, item, ends, referenceValues, depth, capacity, deadline) : null)
      ?? addBeltNetwork(model, item, ends, depth, capacity, deadline));
  }
  return { complete(result: Result, values: Record<string, number>) {
    const routing: BeltRoutingResult = { depth, networks: networks.map(n => n.decode(values)).filter(n => n.edges.length),
      externalLanes: { ...attempt.externalLanes }, deliveryLanes: { ...attempt.deliveryLanes },
      sinkCounts: Object.fromEntries([...sinkVariables].map(([id, v]) => [id, Math.round(values[v] ?? 0)]).filter(([, n]) => Number(n) > 0)), searchedConfigurations: 1 };
    for (const s of built.sourceVariables) if (s.source.kind === 'flow' && routing.externalLanes[s.source.id] === undefined) routing.externalLanes[s.source.id] = 1;
    result.beltRouting = routing;
  } };
}
