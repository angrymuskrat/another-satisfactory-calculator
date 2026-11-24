import { beforeAll, expect, it } from 'vitest';
import { createHighs } from '../packages/solver/highs';
import { Model } from '../packages/solver/model';
import { addBeltNetwork, validateBeltNetwork } from '../packages/solver/beltNetwork';
import { DistributionSearch } from '../packages/domain/beltRouting';

let highs: Awaited<ReturnType<typeof createHighs>>;
beforeAll(async () => { highs = await createHighs(); });
it('does not accept disappearing positive endpoints or unequal microscopic splits', () => {
  expect(validateBeltNetwork({ itemId: 'ore', nodes: [{ id: 's', kind: 'supply' }], edges: [] }, [{ id: 's', direction: 'supply', rate: 1e-12 }], 1, 120).length).toBeGreaterThan(0);
  expect(validateBeltNetwork({ itemId: 'ore', nodes: [{ id: 's', kind: 'supply' }, { id: 'split', kind: 'split' }, { id: 'a', kind: 'demand' }, { id: 'b', kind: 'demand' }], edges: [{ from: 's', to: 'split', rate: 1e-8 }, { from: 'split', to: 'a', rate: 9e-9 }, { from: 'split', to: 'b', rate: 1e-9 }] }, [{ id: 's', direction: 'supply', rate: 1e-8 }, { id: 'a', direction: 'demand', rate: 9e-9 }, { id: 'b', direction: 'demand', rate: 1e-9 }], 1, 120)).toContain('Разделитель не делит поток поровну.');
});
function network(depth: 1 | 2 | 3 | 4, supply: number[], demand: number[], capacity = 120) {
  const model = new Model();
  const endpoints = [...supply.map((rate, i) => ({ id: `s${i}`, direction: 'supply' as const, rate })),
    ...demand.map((rate, i) => ({ id: `t${i}`, direction: 'demand' as const, rate }))];
  const symbolic = endpoints.map(e => { const variable = model.variable(e.rate); model.constrain(new Map([[variable, 1]]), '=', e.rate); return { ...e, expression: new Map([[variable, 1]]) }; });
  const built = addBeltNetwork(model, 'ore', symbolic, depth, capacity);
  const result = highs.solve(model.serialize(built.devices), { time_limit: 4, output_flag: false, mip_feasibility_tolerance: 1e-9 });
  if (result.Status !== 'Optimal') return { status: result.Status, graph: undefined };
  const graph = built.decode(Object.fromEntries(Object.entries(result.Columns).map(([id, c]) => [id, c.Primal])));
  expect(validateBeltNetwork(graph, endpoints, depth, capacity)).toEqual([]);
  return { status: result.Status, graph };
}
it('one splitter feeds two equal demands and no hidden branches', () => {
  const { status, graph } = network(1, [120], [60, 60]);
  expect(status).toBe('Optimal'); expect(graph!.nodes.filter(n => n.kind === 'split')).toHaveLength(1);
});
it('two levels can merge two thirds of a single source', () => {
  const { status, graph } = network(2, [120], [40, 80]);
  expect(status).toBe('Optimal'); expect(graph!.nodes.filter(n => n.kind === 'merge')).toHaveLength(1);
});
it('one level cannot create one third and two thirds on two belts', () => {
  expect(network(1, [120], [40, 80]).status).toContain('Infeasible');
});
it('merges independent sources without an unlimited output belt', () => {
  expect(network(1, [40, 60], [100]).status).toBe('Optimal');
  expect(network(1, [60, 60], [120], 100).status).toContain('Infeasible');
});
it('the network equations change production variables before optimization', () => {
  const model = new Model();
  const supply = model.variable(120), a = model.variable(80), b = model.variable(50);
  model.constrain(new Map([[supply, 1], [a, -1], [b, -1]]), '=', 0);
  addBeltNetwork(model, 'ore', [
    { id: 's', direction: 'supply', expression: new Map([[supply, 1]]) },
    { id: 'a', direction: 'demand', expression: new Map([[a, 1]]) },
    { id: 'b', direction: 'demand', expression: new Map([[b, 1]]) },
  ], 1, 120);
  // Enforce both consumers active. The only available distribution is 1/2:1/2.
  model.constrain(new Map([[a, 1]]), '>=', 1); model.constrain(new Map([[b, 1]]), '>=', 1);
  const result = highs.solve(model.serialize(new Map([[a, 1], [b, 1]]), true), { output_flag: false, time_limit: 4 });
  expect(result.Status).toBe('Optimal');
  if (result.Status !== 'Optimal') throw new Error(result.Status);
  expect(result.Columns[a].Primal).toBeCloseTo(50); expect(result.Columns[b].Primal).toBeCloseTo(50);
});

it('supports every simultaneous distribution from the complete depth-two catalogue', () => {
  const distributions = new DistributionSearch(2).advance({ maxStates: 10000, maxResults: 10000 });
  expect(distributions.complete).toBe(true);
  expect(distributions.results).toHaveLength(19);
  for (const distribution of distributions.results) {
    const demand = distribution.shares.map(share => 36 * share.numerator / share.denominator);
    expect(network(2, [36], demand, 36).status, distribution.id).toBe('Optimal');
  }
});

it('rejects invalid validator limits even for an empty graph', () => {
  const empty = { itemId: 'ore', nodes: [], edges: [] };
  for (const capacity of [0, -1, NaN, Infinity]) expect(validateBeltNetwork(empty, [], 1, capacity).length).toBeGreaterThan(0);
  for (const depth of [0, 5, 1.5, NaN, Infinity]) expect(validateBeltNetwork(empty, [], depth, 120).length).toBeGreaterThan(0);
  expect(validateBeltNetwork(empty, [], 1, 120)).toEqual([]);
});

it('rejects duplicate and invalid physical endpoint definitions', () => {
  const empty = { itemId: 'ore', nodes: [], edges: [] };
  const endpoint = { id: 's', direction: 'supply' as const, rate: 0 };
  expect(validateBeltNetwork(empty, [endpoint, { ...endpoint }], 1, 120).length).toBeGreaterThan(0);
  for (const rate of [-1, NaN, Infinity]) expect(validateBeltNetwork(empty, [{ ...endpoint, rate }], 1, 120).length).toBeGreaterThan(0);
});

it('checks the deadline before allocating device slots', () => {
  const model = new Model();
  const variable = model.variable(120);
  const initialVariables = model.variables.size;
  expect(() => addBeltNetwork(model, 'ore', [
    { id: 's', direction: 'supply', expression: new Map([[variable, 1]]) },
    { id: 't', direction: 'demand', expression: new Map([[variable, 1]]) },
  ], 4, 120, -Infinity)).toThrow(/срок/);
  // Initial model plus two endpoint flow/activation pairs; no device slots.
  expect(model.variables.size).toBe(initialVariables + 4);
});
