import { Model, add, dot, type Expression } from './model';
import type { BeltNetwork } from '../domain/beltNetwork';
export { validateBeltNetwork } from '../domain/beltNetwork';

export interface SymbolicBeltEndpoint { id: string; direction: 'supply' | 'demand'; expression: Expression }
interface Port { flow: string; active: Expression }
interface Slot { id: string; input: string; ports: Port[]; incoming: Expression; types?: string[] }

/** A complete layered DAG for these physical endpoints. Wires pad short paths.
 * The slot bound follows forward outdegree <=3 and backward indegree <=3;
 * parallel edges are distinct physical output ports, including split→merge.
 */
export function addBeltNetwork(model: Model, itemId: string, endpoints: SymbolicBeltEndpoint[], depth: 1 | 2 | 3 | 4, capacity: number, deadline = Infinity) {
  const supplies = endpoints.filter(e => e.direction === 'supply'), demands = endpoints.filter(e => e.direction === 'demand');
  const devices: Expression = new Map();
  const slots: Slot[] = [];
  const links: { from: string; to: string; flow: string }[] = [];
  const limits = () => {
    if (performance.now() >= deadline || model.variables.size > 60000) throw new Error('Поиск конвейерной схемы превысил доступный размер или срок расчёта. Уменьшите фабрику или отключите учёт схем.');
  };
  if (!(capacity > 0) || !Number.isFinite(capacity)) throw new Error('Неизвестна пропускная способность конвейера.');
  const endpointSlot = (e: SymbolicBeltEndpoint): Slot => {
    const flow = model.variable(1), expression = new Map([[flow, 1]]);
    for (const [v, c] of e.expression) add(expression, v, -c / capacity);
    model.constrain(expression, '=', 0);
    const active = model.variable(1, true); model.constrain(new Map([[flow, 1], [active, -1]]), '<=', 0);
    return { id: e.id, input: flow, incoming: new Map(), ports: [{ flow, active: new Map([[active, 1]]) }] };
  };
  const inputs = supplies.map(endpointSlot), outputs = demands.map(endpointSlot);
  const createSlot = (level: number, index: number): Slot => {
    limits();
    // wire, split2, split3, merge2, merge3
    const types = Array.from({ length: 5 }, () => model.variable(1, true));
    model.constrain(new Map(types.map(t => [t, 1])), '<=', 1);
    for (const t of types.slice(1)) add(devices, t, 1);
    const input = model.variable(1), flows = Array.from({ length: 3 }, () => model.variable(1));
    const ports = flows.map((flow, i) => ({ flow, active: new Map((i === 0 ? types : i === 1 ? types.slice(1, 3) : [types[2]]).map(t => [t, 1])) }));
    for (const port of ports) {
      const bound = new Map([[port.flow, 1]]); for (const [t, c] of port.active) add(bound, t, -c);
      model.constrain(bound, '<=', 0);
    }
    model.constrain(new Map([[input, -1], ...flows.map(f => [f, 1] as [string, number])]), '=', 0);
    for (const [j, splitTypes] of [[1, types.slice(1, 3)], [2, [types[2]]]] as const) {
      for (const sign of [1, -1]) model.constrain(new Map([[flows[0], sign], [flows[j], -sign], ...splitTypes.map(t => [t, 1] as [string, number])]), '<=', 1);
    }
    const slot = { id: `belt:${itemId}:${level}:${index}`, input, ports, incoming: new Map<string, number>(), types };
    slots.push(slot); return slot;
  };
  const connect = (from: Slot[], to: Slot[]) => {
    for (const source of from) for (const port of source.ports) {
      const selected = new Map(port.active); for (const [v, c] of selected) selected.set(v, -c);
      const supply = new Map([[port.flow, -1]]);
      for (const target of to) {
        limits();
        const used = model.variable(1, true), flow = model.variable(1);
        model.constrain(new Map([[flow, 1], [used, -1]]), '<=', 0);
        add(selected, used, 1); add(supply, flow, 1); add(target.incoming, used, 1);
        links.push({ from: source.id, to: target.id, flow });
      }
      model.constrain(selected, '=', 0); model.constrain(supply, '=', 0);
    }
    for (const target of to) {
      const incomingFlows = new Map([[target.input, -1]]);
      for (const edge of links) if (edge.to === target.id) add(incomingFlows, edge.flow, 1);
      model.constrain(incomingFlows, '=', 0);
      if (target.types) {
        const counts = new Map(target.incoming);
        target.types.forEach((v, i) => add(counts, v, -(i < 3 ? 1 : i === 3 ? 2 : 3)));
        model.constrain(counts, '=', 0);
      } else model.constrain(target.incoming, '<=', 1);
    }
  };
  let previous = inputs;
  for (let level = 1; level <= depth; level++) {
    const count = Math.min(supplies.length * 3 ** (level - 1), demands.length * 3 ** (depth - level));
    const layer = Array.from({ length: count }, (_, i) => createSlot(level, i));
    connect(previous, layer); previous = layer;
  }
  connect(previous, outputs);
  return { devices, decode(values: Record<string, number>): BeltNetwork {
    const raw = links.map(e => ({ from: e.from, to: e.to, rate: dot(new Map([[e.flow, capacity]]), values) })).filter(e => e.rate > 0);
    const kinds = new Map<string, BeltNetwork['nodes'][number]['kind']>(endpoints.map(e => [e.id, e.direction]));
    for (const slot of slots) {
      const t = slot.types!.findIndex(v => (values[v] ?? 0) > .5);
      if (t === 1 || t === 2) kinds.set(slot.id, 'split');
      if (t === 3 || t === 4) kinds.set(slot.id, 'merge');
    }
    // Remove padding wires and mergers whose other inputs carry exactly zero.
    for (const slot of slots) {
      const ins = raw.filter(e => e.to === slot.id), outs = raw.filter(e => e.from === slot.id);
      if (ins.length === 1 && outs.length === 1 && kinds.get(slot.id) !== 'split') {
        const first = ins[0], last = outs[0];
        first.to = last.to; raw.splice(raw.indexOf(last), 1); kinds.delete(slot.id);
      }
    }
    const used = new Set(raw.flatMap(e => [e.from, e.to]));
    return { itemId, nodes: [...kinds].filter(([id]) => used.has(id)).map(([id, kind]) => ({ id, kind })), edges: raw };
  } };
}
