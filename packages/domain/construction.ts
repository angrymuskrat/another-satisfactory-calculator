import type { Catalog, Ingredient, Plan, ProductResult, Result } from './types';
import { effectivePlan } from './availability';

export interface ConstructionGroup {
  id: string;
  kind: 'production' | 'extraction' | 'sink';
  buildingId: string;
  name: string;
  recipeId?: string;
  count: number;
  clock: number;
  activeDuty: number;
  activeInputs: ProductResult[];
  activeOutputs: ProductResult[];
  averageInputs: ProductResult[];
  averageOutputs: ProductResult[];
  activePower: number;
  averagePower: number;
  peakPower: number;
  powerEstimated: boolean;
}
export interface MaterialBill {
  items: Ingredient[];
  unknown: { buildingId: string; name: string; count: number }[];
  totalMachines: number;
  knownMachines: number;
  complete: boolean;
}

const exponent = Math.log2(2.5);
// Keep tiny positive flows. Only absorb a relative rounding error at an integer boundary.
const physicalCount = (n: number) => n > 0 ? Math.max(1, Math.ceil(n - Math.min(1e-7, n * 1e-8))) : 0;
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value !== null && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : value;

/** Recompute the shown fixed-clock/duty configuration from catalog coefficients, independently of solver MW and flow totals. */
export function buildConstruction(catalog: Catalog, input: Plan, result: Result) {
  const plan = effectivePlan(catalog, input);
  const belt = catalog.belts.find(t => t.id === plan.settings.beltId), pipe = catalog.pipes.find(t => t.id === plan.settings.pipeId);
  if (!belt || !pipe) throw new Error('Транспорт отсутствует в каталоге.');
  const production: ConstructionGroup[] = result.steps.map(step => {
    const recipe = catalog.recipes.find(r => r.id === step.recipeId);
    if (!recipe) throw new Error(`Не найден рецепт ${step.recipeId}.`);
    const building = catalog.buildings.find(b => b.id === recipe.buildingId);
    if (!building) throw new Error(`Не найдено здание ${recipe.buildingId}.`);
    const clock = plan.settings.clock / 100, cyclesAtClock = 60 / recipe.seconds * clock;
    const count = step.installedMachines;
    if (!Number.isInteger(count) || count <= 0 || !(cyclesAtClock > 0)) throw new Error(`Некорректная конфигурация ${recipe.name}.`);
    const activeDuty = step.cycles / (count * cyclesAtClock);
    const activePower = (recipe.power ?? building.power) * clock ** exponent;
    const peak = (recipe.powerMax ?? building.powerMax ?? recipe.power ?? building.power) * clock ** exponent;
    const flows = (ingredients: Ingredient[], cycles: number) => ingredients.map(i => ({ itemId: i.itemId, rate: i.amount * cycles }));
    return { id: `recipe:${recipe.id}`, kind: 'production', buildingId: building.id, name: recipe.name, recipeId: recipe.id,
      count, clock: plan.settings.clock, activeDuty, activeInputs: flows(recipe.inputs, cyclesAtClock), activeOutputs: flows(recipe.outputs, cyclesAtClock),
      averageInputs: flows(recipe.inputs, step.cycles), averageOutputs: flows(recipe.outputs, step.cycles),
      activePower, averagePower: activePower * step.cycles / cyclesAtClock, peakPower: count * peak,
      powerEstimated: !!(recipe.powerEstimated || building.powerEstimated) };
  });
  const extraction: ConstructionGroup[] = [];
  const externalSources: { sourceId: string; name: string; itemId: string; rate: number; power: null }[] = [];
  for (const resource of result.resources) {
    if (!(resource.rate > 0)) continue;
    const source = plan.sources.find(s => s.id === resource.sourceId);
    const item = catalog.items.find(i => i.id === resource.itemId);
    const name = source?.name?.trim() || `${item?.name ?? resource.itemId} · ${resource.sourceId}`;
    if (!source || source.kind === 'flow') {
      externalSources.push({ sourceId: resource.sourceId, name, itemId: resource.itemId, rate: resource.rate, power: null }); continue;
    }
    const miner = catalog.miners.find(m => m.id === source.minerId);
    if (!miner) throw new Error(`Не найден добытчик ${source.minerId}.`);
    const clock = source.clock / 100, nominal = miner.rate * source.purity * clock;
    const capacity = Math.min(nominal, item?.fluid ? pipe.rate : belt.rate);
    const count = resource.installedMachines ?? physicalCount(resource.rate / capacity);
    if (!Number.isInteger(count) || count <= 0 || !(nominal > 0)) throw new Error(`Некорректная конфигурация источника ${name}.`);
    const activePower = miner.power * clock ** exponent;
    extraction.push({ id: `source:${source.id}`, kind: 'extraction', buildingId: miner.id, name, count, clock: source.clock,
      activeDuty: resource.rate / (count * nominal), activeInputs: [], activeOutputs: [{ itemId: resource.itemId, rate: nominal }],
      averageInputs: [], averageOutputs: [{ itemId: resource.itemId, rate: resource.rate }], activePower,
      averagePower: resource.rate / nominal * activePower, peakPower: count * activePower, powerEstimated: false });
  }
  const sinks: ConstructionGroup[] = [];
  const disposalRate = result.surplus.reduce((sum, f) => sum + f.rate, 0);
  if (disposalRate > 0) {
    const sink = catalog.buildings.find(b => b.id === 'awesome-sink');
    if (!sink) throw new Error('Утилизатор отсутствует в каталоге.');
    const count = physicalCount(disposalRate / belt.rate);
    sinks.push({ id: 'sink:awesome-sink', kind: 'sink', buildingId: sink.id, name: sink.name, count, clock: 100, activeDuty: 1,
      activeInputs: result.surplus.map(f => ({ ...f, rate: f.rate / count })), activeOutputs: [], averageInputs: result.surplus.map(f => ({ ...f })), averageOutputs: [],
      activePower: sink.power, averagePower: count * sink.power, peakPower: count * (sink.powerMax ?? sink.power), powerEstimated: !!sink.powerEstimated });
  }
  const groups = [...production, ...extraction, ...sinks];
  for (const group of groups) {
    if (![group.activeDuty, group.activePower, group.averagePower, group.peakPower, ...group.activeInputs.map(f => f.rate), ...group.activeOutputs.map(f => f.rate)].every(n => Number.isFinite(n) && n >= 0) || group.activeDuty > 1 + 1e-6) {
      throw new Error(`Некорректные потоки или мощность: ${group.name}.`);
    }
  }
  const materials = constructionMaterials(catalog, groups);
  // Exact canonical configuration, no hash collisions. Persist as a value, not a storage key.
  const fingerprint = JSON.stringify(canonical({ plan: input, catalogVersion: catalog.version, groups, materials }));
  return { production, extraction, sinks, externalSources, materials, fingerprint, transport: { belt, pipe },
    productionPower: production.reduce((s, g) => s + g.averagePower, 0), extractionPower: extraction.reduce((s, g) => s + g.averagePower, 0),
    sinkPower: sinks.reduce((s, g) => s + g.averagePower, 0),
    averagePower: groups.reduce((s, g) => s + g.averagePower, 0), peakPower: groups.reduce((s, g) => s + g.peakPower, 0) };
}
export type ConstructionModel = ReturnType<typeof buildConstruction>;

