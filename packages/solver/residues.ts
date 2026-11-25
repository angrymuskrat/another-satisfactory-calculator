import { effectivePlan } from '../domain/availability';
import { applyBatch } from '../domain/batch';
import { buildConstruction } from '../domain/construction';
import { hasSolution, type Catalog, type Plan, type ProductResult, type Result } from '../domain/types';

export type ResidueContext = Pick<Result, 'status'> & Partial<Pick<Result, 'products' | 'steps' | 'exports' | 'surplus'>>;
export interface ResidueRequest {
  kind: 'residues'; itemId: string; limit: number; receiver: string;
  products?: ProductResult[];
}
export interface ResidueRoute {
  id: string; label: string; plan: Plan; result: Result; conditionalReceiver: boolean;
  localPower: number; machines: number; materials: ReturnType<typeof buildConstruction>['addedMaterials'];
  equipment: { id: string; buildingId: string; name: string; count: number; added: number; clock: number }[];
}
export interface ResidueReport {
  itemId: string; routes: ResidueRoute[]; attempts: { label: string; status: Result['status']; message: string }[];
  complete: boolean;
}
const used = (flows: ProductResult[] | undefined, id: string) => flows?.some(f => f.itemId === id && f.rate > 0) ?? false;
const positive = (products?: ProductResult[]) => products?.some(p => p.rate > 0) ?? false;

/** A failed plan has no verified steps. Traverse the allowed supply chain only to name hypotheses for the solver. */
export function residueCandidates(catalog: Catalog, input: Plan, result: ResidueContext | null): string[] {
  if (!result || result.status === 'unbounded') return [];
  const order = applyBatch(input);
  if (order.batch && order.targets.every(t => t.rate === 0)) return [];
  const targetIds = new Set(order.targets.map(t => t.itemId));
  const ids = new Set<string>();
  if (positive(result.products)) {
    for (const flow of [...result.exports ?? [], ...result.surplus ?? []]) if (flow.rate > 0) ids.add(flow.itemId);
    for (const step of result.steps ?? []) if (step.outputs.length > 1) {
      for (const flow of step.outputs) if (flow.rate > 0 && catalog.items.some(i => i.id === flow.itemId && i.fluid)) ids.add(flow.itemId);
    }
  } else {
    const plan = effectivePlan(catalog, order);
    const recipes = catalog.recipes.filter(r => plan.settings.enabledRecipeIds.includes(r.id) && plan.settings.enabledBuildingIds.includes(r.buildingId)
      && (!r.generation || r.generation.family === plan.settings.selfSupply));
    const needed = new Set(targetIds);
    for (const itemId of needed) {
      for (const recipe of recipes.filter(r => r.outputs.some(f => f.itemId === itemId))) {
        for (const output of recipe.outputs) if (output.itemId !== itemId) ids.add(output.itemId);
        for (const ingredient of recipe.inputs) needed.add(ingredient.itemId);
      }
    }
    // Generator waste can be the blocked outlet even if the generator supplies no material to a target.
    for (const r of recipes.filter(r => r.generation)) for (const f of r.outputs) ids.add(f.itemId);
  }
  return [...ids].filter(id => !targetIds.has(id));
}

export function sinkAvailable(catalog: Catalog, plan: Plan) {
  return catalog.buildings.some(b => b.id === 'awesome-sink') && plan.settings.enabledBuildingIds.includes('awesome-sink')
    && (!plan.world || plan.world.unlockedBuildingIds.includes('awesome-sink')) && (plan.settings.buildingLimits?.['awesome-sink'] ?? 1) > 0;
}

/** Only probes fix the displayed output. Applying a preview preserves the player's order and bounds. */
function fixOutput(plan: Plan, products?: ProductResult[]): Plan {
  if (!products || plan.mode === 'target' || plan.batch) return plan;
  return { ...plan, targets: plan.targets.map(t => {
    const rate = products.find(p => p.itemId === t.itemId)?.rate;
    if (rate === undefined || !Number.isFinite(rate) || rate < 0) throw new Error('Неполный исходный выпуск для сравнения.');
    // Preserve hard user bounds across numerical round-off, including a zero maximum.
    const fixed = Math.max(t.minRate ?? 0, Math.min(t.maxRate ?? Infinity, rate));
    return { ...t, minRate: fixed, maxRate: fixed };
  }) };
}

