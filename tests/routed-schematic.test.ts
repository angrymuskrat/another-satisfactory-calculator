import { expect, it } from 'vitest';
import { buildSchematic, filterSchematicFlows } from '../packages/domain/schematic';
import { beltEndpointId } from '../packages/domain/beltRoutingResult';
import type { BeltRoutingResult } from '../packages/domain/beltRoutingResult';
import type { ConstructionGroup, ConstructionModel } from '../packages/domain/construction';
import type { Catalog } from '../packages/domain/types';

const catalog = { items: [{ id: 'ore', name: 'Руда', fluid: false }, { id: 'ingot', name: 'Слиток', fluid: false }, { id: 'water', name: 'Вода', fluid: true }], buildings: [{ id: 'smelter', name: 'Плавильня' }], miners: [] } as unknown as Catalog;
const flow = (itemId: string, rate: number) => ({ itemId, rate });
const endpoint = beltEndpointId;
function fixture(count = 2, rate = 120) {
  const g: ConstructionGroup = { id: 'iron', name: 'Слиток', kind: 'production', recipeId: 'iron', buildingId: 'smelter', count, clock: 100, activeDuty: 1, activeInputs: [flow('ore', rate / count)], activeOutputs: [flow('ingot', rate / count)], averageInputs: [flow('ore', rate)], averageOutputs: [flow('ingot', rate)], activePower: 4, averagePower: count * 4, peakPower: count * 4, powerEstimated: false };
  const bill = { items: [], unknown: [], totalMachines: 0, knownMachines: 0, complete: true };
  const model: ConstructionModel = { production: [g], extraction: [], sinks: [], externalSources: [{ sourceId: 'ore', name: 'Руда извне', itemId: 'ore', rate, power: null }], transport: { belt: { id: 'belt', name: 'Лента', rate: 120 }, pipe: { id: 'pipe', name: 'Труба', rate: 300 } }, fingerprint: 'routed', materials: bill, addedMaterials: bill, productionIdlePower: 0, productionPower: count * 4, extractionPower: 0, sinkPower: 0, averagePower: count * 4, peakPower: count * 4 };
  const routing: BeltRoutingResult = { depth: 1, externalLanes: { ore: 1 }, deliveryLanes: { 'product:0': count }, sinkCounts: {}, searchedConfigurations: 1, networks: [
    { itemId: 'ore', nodes: [{ id: endpoint('supply', 'external:ore', 0, 'ore'), kind: 'supply' }, { id: 'split', kind: 'split' }, ...Array.from({ length: count }, (_, i) => ({ id: endpoint('demand', 'iron', i, 'ore'), kind: 'demand' as const }))], edges: [{ from: endpoint('supply', 'external:ore', 0, 'ore'), to: 'split', rate }, ...Array.from({ length: count }, (_, i) => ({ from: 'split', to: endpoint('demand', 'iron', i, 'ore'), rate: rate / count }))] },
    { itemId: 'ingot', nodes: Array.from({ length: count }, (_, i) => [{ id: endpoint('supply', 'iron', i, 'ingot'), kind: 'supply' as const }, { id: endpoint('demand', 'product:0', i, 'ingot'), kind: 'demand' as const }]).flat(), edges: Array.from({ length: count }, (_, i) => ({ from: endpoint('supply', 'iron', i, 'ingot'), to: endpoint('demand', 'product:0', i, 'ingot'), rate: rate / count })) },
  ] };
  Object.assign(model, { beltRouting: routing });
  return { model, routing, destinations: { products: [flow('ingot', rate)] } };
}

it.each(['machines', 'types'] as const)('показывает реальные устройства и точные рёбра решателя в виде %s', mode => {
  const { model, destinations } = fixture();
  const graph = buildSchematic(catalog, model, destinations, mode);
  expect(graph.physicalRouting).toBe(true);
  const split = graph.nodes.find(node => node.kind === 'split')!;
  expect(split).toMatchObject({ count: 1, routingDepth: 1, inputs: [flow('ore', 120)], outputs: [flow('ore', 120)] });
  expect(graph.edges.filter(edge => edge.itemId === 'ore').map(edge => edge.rate)).toEqual([120, 60, 60]);
  expect(graph.edges.filter(edge => edge.from === split.id)).toHaveLength(2);
  expect(graph.edges.every(edge => edge.parallel === 1)).toBe(true);
  expect(graph.nodes.filter(node => node.kind === 'product')).toHaveLength(2);
  expect(graph.nodes.filter(node => node.kind === 'building').reduce((sum, node) => sum + node.count, 0)).toBe(2);
});

it('сохраняет обязательные малые физические ветви при фильтрации рисунка', () => {
  const { model, routing, destinations } = fixture();
  model.externalSources.push({ sourceId: 'tiny', name: 'Малая поставка', itemId: 'ore', rate: 0.0001, power: null });
  destinations.products.push(flow('ore', 0.0001));
  routing.externalLanes.tiny = 1; routing.deliveryLanes['product:1'] = 1;
  const network = routing.networks[0], from = endpoint('supply', 'external:tiny', 0, 'ore'), to = endpoint('demand', 'product:1', 0, 'ore');
  network.nodes.push({ id: from, kind: 'supply' }, { id: to, kind: 'demand' }); network.edges.push({ from, to, rate: .0001 });
  const graph = buildSchematic(catalog, model, destinations, 'machines');
  expect(filterSchematicFlows(graph).edges).toEqual(graph.edges);
  expect(graph.edges.some(edge => edge.rate === .0001)).toBe(true);
});

