import type { StepResult } from './types';

export interface DependencyGroup {
  recipeIds: string[];
  cyclic: boolean;
  // Aggregate supply/demand inside the SCC, not an invented routing between machines.
  internalFlows: { itemId: string; produced: number; consumed: number }[];
}

/** Condense strongly connected components, then order suppliers before consumers. */
export function orderDependencies(steps: Pick<StepResult, 'recipeId' | 'inputs' | 'outputs'>[]): DependencyGroup[] {
  const nodes = [...steps].sort((a, b) => a.recipeId.localeCompare(b.recipeId));
  const consumers = new Map<string, number[]>();
  nodes.forEach((node, i) => node.inputs.filter(f => f.rate > 0).forEach(f => {
    const list = consumers.get(f.itemId) ?? []; list.push(i); consumers.set(f.itemId, list);
  }));
  const edges = nodes.map(node => new Set(node.outputs.filter(f => f.rate > 0).flatMap(f => consumers.get(f.itemId) ?? [])));
  const indices = nodes.map(() => -1), low = [...indices], stack: number[] = [], onStack = new Set<number>();
  const components: number[][] = []; let next = 0;
  const visit = (v: number) => {
    indices[v] = low[v] = next++; stack.push(v); onStack.add(v);
    for (const w of edges[v]) {
      if (indices[w] === -1) { visit(w); low[v] = Math.min(low[v], low[w]); }
      else if (onStack.has(w)) low[v] = Math.min(low[v], indices[w]);
    }
    if (low[v] === indices[v]) {
      const component: number[] = []; let w: number;
      do { w = stack.pop()!; onStack.delete(w); component.push(w); } while (w !== v);
      components.push(component.sort((a, b) => a - b));
    }
  };
  nodes.forEach((_, i) => { if (indices[i] === -1) visit(i); });
  const owner = new Map<number, number>(); components.forEach((c, i) => c.forEach(v => owner.set(v, i)));
  const outgoing = components.map(() => new Set<number>()), indegree = components.map(() => 0);
  edges.forEach((links, v) => links.forEach(w => {
    const from = owner.get(v)!, to = owner.get(w)!;
    if (from !== to && !outgoing[from].has(to)) { outgoing[from].add(to); indegree[to]++; }
  }));
  const ready = components.map((_, i) => i).filter(i => indegree[i] === 0), ordered: DependencyGroup[] = [];
  while (ready.length) {
    ready.sort((a, b) => components[a][0] - components[b][0]);
    const id = ready.shift()!, members = components[id];
    const produced = new Map<string, number>(), consumed = new Map<string, number>();
    for (const v of members) {
      for (const [flows, totals] of [[nodes[v].outputs, produced], [nodes[v].inputs, consumed]] as const) {
        for (const f of flows) if (f.rate > 0) totals.set(f.itemId, (totals.get(f.itemId) ?? 0) + f.rate);
      }
    }
    ordered.push({ recipeIds: members.map(v => nodes[v].recipeId), cyclic: members.length > 1 || edges[members[0]].has(members[0]),
      internalFlows: [...produced].filter(([itemId]) => consumed.has(itemId)).sort(([a], [b]) => a.localeCompare(b)).map(([itemId, rate]) => ({ itemId, produced: rate, consumed: consumed.get(itemId)! })),
    });
    for (const to of outgoing[id]) if (--indegree[to] === 0) ready.push(to);
  }
  return ordered;
}