export function constructionMaterials(catalog: Catalog, groups: ConstructionGroup[]): MaterialBill {
  const items = new Map<string, number>(), unknown = new Map<string, MaterialBill['unknown'][number]>();
  let knownMachines = 0, totalMachines = 0;
  for (const group of groups) {
    totalMachines += group.count;
    const building = group.kind === 'extraction' ? catalog.miners.find(b => b.id === group.buildingId) : catalog.buildings.find(b => b.id === group.buildingId);
    const cost = building?.buildCost;
    if (!cost || !cost.every(i => catalog.items.some(item => item.id === i.itemId) && Number.isFinite(i.amount) && i.amount > 0)) {
      const previous = unknown.get(group.buildingId);
      unknown.set(group.buildingId, { buildingId: group.buildingId, name: building?.name ?? group.buildingId, count: (previous?.count ?? 0) + group.count });
      continue;
    }
    knownMachines += group.count;
    for (const ingredient of cost) items.set(ingredient.itemId, (items.get(ingredient.itemId) ?? 0) + ingredient.amount * group.count);
  }
  return { items: [...items].sort(([a], [b]) => a.localeCompare(b)).map(([itemId, amount]) => ({ itemId, amount })),
    unknown: [...unknown.values()], knownMachines, totalMachines, complete: knownMachines === totalMachines };
}