it.each([0, 1])('сохраняет все физические концы и переходы на странице %i', page => {
  const { model, routing, destinations } = fixture(50, 100);
  routing.externalLanes.ore = 50;
  routing.networks[0] = { itemId: 'ore', nodes: Array.from({ length: 50 }, (_, i) => [{ id: endpoint('supply', 'external:ore', i, 'ore'), kind: 'supply' as const }, { id: endpoint('demand', 'iron', i, 'ore'), kind: 'demand' as const }]).flat(), edges: Array.from({ length: 50 }, (_, i) => ({ from: endpoint('supply', 'external:ore', i, 'ore'), to: endpoint('demand', 'iron', i, 'ore'), rate: 2 })) };
  const graph = buildSchematic(catalog, model, destinations, 'machines', page);
  expect(graph.edges).toHaveLength(100);
  expect(graph.edges.every(edge => edge.rate === 2 && graph.nodes.some(node => node.id === edge.from) && graph.nodes.some(node => node.id === edge.to))).toBe(true);
  expect(graph.nodes.filter(node => node.kind === 'building' || node.kind === 'continuation').reduce((sum, node) => sum + node.count, 0)).toBe(50);
  expect(graph.nodes.filter(node => node.kind === 'source')).toHaveLength(50);
  expect(graph.nodes.filter(node => node.kind === 'product')).toHaveLength(50);
  for (const continuation of graph.nodes.filter(node => node.kind === 'continuation')) {
    expect(graph.edges.filter(edge => edge.to === continuation.id).reduce((sum, edge) => sum + edge.rate, 0)).toBe(continuation.inputs[0].rate);
    expect(graph.edges.filter(edge => edge.from === continuation.id).reduce((sum, edge) => sum + edge.rate, 0)).toBe(continuation.outputs[0].rate);
  }
});

it('отклоняет отсутствующий либо повреждённый физический граф, не заменяя его произвольными долями', () => {
  const { model, routing, destinations } = fixture();
  routing.networks[0].edges[1].rate = 59;
  expect(() => buildSchematic(catalog, model, destinations, 'machines')).toThrow();
  routing.networks.shift();
  expect(() => buildSchematic(catalog, model, destinations, 'machines')).toThrow();
});

it('показывает физический соединитель, сохраняя обычное распределение жидкости', () => {
  const { model, routing, destinations } = fixture();
  model.production[0].averageInputs.push(flow('water', 10));
  model.externalSources.push({ sourceId: 'water', name: 'Вода', itemId: 'water', rate: 10, power: 1 });
  routing.deliveryLanes['product:0'] = 1;
  const network = routing.networks[1];
  network.nodes = network.nodes.filter(node => node.kind === 'supply');
  network.nodes.push({ id: 'merge', kind: 'merge' }, { id: endpoint('demand', 'product:0', 0, 'ingot'), kind: 'demand' });
  network.edges = network.nodes.filter(node => node.kind === 'supply').map(node => ({ from: node.id, to: 'merge', rate: 60 }));
  network.edges.push({ from: 'merge', to: endpoint('demand', 'product:0', 0, 'ingot'), rate: 120 });
  const graph = buildSchematic(catalog, model, destinations, 'machines');
  const merge = graph.nodes.find(node => node.kind === 'merge')!;
  expect(merge).toMatchObject({ count: 1, routingDepth: 1, inputs: [flow('ingot', 120)], outputs: [flow('ingot', 120)] });
  expect(graph.edges.filter(edge => edge.itemId === 'water').map(edge => edge.rate)).toEqual([5, 5]);
  expect(graph.edges.filter(edge => edge.itemId === 'water').every(edge => !edge.physicalRouting)).toBe(true);
  expect(graph.edges.filter(edge => edge.itemId === 'ingot').map(edge => edge.rate)).toEqual([60, 60, 120]);
});

it.each(['machines', 'types'] as const)('сопоставляет положительную отгрузку по предмету с каждой физической лентой в виде %s', mode => {
  const { model, routing } = fixture();
  delete routing.deliveryLanes['product:0'];
  routing.deliveryLanes['export:ingot'] = 2;
  const network = routing.networks[1];
  for (let lane = 0; lane < 2; lane++) {
    const previous = endpoint('demand', 'product:0', lane, 'ingot');
    const next = endpoint('demand', 'export:ingot', lane, 'ingot');
    network.nodes.find(node => node.id === previous)!.id = next;
    network.edges.find(edge => edge.to === previous)!.to = next;
  }
  const graph = buildSchematic(catalog, model, { products: [], exports: [{ itemId: 'ingot', rate: 120, name: 'Соседняя фабрика' }] }, mode);
  const exports = graph.nodes.filter(node => node.kind === 'export');
  expect(exports).toHaveLength(2);
  expect(exports.map(node => node.label)).toEqual(['Отгрузка: Соседняя фабрика · лента 1', 'Отгрузка: Соседняя фабрика · лента 2']);
  for (const destination of exports) {
    expect(destination.inputs).toEqual([expect.objectContaining(flow('ingot', 60))]);
    expect(graph.edges.filter(edge => edge.to === destination.id)).toEqual([expect.objectContaining({ itemId: 'ingot', rate: 60, parallel: 1, physicalRouting: true })]);
  }
});