export function compareResidueRoutes(catalog: Catalog, input: Plan, request: ResidueRequest, baseline: Result, run: (p: Plan) => Result, deadline: number): ResidueReport {
  const plan = effectivePlan(catalog, applyBatch(input));
  const item = catalog.items.find(i => i.id === request.itemId);
  if (!item || plan.targets.some(t => t.itemId === item.id)) throw new Error('Выберите побочный продукт.');
  if (!Number.isFinite(request.limit) || request.limit < 0 || request.limit > 1e9) throw new Error('Укажите конечный предел отгрузки.');
  const routes: ResidueRoute[] = [], attempts: ResidueReport['attempts'] = [];
  let complete = true;
  let anchor = positive(request.products) ? request.products : positive(baseline.products) ? baseline.products : undefined;
  const matchesOutput = (result: Result) => !anchor || anchor.every(p => {
    const actual = result.products.find(r => r.itemId === p.itemId);
    return actual && Math.abs(actual.rate - p.rate) <= 1e-6 + p.rate * 1e-8;
  });
  const probe = (id: string, label: string, next: Plan, matches: (result: Result) => boolean, conditionalReceiver = false) => {
    if (performance.now() >= deadline) { complete = false; return false; }
    const result = run(fixOutput(next, anchor));
    if (!hasSolution(result) || !positive(result.products) || !matches(result) || !matchesOutput(result)) {
      if (result.status === 'timeout' || result.status === 'error') complete = false;
      attempts.push({ label, status: result.status, message: hasSolution(result) ? 'Этот расчёт не дал нужный выпуск с указанным назначением остатка.' : result.message });
      return false;
    }
    anchor ??= result.products;
    const model = buildConstruction(catalog, next, result);
    const importPower = model.externalSources.reduce((sum, s) => sum + (s.power ?? 0), 0);
    const equipment = [...model.production, ...model.extraction, ...model.sinks].map(g => ({
      id: g.id, buildingId: g.buildingId, name: g.name, count: g.count, added: g.count - (g.existing ?? 0), clock: g.clock,
    }));
    routes.push({ id, label, plan: next, result, conditionalReceiver, localPower: result.power - importPower,
      machines: model.materials.totalMachines, materials: model.addedMaterials, equipment });
    return true;
  };
  const active = new Set(plan.settings.enabledRecipeIds);
  const available = catalog.recipes.filter(r => plan.settings.enabledBuildingIds.includes(r.buildingId) && (!input.world || input.world.unlockedRecipeIds.includes(r.id))
    && (!r.generation || r.generation.family === plan.settings.selfSupply));
  const consumers = available.filter(r => r.inputs.some(f => f.itemId === item.id));
  const existing = new Set(input.expansion === 'rebuild' ? [] : input.lines?.map(l => l.recipeId));
  const onSite = structuredClone(input);
  if (item.fluid) onSite.settings.processFluidsOnSite = true;
  else onSite.exports = onSite.exports?.map(e => e.itemId === item.id ? { ...e, limit: 0 } : e);
  const named = request.receiver.trim();
  if (request.limit > 0) {
    const outlet = structuredClone(input);
    if (item.fluid && outlet.settings.processFluidsOnSite) {
      outlet.settings.processFluidsOnSite = false;
      // Only the selected outlet is opened in this counterfactual.
      outlet.exports = outlet.exports?.map(e => catalog.items.some(i => i.id === e.itemId && i.fluid) ? { ...e, limit: 0 } : e);
    }
    outlet.exports = [...(outlet.exports ?? []).filter(e => e.itemId !== item.id),
      { itemId: item.id, limit: request.limit, name: named || 'Условный получатель для проверки' }];
    const label = named ? `Отгрузка — ${named}` : 'Если организовать постоянную отгрузку';
    const exported = (r: Result) => used(r.exports, item.id);
    if (!probe('export', label, outlet, exported, !named)) {
      const enabledRecipeIds = outlet.settings.enabledRecipeIds.filter(id => existing.has(id) || !consumers.some(c => c.id === id));
      if (enabledRecipeIds.length < outlet.settings.enabledRecipeIds.length) {
        const direct = { ...outlet, settings: { ...outlet.settings, enabledRecipeIds } };
        probe('export', label + ' без конкурирующей переработки', direct, exported, !named);
      }
    }
  }
  const onSiteMatches = (r: Result) => r.steps.some(s => used(s.outputs, item.id)) && r.steps.some(s => used(s.inputs, item.id)) && !used(r.exports, item.id);
  const canSink = sinkAvailable(catalog, input);
  const tryLocal = (id: string, label: string, next: Plan, matches: (r: Result) => boolean) => {
    const withoutSink = next.settings.allowSink ? { ...next, settings: { ...next.settings, allowSink: false } } : next;
    probe(id, label, withoutSink, matches);
    if (canSink) {
      const withSink = { ...next, settings: { ...next.settings, allowSink: true } };
      probe(id + ':sink', label + ' с ЧУДО-утилизатором', withSink, r => matches(r) && positive(r.surplus));
    }
  };
  tryLocal('reuse', 'Переработка доступными рецептами', onSite, onSiteMatches);
  if (!item.fluid && item.sinkable && canSink) {
    probe('sink', 'Передать остаток в ЧУДО-утилизатор', { ...onSite, settings: { ...onSite.settings, allowSink: true } }, r => used(r.surplus, item.id));
  }
  // Compare individual first processing steps. Unrelated recipes and existing lines remain available.
  // Prefer enabled consumers that make an accepted solid, so packaging and recycling get time on a large catalog.
  const priority = (r: typeof consumers[number]) => (active.has(r.id) ? 2 : 0) + Number(r.outputs.some(f => catalog.items.some(i => i.id === f.itemId && i.sinkable && !i.fluid)));
  const consumerIds = new Set(consumers.map(r => r.id));
  for (const recipe of [...consumers].sort((a, b) => priority(b) - priority(a))) {
    if (performance.now() >= deadline) { complete = false; break; }
    const enabled = onSite.settings.enabledRecipeIds.filter(id => !consumerIds.has(id) || existing.has(id) || id === recipe.id);
    if (!enabled.includes(recipe.id)) enabled.push(recipe.id);
    const candidate = { ...onSite, settings: { ...onSite.settings, enabledRecipeIds: enabled } };
    tryLocal('recipe:' + recipe.id, recipe.name, candidate, r => onSiteMatches(r) && r.steps.some(s => s.recipeId === recipe.id && used(s.inputs, item.id)));
  }
  // A substitution can eliminate the co-product altogether at the same throughput.
  const suppliers = available.filter(r => active.has(r.id) && r.outputs.some(f => f.itemId === item.id));
  const otherOutputs = new Set(suppliers.flatMap(r => r.outputs.filter(f => f.itemId !== item.id).map(f => f.itemId)));
  const avoid = { ...input, settings: { ...input.settings, enabledRecipeIds: input.settings.enabledRecipeIds.filter(id => existing.has(id) || !suppliers.some(r => r.id === id)) } };
  const noResidue = (r: Result) => !r.steps.some(s => used(s.outputs, item.id));
  probe('avoid', 'Другой производственный путь без остатка', avoid, noResidue);
  for (const r of available.filter(r => !active.has(r.id) && r.outputs.some(f => otherOutputs.has(f.itemId)) && !r.outputs.some(f => f.itemId === item.id))) {
    if (performance.now() >= deadline) { complete = false; break; }
    const next = { ...avoid, settings: { ...avoid.settings, enabledRecipeIds: [...avoid.settings.enabledRecipeIds, r.id] } };
    probe('alternative:' + r.id, r.name, next, result => noResidue(result) && result.steps.some(s => s.recipeId === r.id && s.cycles > 0));
  }
  return { itemId: item.id, routes, attempts, complete };
}
