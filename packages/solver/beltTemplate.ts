import { add, dot, type Expression, type Model } from './model';
import type { SymbolicBeltEndpoint } from './beltNetwork';
import type { BeltNetwork } from '../domain/beltNetwork';

interface Token { from: string; expression: Expression; rate: number; depth: number }
interface Link { from: string; to: string; expression: Expression }
interface State { tokens: Token[]; demands: (SymbolicBeltEndpoint & { rate: number })[]; nodes: BeltNetwork['nodes']; links: Link[]; equalities: Expression[] }
const combine = (expressions: Expression[]) => {
  const sum: Expression = new Map();
  for (const expression of expressions) for (const [variable, coefficient] of expression) add(sum, variable, coefficient);
  return sum;
};
const scale = (expression: Expression, multiplier: number): Expression => new Map([...expression].map(([variable, coefficient]) => [variable, coefficient * multiplier]));

/** A bounded topology proposal. Reference rates select devices only; the accepted
 * topology imposes exact equations on the original symbolic production flows.
 * Failure leaves the caller's model untouched and says nothing about feasibility.
 */
export function tryBeltTemplate(model: Model, itemId: string, endpoints: SymbolicBeltEndpoint[], referenceValues: Record<string, number>, depth: 1 | 2 | 3 | 4, capacity: number, deadline: number): { decode(values: Record<string, number>): BeltNetwork } | null {
  const end = Math.min(deadline, performance.now() + 50);
  if (!Number.isFinite(capacity) || capacity <= 0 || endpoints.length > 256 || ![1, 2, 3, 4].includes(depth)) return null;
  if (new Set(endpoints.map(e => e.id)).size !== endpoints.length) return null;
  const entries = endpoints.map(e => ({ ...e, rate: dot(e.expression, referenceValues) }));
  if (entries.some(e => !Number.isFinite(e.rate) || e.rate < 0 || e.rate > capacity + 1e-7 + capacity * 1e-8)) return null;
  const close = (a: number, b: number) => Math.abs(a - b) <= 1e-7 + Math.max(a, b) * 1e-8;
  const sum = (direction: 'supply' | 'demand') => entries.filter(e => e.direction === direction).reduce((total, e) => total + e.rate, 0);
  if (!close(sum('supply'), sum('demand'))) return null;
  const initial: State = {
    tokens: entries.filter(e => e.direction === 'supply' && e.rate > 0).map(e => ({ from: e.id, expression: e.expression, rate: e.rate, depth: 0 })),
    demands: entries.filter(e => e.direction === 'demand' && e.rate > 0),
    nodes: endpoints.map(e => ({ id: e.id, kind: e.direction })), links: [],
    equalities: entries.filter(e => e.rate === 0).map(e => e.expression),
  };
  let visited = 0;
  const seen = new Set<string>();
  const search = (input: State): State | null => {
    if (performance.now() >= end || ++visited > 2000 || input.tokens.length > 256) return null;
    const state = { ...input, tokens: [...input.tokens], demands: [...input.demands], links: [...input.links], equalities: [...input.equalities] };
    // A direct match consumes exactly one distinct frontier token and one demand.
    for (let i = state.tokens.length - 1; i >= 0; i--) {
      const token = state.tokens[i], match = state.demands.findIndex(d => close(d.rate, token.rate));
      if (match < 0) continue;
      const [demand] = state.demands.splice(match, 1); state.tokens.splice(i, 1);
      state.links.push({ from: token.from, to: demand.id, expression: token.expression });
      state.equalities.push(combine([token.expression, scale(demand.expression, -1)]));
    }
    if (!state.tokens.length || !state.demands.length) return !state.tokens.length && !state.demands.length ? state : null;
    const key = JSON.stringify([state.tokens.map(t => [t.rate.toPrecision(11), t.depth]).sort(), state.demands.map(d => d.rate.toPrecision(11)).sort()]);
    if (seen.has(key)) return null; seen.add(key);
    const candidates: { score: number; indices: number[]; split?: 2 | 3 }[] = [];
    const wanted = (rate: number) => state.demands.some(d => close(d.rate, rate));
    for (let i = 0; i < state.tokens.length; i++) {
      const token = state.tokens[i];
      if (token.depth >= depth) continue;
      for (const split of [2, 3] as const) candidates.push({ score: wanted(token.rate / split) ? 10 : 0, indices: [i], split });
      for (let j = i + 1; j < state.tokens.length; j++) {
        if (performance.now() >= end) return null;
        for (let k = j; k < state.tokens.length; k++) {
          const indices = k === j ? [i, j] : [i, j, k];
          const tokens = indices.map(index => state.tokens[index]);
          if (tokens.some(t => t.depth >= depth)) continue;
          const rate = tokens.reduce((total, t) => total + t.rate, 0);
          if (rate > capacity + 1e-7 + capacity * 1e-8) continue;
          const canSplit = Math.max(...tokens.map(t => t.depth)) + 2 <= depth;
          candidates.push({ score: wanted(rate) ? 10 : canSplit && (wanted(rate / 2) || wanted(rate / 3)) ? 5 : -1, indices });
          if (candidates.length >= 2000) break;
        }
        if (candidates.length >= 2000) break;
      }
      if (candidates.length >= 2000) break;
    }
    candidates.sort((a, b) => b.score - a.score);
    for (const candidate of candidates) {
      if (performance.now() >= end) return null;
      const consumed = candidate.indices.map(i => state.tokens[i]);
      let id = `template:${itemId}:${state.nodes.length}`;
      while (state.nodes.some(node => node.id === id)) id += ':';
      const expression = combine(consumed.map(t => t.expression));
      const rate = consumed.reduce((total, t) => total + t.rate, 0), level = Math.max(...consumed.map(t => t.depth)) + 1;
      const count = candidate.split ?? 1;
      const next: State = { ...state,
        tokens: [...state.tokens.filter((_, i) => !candidate.indices.includes(i)), ...Array.from({ length: count }, () => ({ from: id, expression: scale(expression, 1 / count), rate: rate / count, depth: level }))],
        nodes: [...state.nodes, { id, kind: candidate.split ? 'split' : 'merge' }],
        links: [...state.links, ...consumed.map(t => ({ from: t.from, to: id, expression: t.expression }))],
      };
      const found = search(next); if (found) return found;
    }
    return null;
  };
  const found = search(initial);
  if (!found || performance.now() >= end) return null;
  // Mutation begins only after a complete candidate has consumed every endpoint.
  for (const equation of found.equalities) model.constrain(equation, '=', 0);
  for (const link of found.links) {
    model.constrain(link.expression, '>=', 0); model.constrain(link.expression, '<=', capacity);
  }
  return { decode(values): BeltNetwork {
    const edges = found.links.map(link => ({ from: link.from, to: link.to, rate: dot(link.expression, values) })).filter(edge => edge.rate !== 0);
    const nodes = [...found.nodes];
    // If an optional input becomes exactly zero, a merger with one live input is
    // simply a wire. Removing it preserves the remaining physical connection.
    for (const node of [...nodes]) if (node.kind === 'merge') {
      const incoming = edges.filter(edge => edge.to === node.id), outgoing = edges.filter(edge => edge.from === node.id);
      if (incoming.length === 1 && outgoing.length === 1) {
        incoming[0].to = outgoing[0].to; edges.splice(edges.indexOf(outgoing[0]), 1); nodes.splice(nodes.indexOf(node), 1);
      }
    }
    const used = new Set(edges.flatMap(edge => [edge.from, edge.to]));
    return { itemId, nodes: nodes.filter(node => used.has(node.id)), edges };
  } };
}
