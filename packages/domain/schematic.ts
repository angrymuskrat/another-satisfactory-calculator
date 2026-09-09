import type { Catalog, ProductResult } from './types';
import type { ConstructionGroup, ConstructionModel } from './construction';
import { orderDependencies } from './dependencies';

export type SchematicMode = 'types' | 'machines';
export const SCHEMATIC_PAGE_SIZE = 48;
export interface SchematicDestinations {
  products: ProductResult[];
  exports?: (ProductResult & { name?: string })[];
}
export interface SchematicNode {
  id: string;
  kind: 'building' | 'source' | 'product' | 'export' | 'merge' | 'split' | 'continuation';
  label: string;
  buildingId?: string;
  itemId?: string;
  count: number;
  existing: number;
  clock: number | null;
  averagePower: number | null;
  peakPower: number | null;
  inputs: ProductResult[];
  outputs: ProductResult[];
  configurations: ConstructionGroup[];
  stage: number;
  page?: number;
}
export interface SchematicEdge {
  id: string;
  from: string;
  to: string;
  kind: 'flow' | 'control';
  itemId?: string;
  rate: number;
  share?: number;
  parallel: number;
}
export type SchematicModel = ReturnType<typeof buildSchematic>;

const key = (...parts: (string | number)[]) => JSON.stringify(parts);
const sumFlows = (flows: ProductResult[]): ProductResult[] => {
  const totals = new Map<string, number>();
  for (const f of flows) {
    if (!Number.isFinite(f.rate) || f.rate < 0) throw new Error('Некорректный поток схемы.');
    if (f.rate > 0) totals.set(f.itemId, (totals.get(f.itemId) ?? 0) + f.rate);
  }
  return [...totals].sort(([a], [b]) => a.localeCompare(b)).map(([itemId, rate]) => ({ itemId, rate }));
};
const baseNode = (id: string, kind: SchematicNode['kind'], label: string, stage: number): SchematicNode => ({
  id, kind, label, stage, count: 0, existing: 0, clock: null, averagePower: null, peakPower: null,
  inputs: [], outputs: [], configurations: [],
});

