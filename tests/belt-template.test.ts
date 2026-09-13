import { expect, it } from 'vitest';
import { Model, dot } from '../packages/solver/model';
import { tryBeltTemplate } from '../packages/solver/beltTemplate';
import { validateBeltNetwork } from '../packages/domain/beltNetwork';
import type { SymbolicBeltEndpoint } from '../packages/solver/beltNetwork';

function fixture(supply: number[], demand: number[]) {
  const model = new Model(), reference: Record<string, number> = {};
  const endpoints: SymbolicBeltEndpoint[] = [];
  for (const [direction, rates] of [['supply', supply], ['demand', demand]] as const) rates.forEach((rate, index) => {
    const variable = model.variable(); reference[variable] = rate;
    endpoints.push({ id: `${direction}:${index}`, direction, expression: new Map([[variable, 1]]) });
  });
  return { model, reference, endpoints };
}
it.each([
  { supply: [30], demand: [30], depth: 1 as const, split: 0, merge: 0 },
  { supply: [120], demand: [30, 30, 30, 30], depth: 2 as const, split: 3, merge: 0 },
  { supply: [20, 20, 20], demand: [30, 30], depth: 2 as const, split: 1, merge: 1 },
  { supply: [15, 15], demand: [10, 10, 10], depth: 2 as const, split: 1, merge: 1 },
  { supply: [120, 60], demand: [30, 30, 30, 30, 20, 20, 20], depth: 2 as const, split: 4, merge: 0 },
])('строит проверяемую точную топологию $supply → $demand', ({ supply, demand, depth, split, merge }) => {
  const { model, reference, endpoints } = fixture(supply, demand);
  const template = tryBeltTemplate(model, 'part', endpoints, reference, depth, 120, performance.now() + 1000);
  expect(template).not.toBeNull();
  const graph = template!.decode(reference);
  expect(validateBeltNetwork(graph, endpoints.map(e => ({ ...e, rate: dot(e.expression, reference) })), depth, 120)).toEqual([]);
  expect(graph.nodes.filter(n => n.kind === 'split')).toHaveLength(split);
  expect(graph.nodes.filter(n => n.kind === 'merge')).toHaveLength(merge);
  for (const row of model.constraints) {
    const value = dot(row.expression, reference);
    if (row.operator === '=') expect(value).toBeCloseTo(row.rhs, 8);
    else if (row.operator === '<=') expect(value).toBeLessThanOrEqual(row.rhs + 1e-8);
    else expect(value).toBeGreaterThanOrEqual(row.rhs - 1e-8);
  }
  const changed = { ...reference, [endpoints[0].expression.keys().next().value!]: supply[0] + 1 };
  expect(model.constraints.some(row => row.operator === '=' && Math.abs(dot(row.expression, changed) - row.rhs) > 1e-6)).toBe(true);
});
it.each([
  { supply: [120], demand: [30, 30, 30, 30], depth: 1 as const, capacity: 120 },
  { supply: [20, 20, 20], demand: [30, 30], depth: 1 as const, capacity: 120 },
  { supply: [15, 15], demand: [30], depth: 2 as const, capacity: 20 },
  { supply: [121], demand: [121], depth: 2 as const, capacity: 120 },
  { supply: [30], demand: [29], depth: 2 as const, capacity: 120 },
])('не меняет модель при отсутствии быстрой схемы $supply → $demand', ({ supply, demand, depth, capacity }) => {
  const { model, reference, endpoints } = fixture(supply, demand);
  const before = model.serialize(new Map());
  expect(tryBeltTemplate(model, 'part', endpoints, reference, depth, capacity, performance.now() + 1000)).toBeNull();
  expect(model.serialize(new Map())).toBe(before);
});
it('возвращается без изменения модели после срока', () => {
  const { model, reference, endpoints } = fixture([30], [30]); const before = model.serialize(new Map());
  expect(tryBeltTemplate(model, 'part', endpoints, reference, 2, 120, performance.now() - 1)).toBeNull();
  expect(model.serialize(new Map())).toBe(before);
});
it('фиксирует нулевой конец и сохраняет ноль без скрытого удаления положительного потока', () => {
  const { model, reference, endpoints } = fixture([30, 0], [30, 0]);
  const template = tryBeltTemplate(model, 'part', endpoints, reference, 1, 120, performance.now() + 1000)!;
  expect(template).not.toBeNull();
  const zeroVariable = endpoints[1].expression.keys().next().value!;
  expect(model.constraints.some(row => row.operator === '=' && row.rhs === 0 && row.expression.get(zeroVariable) === 1)).toBe(true);
  expect(template.decode(reference).nodes).toHaveLength(2);
  const scaled = Object.fromEntries(Object.entries(reference).map(([key, value]) => [key, value / 2]));
  expect(template.decode(scaled).edges[0].rate).toBe(15);
});
it('численно близкое совпадение добавляет точное равенство исходных переменных', () => {
  const { model, reference, endpoints } = fixture([30], [30 + 1e-8]);
  const template = tryBeltTemplate(model, 'part', endpoints, reference, 1, 120, performance.now() + 1000)!;
  expect(template).not.toBeNull();
  const supply = endpoints[0].expression.keys().next().value!, demand = endpoints[1].expression.keys().next().value!;
  expect(model.constraints).toContainEqual({ expression: new Map([[supply, 1], [demand, -1]]), operator: '=', rhs: 0 });
  const exact = { ...reference, [supply]: 17, [demand]: 17 };
  expect(template.decode(exact).edges[0].rate).toBe(17);
});
it('при нулевом входе соединителя сохраняет единственную оставшуюся связь как ленту', () => {
  const { model, reference, endpoints } = fixture([15, 15], [30]);
  const template = tryBeltTemplate(model, 'part', endpoints, reference, 1, 120, performance.now() + 1000)!;
  expect(template).not.toBeNull();
  const changed = { ...reference, [endpoints[0].expression.keys().next().value!]: 0, [endpoints[2].expression.keys().next().value!]: 15 };
  const graph = template.decode(changed);
  expect(validateBeltNetwork(graph, endpoints.map(e => ({ ...e, rate: dot(e.expression, changed) })), 1, 120)).toEqual([]);
  expect(graph.nodes.filter(n => n.kind === 'merge')).toHaveLength(0);
  expect(graph.edges).toEqual([{ from: 'supply:1', to: 'demand:0', rate: 15 }]);
});
