import type { Catalog, ProductResult } from './types';
import type { ConstructionGroup, ConstructionModel } from './construction';
import { orderDependencies } from './dependencies';
import { parallelLines } from './transport';
import { physicalBeltEndpoints } from './beltRoutingResult';
import { validateBeltNetwork } from './beltNetwork';

export type SchematicMode = 'types';
export interface MachineSpan { id: string; first: number; count: number }
export interface SchematicDestinations {
  products: ProductResult[];
  exports?: (ProductResult & { name?: string })[];
}
export interface SchematicNode {
  id: string;
  kind: 'building' | 'source' | 'product' | 'export' | 'merge' | 'split';
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
  routingDepth?: number;
  parts?: MachineSpan[];
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
  physicalRouting?: boolean;
  fromMachine?: number;
  toMachine?: number;
}
export type SchematicModel = ReturnType<typeof buildSchematic>;
export const SCHEMATIC_MIN_FLOW_SHARE = 0.0001; // 0.01% of this item's total supply.

/** Presentation only: keep the checked graph and solver values intact. */
export function filterSchematicFlows(graph: SchematicModel): SchematicModel {
  const totals = new Map<string, number>();
  for (const node of graph.nodes) {
    // Junctions repeat a flow already counted at its actual suppliers.
    if (node.kind === 'merge' || node.kind === 'split') continue;
    for (const flow of node.outputs) totals.set(flow.itemId, (totals.get(flow.itemId) ?? 0) + flow.rate);
  }
  return { ...graph, edges: graph.edges.filter(edge => edge.physicalRouting || edge.kind === 'control'
    || edge.rate >= (totals.get(edge.itemId!) ?? 0) * SCHEMATIC_MIN_FLOW_SHARE) };
}

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
export function buildSchematic(catalog: Catalog, model: ConstructionModel, destinations: SchematicDestinations, mode: SchematicMode | 'configurations') {
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
  const nodes: SchematicNode[] = [], edges: SchematicEdge[] = [], warnings: string[] = [];
  const routing = model.beltRouting;
  const machineCards = new Map<string, { first: number; count: number; id: string }[]>();
  const externalCards = new Map<string, string>(), destinationCards = new Map<string, string>();
  const buildingName = (g: ConstructionGroup) => catalog.buildings.find(b => b.id === g.buildingId)?.name
    ?? catalog.miners.find(b => b.id === g.buildingId)?.name
    ?? ({ 'resource-well-pressurizer': 'Компенсатор скважины', 'resource-well-extractor': 'Добытчик скважины' } as Record<string, string>)[g.buildingId] ?? g.name;
  const addBuilding = (id: string, kind: 'building', label: string, parts: ConstructionGroup[]) => {
    const n = baseNode(id, kind, label, Math.min(...parts.map(stageOf)));
    n.configurations = parts; n.buildingId = parts[0].buildingId;
    n.parts = parts.map(g => ({ id: g.id, first: 0, count: g.count }));
    n.count = parts.reduce((s, g) => s + g.count, 0);
    n.existing = parts.reduce((s, g) => s + (g.existing ?? 0), 0);
    n.clock = parts.reduce((s, g) => s + g.clock * g.count, 0) / n.count;
    n.averagePower = parts.reduce((s, g) => s + g.averagePower, 0);
    n.peakPower = parts.reduce((s, g) => s + g.peakPower, 0);
    n.inputs = sumFlows(parts.flatMap(g => g.averageInputs));
    n.outputs = sumFlows(parts.flatMap(g => g.averageOutputs));
    nodes.push(n);
  };
  if (mode === 'configurations') {
    for (const g of groups) {
      addBuilding(g.id, 'building', buildingName(g), [g]);
      machineCards.set(g.id, [{ first: 0, count: g.count, id: g.id }]);
    }
  } else {
    const types = new Map<string, ConstructionGroup[]>();
    for (const g of groups) {
      // Recipes remain distinct even when they produce the same item. Extraction
      // has no recipe: distinguish its resource and well controller instead.
      const id = key(g.kind, g.buildingId, g.recipeId ?? '', g.controllerId ?? '',
        ...g.activeInputs.map(f => f.itemId).sort(), 'outputs', ...g.activeOutputs.map(f => f.itemId).sort());
      types.set(id, [...(types.get(id) ?? []), g]);
    }
    for (const [id, members] of types) {
      const card = key('type', id);
      addBuilding(card, 'building', buildingName(members[0]), members);
      for (const member of members) machineCards.set(member.id, [{ first: 0, count: member.count, id: card }]);
    }
  }
  for (const s of model.externalSources) {
    if (!(s.rate > 0)) continue;
    const lanes = routing && !catalog.items.find(item => item.id === s.itemId)?.fluid ? routing.externalLanes[s.sourceId] : 1;
    if (!Number.isSafeInteger(lanes) || lanes < 1 || lanes > 100000) throw new Error('Недопустимое число входных конвейеров схемы.');
    for (let lane = 0; lane < lanes; lane++) {
      const id = routing ? key('source', s.sourceId, lane) : key('source', s.sourceId);
      const n = baseNode(id, 'source', lanes > 1 ? `${s.name} · лента ${lane + 1}` : s.name, 0);
      n.outputs = [{ ...s, rate: s.rate / lanes }]; n.itemId = s.itemId;
      n.parts = [{ id, first: 0, count: 1 }];
      n.averagePower = n.peakPower = s.power === null ? null : s.power / lanes;
      nodes.push(n); externalCards.set(key(s.sourceId, lane), id);
    }
  }
  for (const [kind, flows] of [['product', destinations.products], ['export', destinations.exports ?? []]] as const) {
    flows.forEach((f, i) => {
      if (!(f.rate > 0)) return;
      const name = catalog.items.find(item => item.id === f.itemId)?.name ?? f.itemId;
      const deliveryKey = kind === 'export' ? `export:${f.itemId}` : `product:${i}`;
      const lanes = routing && !catalog.items.find(item => item.id === f.itemId)?.fluid ? routing.deliveryLanes[deliveryKey] : 1;
      if (!Number.isSafeInteger(lanes) || lanes < 1 || lanes > 100000) throw new Error('Недопустимое число выходных конвейеров схемы.');
      for (let lane = 0; lane < lanes; lane++) {
        const id = routing ? key(kind, f.itemId, i, lane) : key(kind, f.itemId, i);
        const label = kind === 'export' ? `Отгрузка: ${'name' in f && f.name || name}` : `Готово: ${name}`;
        const n = baseNode(id, kind, lanes > 1 ? `${label} · лента ${lane + 1}` : label, endStage);
        n.inputs = [{ ...f, rate: f.rate / lanes }]; n.itemId = f.itemId; nodes.push(n);
        destinationCards.set(key(kind, i, lane), id);
      }
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
    edges.push({ id: key('edge', edges.length), from, to, kind: 'flow', itemId, rate, share,
      parallel: parallelLines(rate, capacity) });
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
    if (routing && !item?.fluid) continue;
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
  }
  if (routing) {
    const endpoints = physicalBeltEndpoints(catalog, model, destinations, routing);
    const expectedItems = new Set(endpoints.map(endpoint => endpoint.itemId));
    if (routing.networks.length !== expectedItems.size || new Set(routing.networks.map(network => network.itemId)).size !== expectedItems.size) throw new Error('Неполная конвейерная схема.');
    // Leave room between production stages for every physical logistics device.
    for (const node of nodes) node.stage *= routing.depth + 1;
    for (const network of routing.networks) {
      if (!expectedItems.has(network.itemId)) throw new Error('Неизвестный предмет конвейерной схемы.');
      const physical = endpoints.filter(endpoint => endpoint.itemId === network.itemId);
      const errors = validateBeltNetwork(network, physical, routing.depth, model.transport.belt.rate);
      if (errors.length) throw new Error(`Конвейерная схема не прошла проверку: ${errors[0]}`);
      const cards = new Map<string, string>();
      for (const endpoint of physical) {
        const card = endpoint.groupId !== undefined
          ? machineCards.get(endpoint.groupId)?.find(slice => endpoint.machineIndex! >= slice.first && endpoint.machineIndex! < slice.first + slice.count)?.id
          : endpoint.sourceId !== undefined ? externalCards.get(key(endpoint.sourceId, endpoint.lane!))
          : destinationCards.get(key(endpoint.destination!, endpoint.destinationIndex!, endpoint.lane!));
        if (!card) throw new Error('Физический конец конвейера не сопоставлен карточке.');
        cards.set(endpoint.id, card);
      }
      const incoming = new Map(network.nodes.map(node => [node.id, network.edges.filter(edge => edge.to === node.id)]));
      const outgoing = new Map(network.nodes.map(node => [node.id, network.edges.filter(edge => edge.from === node.id)]));
      const degrees = new Map(network.nodes.map(node => [node.id, incoming.get(node.id)!.length]));
      const queue = network.nodes.filter(node => degrees.get(node.id) === 0);
      const depths = new Map<string, number>();
      const baseStage = Math.max(0, ...physical.filter(endpoint => endpoint.direction === 'supply').map(endpoint => nodes.find(node => node.id === cards.get(endpoint.id))!.stage));
      const itemName = catalog.items.find(item => item.id === network.itemId)?.name ?? network.itemId;
      for (let i = 0; i < queue.length; i++) {
        const node = queue[i];
        const depth = (depths.get(node.id) ?? 0) + (node.kind === 'split' || node.kind === 'merge' ? 1 : 0);
        if (node.kind === 'split' || node.kind === 'merge') {
          const card = key('routing-device', network.itemId, node.id);
          const n = baseNode(card, node.kind, `${node.kind === 'split' ? 'Разделитель' : 'Соединитель'}: ${itemName}`, baseStage + depth);
          n.count = 1; n.itemId = network.itemId; n.routingDepth = depth;
          n.parts = [{ id: card, first: 0, count: 1 }];
          n.inputs = [{ itemId: network.itemId, rate: incoming.get(node.id)!.reduce((sum, edge) => sum + edge.rate, 0) }];
          n.outputs = [{ itemId: network.itemId, rate: outgoing.get(node.id)!.reduce((sum, edge) => sum + edge.rate, 0) }];
          nodes.push(n); cards.set(node.id, card);
        }
        for (const edge of outgoing.get(node.id)!) {
          depths.set(edge.to, Math.max(depths.get(edge.to) ?? 0, depth));
          degrees.set(edge.to, degrees.get(edge.to)! - 1);
          if (degrees.get(edge.to) === 0) queue.push(network.nodes.find(next => next.id === edge.to)!);
        }
      }
      const supply = physical.filter(endpoint => endpoint.direction === 'supply').reduce((sum, endpoint) => sum + endpoint.rate, 0);
      const machineIndices = new Map(physical.map(endpoint => [endpoint.id, endpoint.machineIndex]));
      network.edges.forEach((edge, index) => edges.push({ id: key('routing-edge', network.itemId, index), from: cards.get(edge.from)!, to: cards.get(edge.to)!, kind: 'flow', itemId: network.itemId, rate: edge.rate, share: edge.rate / supply, parallel: 1, physicalRouting: true,
        ...(mode === 'configurations' ? { fromMachine: machineIndices.get(edge.from), toMachine: machineIndices.get(edge.to) } : {}) }));
    }
  }
  const controlPairs = new Set<string>();
  for (const n of nodes) for (const g of n.configurations) if (g.controllerId) {
    for (const controller of nodes.filter(c => c.configurations.some(part => part.id === g.controllerId))) {
      const id = key('control', controller.id, n.id);
      if (controlPairs.has(id)) continue;
      controlPairs.add(id); edges.push({ id, from: controller.id, to: n.id, kind: 'control', rate: 0, parallel: 0 });
    }
  }
  return { nodes, edges, machineCount, warnings, ...(routing ? { physicalRouting: true } : {}),
    cycles: dependencies.filter(g => g.cyclic).map(g => ({ ...g,
      names: g.recipeIds.map(id => model.production.find(p => p.id === id)!.name) })) };
}