/** A view of the checked configuration, not a physical port/routing solver. */
export function buildSchematic(catalog: Catalog, model: ConstructionModel, destinations: SchematicDestinations, mode: SchematicMode, requestedPage = 0) {
  const dependencies = orderDependencies(model.production.map(g => ({ recipeId: g.id, inputs: g.averageInputs, outputs: g.averageOutputs })));
  const stageByGroup = new Map<string, number>();
  // SCCs are identified before aggregating building types (aggregation can introduce false loops).
  const producedAt = new Map<string, number>();
  for (const component of dependencies) {
    const members = model.production.filter(g => component.recipeIds.includes(g.id));
    const stage = 2 + Math.max(0, ...members.flatMap(g => g.averageInputs.filter(f => f.rate > 0).map(f => producedAt.get(f.itemId) ?? 0)));
    for (const g of members) {
      stageByGroup.set(g.id, stage);
      for (const f of g.averageOutputs) if (f.rate > 0) producedAt.set(f.itemId, Math.max(stage, producedAt.get(f.itemId) ?? 0));
    }
  }
  const endStage = Math.max(0, ...stageByGroup.values()) + 2;
  const stageOf = (g: ConstructionGroup) => g.kind === 'extraction' ? 0 : g.kind === 'sink' ? endStage : stageByGroup.get(g.id) ?? 2;
  const groups = [...model.extraction, ...model.production, ...model.sinks].sort((a, b) => stageOf(a) - stageOf(b) || a.id.localeCompare(b.id));
  if (groups.some(g => !Number.isSafeInteger(g.count) || g.count <= 0)) throw new Error('Некорректное число зданий схемы.');
  const machineCount = groups.reduce((s, g) => s + g.count, 0);
  if (!Number.isSafeInteger(machineCount)) throw new Error('Число зданий слишком велико для схемы.');
  const pages = Math.max(1, Math.ceil(machineCount / SCHEMATIC_PAGE_SIZE));
  const page = mode === 'types' ? 0 : Math.max(0, Math.min(pages - 1, Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 0));
  const nodes: SchematicNode[] = [], edges: SchematicEdge[] = [], warnings: string[] = [];
  const buildingName = (g: ConstructionGroup) => catalog.buildings.find(b => b.id === g.buildingId)?.name
    ?? catalog.miners.find(b => b.id === g.buildingId)?.name
    ?? ({ 'resource-well-pressurizer': 'Компенсатор скважины', 'resource-well-extractor': 'Добытчик скважины' } as Record<string, string>)[g.buildingId] ?? g.name;
  const addBuilding = (id: string, kind: 'building' | 'continuation', label: string, parts: ConstructionGroup[], targetPage?: number) => {
    const n = baseNode(id, kind, label, Math.min(...parts.map(stageOf)));
    n.configurations = parts; n.buildingId = parts[0].buildingId;
    n.count = parts.reduce((s, g) => s + g.count, 0);
    n.existing = parts.reduce((s, g) => s + (g.existing ?? 0), 0);
    n.clock = parts.reduce((s, g) => s + g.clock * g.count, 0) / n.count;
    n.averagePower = parts.reduce((s, g) => s + g.averagePower, 0);
    n.peakPower = parts.reduce((s, g) => s + g.peakPower, 0);
    n.inputs = sumFlows(parts.flatMap(g => g.averageInputs));
    n.outputs = sumFlows(parts.flatMap(g => g.averageOutputs));
    n.page = targetPage;
    nodes.push(n);
  };
  if (mode === 'types') {
    const types = new Map<string, ConstructionGroup[]>();
    for (const g of groups) {
      // Recipes remain distinct even when they produce the same item. Extraction
      // has no recipe: distinguish its resource and well controller instead.
      const id = key(g.kind, g.buildingId, g.recipeId ?? '', g.controllerId ?? '',
        ...g.activeInputs.map(f => f.itemId).sort(), 'outputs', ...g.activeOutputs.map(f => f.itemId).sort());
      types.set(id, [...(types.get(id) ?? []), g]);
    }
    for (const [id, members] of types) addBuilding(key('type', id), 'building', buildingName(members[0]), members);
  } else {
    let offset = 0;
    const start = page * SCHEMATIC_PAGE_SIZE, end = start + SCHEMATIC_PAGE_SIZE;
    for (const g of groups) {
      const addSlice = (first: number, count: number, continuation: boolean) => {
        if (count <= 0) return;
        const ratio = count / g.count;
        const part = { ...g, count, existing: Math.max(0, Math.min(count, (g.existing ?? 0) - first)),
          averagePower: g.averagePower * ratio, peakPower: g.peakPower * ratio,
          averageInputs: g.averageInputs.map(f => ({ ...f, rate: f.rate * ratio })),
          averageOutputs: g.averageOutputs.map(f => ({ ...f, rate: f.rate * ratio })) };
        addBuilding(key(continuation ? 'continuation' : 'machine', g.id, first), continuation ? 'continuation' : 'building',
          `${buildingName(g)} ${continuation ? `№${first + 1}–${first + count}` : `№${first + 1}`}`, [part],
          continuation ? Math.floor((offset + first) / SCHEMATIC_PAGE_SIZE) : undefined);
      };
      const before = Math.min(g.count, Math.max(0, start - offset));
      const visibleEnd = Math.min(g.count, Math.max(0, end - offset));
      addSlice(0, before, true);
      for (let i = before; i < visibleEnd; i++) addSlice(i, 1, false);
      addSlice(visibleEnd, g.count - visibleEnd, true);
      offset += g.count;
    }
  }
  for (const s of model.externalSources) {
    if (!(s.rate > 0)) continue;
    const n = baseNode(key('source', s.sourceId), 'source', s.name, 0);
    n.outputs = [s]; n.itemId = s.itemId; n.averagePower = s.power; n.peakPower = s.power;
    nodes.push(n);
  }
  for (const [kind, flows] of [['product', destinations.products], ['export', destinations.exports ?? []]] as const) {
    flows.forEach((f, i) => {
      if (!(f.rate > 0)) return;
      const name = catalog.items.find(item => item.id === f.itemId)?.name ?? f.itemId;
      const n = baseNode(key(kind, f.itemId, i), kind, kind === 'export' ? `Отгрузка: ${'name' in f && f.name || name}` : `Готово: ${name}`, endStage);
      n.inputs = [f]; n.itemId = f.itemId; nodes.push(n);
    });
  }
  // Index each endpoint once; splitting/merging never multiplies all supplier-consumer pairs.
  const supplies = new Map<string, { node: SchematicNode; rate: number }[]>(), demands = new Map<string, { node: SchematicNode; rate: number }[]>();
  for (const n of nodes) for (const [flows, index] of [[n.outputs, supplies], [n.inputs, demands]] as const) {
    for (const f of sumFlows(flows)) index.set(f.itemId, [...(index.get(f.itemId) ?? []), { node: n, rate: f.rate }]);
  }
  const addFlow = (from: string, to: string, itemId: string, rate: number, share?: number) => {
    const capacity = catalog.items.find(i => i.id === itemId)?.fluid ? model.transport.pipe.rate : model.transport.belt.rate;
    if (!(capacity > 0) || !Number.isFinite(capacity)) throw new Error('Неизвестна пропускная способность транспорта.');
    if (mode === 'machines') {
      const lanes = Math.ceil(rate / capacity);
      if (!Number.isSafeInteger(lanes) || edges.length + lanes > 20000) throw new Error('Слишком много отдельных линий транспорта. Откройте схему по типам зданий.');
      for (let lane = 0; lane < lanes; lane++) {
        const part = Math.min(capacity, rate - lane * capacity);
        if (part > 0) edges.push({ id: key('edge', edges.length), from, to, kind: 'flow', itemId, rate: part,
          share: share === undefined ? undefined : share * part / rate, parallel: 1 });
      }
      return;
    }
    edges.push({ id: key('edge', edges.length), from, to, kind: 'flow', itemId, rate, share,
      parallel: Math.max(1, Math.ceil(rate / capacity - Math.min(1e-7, rate / capacity * 1e-8))) });
  };
  for (const itemId of [...new Set([...supplies.keys(), ...demands.keys()])].sort()) {
    const providers = supplies.get(itemId) ?? [], consumers = demands.get(itemId) ?? [];
    const supply = providers.reduce((s, e) => s + e.rate, 0), demand = consumers.reduce((s, e) => s + e.rate, 0);
    const difference = supply - demand, tolerance = 1e-7 + Math.max(supply, demand) * 1e-8;
    const item = catalog.items.find(i => i.id === itemId), name = item?.name ?? itemId;
    if (!providers.length || !consumers.length || !Number.isFinite(supply + demand) || Math.abs(difference) > tolerance) {
      throw new Error(`Не сходится баланс схемы: ${name}. Подача ${supply}, расход ${demand}.`);
    }
    if (difference !== 0) warnings.push(`${name}: численный остаток подачи минус расход ${difference.toExponential(3)} ${item?.fluid ? 'м³/мин' : 'шт/мин'}.`);
    if (mode === 'machines') {
      // Allocate already solved flows in stable endpoint order. This only chooses
      // displayed connections; it never selects recipes or changes production.
      let p = 0, c = 0, available = providers[0].rate, needed = consumers[0].rate;
      while (p < providers.length && c < consumers.length) {
        const rate = Math.min(available, needed);
        if (rate > 0) addFlow(providers[p].node.id, consumers[c].node.id, itemId, rate, rate / supply);
        available -= rate; needed -= rate;
        if (available === 0) available = providers[++p]?.rate ?? 0;
        if (needed === 0) needed = consumers[++c]?.rate ?? 0;
      }
      // Keep positive numerical tails visible; the total mismatch is disclosed
      // above, never silently replaced with storage or disposal.
      for (; p < providers.length; p++, available = providers[p]?.rate ?? 0) {
        if (available > 0) addFlow(providers[p].node.id, consumers.at(-1)!.node.id, itemId, available, available / supply);
      }
      for (; c < consumers.length; c++, needed = consumers[c]?.rate ?? 0) {
        if (needed > 0) addFlow(providers.at(-1)!.node.id, consumers[c].node.id, itemId, needed, needed / supply);
      }
      continue;
    }
    const stage = Math.min(...providers.map(e => e.node.stage)) + 1;
    const junction = (kind: 'merge' | 'split', rate: number) => {
      const label = item?.fluid ? (kind === 'merge' ? 'Объединение труб' : 'Распределение труб') : (kind === 'merge' ? 'Соединитель' : 'Разделитель');
      const n = baseNode(key(kind, itemId), kind, `${label}: ${name}`, stage + (kind === 'split' && providers.length > 1 ? .5 : 0));
      n.itemId = itemId; n.inputs = n.outputs = [{ itemId, rate }]; nodes.push(n); return n;
    };
    const merge = providers.length > 1 ? junction('merge', supply) : null;
    const split = consumers.length > 1 ? junction('split', demand) : null;
    if (merge) for (const p of providers) addFlow(p.node.id, merge.id, itemId, p.rate, p.rate / supply);
    if (split) for (const c of consumers) addFlow(split.id, c.node.id, itemId, c.rate, c.rate / demand);
    addFlow(merge?.id ?? providers[0].node.id, split?.id ?? consumers[0].node.id, itemId, supply);
  }
  const controlPairs = new Set<string>();
  for (const n of nodes) for (const g of n.configurations) if (g.controllerId) {
    for (const controller of nodes.filter(c => c.configurations.some(part => part.id === g.controllerId))) {
      const id = key('control', controller.id, n.id);
      if (controlPairs.has(id)) continue;
      controlPairs.add(id); edges.push({ id, from: controller.id, to: n.id, kind: 'control', rate: 0, parallel: 0 });
    }
  }
  return { nodes, edges, machineCount, pages, page, warnings,
    cycles: dependencies.filter(g => g.cyclic).map(g => ({ ...g,
      names: g.recipeIds.map(id => model.production.find(p => p.id === id)!.name) })) };
}
