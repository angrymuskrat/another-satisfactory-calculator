import { strongComponents } from './dependencies';
import type { MachineSpan, SchematicModel, SchematicNode } from './schematic';

// Half-open machine intervals keep whole factories compact, including partial groups.
type Range = [number, number];
export type BuiltRanges = Record<string, Range[]>;
const intersection = ([a, b]: Range, [c, d]: Range): Range => [Math.max(a, c), Math.min(b, d)];
const spanRange = (s: MachineSpan): Range => [s.first, s.first + s.count];
const size = (ranges: Range[]) => ranges.reduce((sum, [a, b]) => sum + b - a, 0);

function subtract(range: Range, covered: Range[]) {
  const result: Range[] = [];
  let start = range[0];
  for (const [a, b] of covered) {
    if (a >= range[1]) break;
    if (a > start) result.push([start, a]);
    start = Math.max(start, b);
    if (start >= range[1]) break;
  }
  if (range[1] > start) result.push([start, range[1]]);
  return result;
}

function union(ranges: Range[]) {
  const merged: Range[] = [];
  for (const [a, b] of ranges.sort((l, r) => l[0] - r[0])) {
    const last = merged.at(-1);
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  return merged;
}

export function markBuilt(current: BuiltRanges, parts: MachineSpan[], checked: boolean) {
  const next = { ...current };
  for (const part of parts) {
    const range = spanRange(part), old = next[part.id] ?? [];
    const ranges = checked ? union([...old, range]) : old.flatMap(r => subtract(r, [range]));
    if (ranges.length) next[part.id] = ranges;
    else delete next[part.id];
  }
  return next;
}

export function builtCount(built: BuiltRanges, parts: MachineSpan[]) {
  return parts.reduce((sum, part) => sum + part.count - size(subtract(spanRange(part), built[part.id] ?? [])), 0);
}

type Link = { from: string; itemId?: string; source: Range; target: Range };
export type MissingSupply = { id: string; index: number; itemId?: string; label: string; page: number };
// Snap numerical noise at integer boundaries without dropping a whole positive edge.
const snapped = (n: number) => Math.abs(n - Math.round(n)) < 8 * Number.EPSILON * Math.max(1, n) ? Math.round(n) : n;
function covering([a, b]: Range, count: number): Range {
  const first = Math.min(count - 1, Math.max(0, Math.floor(snapped(a))));
  return [first, Math.max(first + 1, Math.min(count, Math.ceil(snapped(b))))];
}

/** Uses the unpaged configuration graph. Ordinary edges match the same ordered
 * flow allocation as the machine view, with intervals in machine coordinates.
 * A verified belt instead addresses exact physical endpoint indices. */
export function constructionDependencies(graph: SchematicModel, pageSize: number) {
  const nodes = graph.nodes.filter(n => n.parts?.length);
  const byId = new Map(nodes.map((n, i) => [n.id, i]));
  const outgoing = nodes.map(() => new Set<number>()), links = nodes.map(() => [] as Link[]);
  const offsets = new Map<string, number>();
  let machineOffset = 0;
  for (const n of nodes) if (n.kind === 'building') { offsets.set(n.id, machineOffset); machineOffset += n.count; }
  const all = new Map(graph.nodes.map(n => [n.id, n]));
  const cursors = new Map<string, number>();
  const interval = (node: SchematicNode, direction: 'inputs' | 'outputs', itemId: string, rate: number): Range => {
    const key = JSON.stringify([node.id, direction, itemId]), start = cursors.get(key) ?? 0;
    cursors.set(key, start + rate);
    const total = node[direction].find(f => f.itemId === itemId)!.rate;
    const count = node.count || 1;
    return [start / total * count, (start + rate) / total * count];
  };
  for (const e of graph.edges) {
    if (e.kind === 'flow' && !(e.rate > 0)) continue;
    const a = all.get(e.from)!, b = all.get(e.to)!;
    let source: Range, target: Range;
    if (e.physicalRouting) {
      source = [e.fromMachine ?? 0, (e.fromMachine ?? 0) + 1];
      target = [e.toMachine ?? 0, (e.toMachine ?? 0) + 1];
    } else if (e.kind === 'control') {
      source = [0, a.count]; target = [0, b.count];
    } else {
      source = interval(a, 'outputs', e.itemId!, e.rate);
      target = interval(b, 'inputs', e.itemId!, e.rate);
    }
    const from = byId.get(e.from), to = byId.get(e.to);
    if (from === undefined || to === undefined) continue;
    outgoing[from].add(to);
    links[to].push({ from: e.from, itemId: e.itemId, source, target });
  }
  const components = strongComponents(outgoing), componentOf = new Map<string, number>();
  components.forEach((indices, i) => indices.forEach(index => componentOf.set(nodes[index].id, i)));
  const cyclic = components.map(indices => indices.length > 1 || outgoing[indices[0]].has(indices[0]));
  // Every member of a cycle shares its external prerequisites.
  const external = components.map((indices, i) => indices.flatMap(index => links[index].filter(l => componentOf.get(l.from) !== i)));
  return (parts: MachineSpan[], built: BuiltRanges) => {
    const missing = new Map<string, MissingSupply>();
    let ready = 0, together = false, firstReady: { id: string; index: number; page: number } | undefined;
    for (const part of parts) {
      const component = componentOf.get(part.id);
      if (component === undefined) continue;
      together ||= cyclic[component];
      const pending = subtract(spanRange(part), built[part.id] ?? []);
      if (!pending.length) continue;
      const blocked: Range[] = [];
      for (const link of external[component]) {
        const provider = nodes[byId.get(link.from)!], count = provider.count || 1;
        const project = (p: number, from: Range, to: Range) => from[1] > from[0]
          ? to[0] + (p - from[0]) / (from[1] - from[0]) * (to[1] - to[0]) : to[0];
        for (const absent of subtract(covering(link.source, count), built[link.from] ?? [])) {
          const source = intersection(absent, link.source);
          const affected = covering([project(source[0], link.source, link.target), project(source[1], link.source, link.target)], nodes[byId.get(part.id)!].count || 1);
          for (const range of pending) {
            const overlap = cyclic[component] ? range : intersection(affected, range);
            if (overlap[1] <= overlap[0]) continue;
            blocked.push(overlap);
            const index = cyclic[component] ? absent[0] : Math.min(absent[1] - 1, Math.max(absent[0], Math.floor(snapped(project(overlap[0], link.target, link.source)))));
            const entry = { id: link.from, index, itemId: link.itemId,
              label: provider.kind === 'building' ? `${provider.label} · ${provider.configurations[0].name} №${index + 1}` : provider.label,
              page: Math.floor(((offsets.get(link.from) ?? 0) + index) / pageSize) };
            missing.set(JSON.stringify([entry.id, entry.index, entry.itemId]), entry);
          }
        }
      }
      const waiting = union(blocked);
      for (const range of pending) {
        const available = subtract(range, waiting);
        ready += size(available);
        if (!firstReady && available.length) {
          const index = available[0][0];
          firstReady = { id: part.id, index, page: Math.floor(((offsets.get(part.id) ?? 0) + index) / pageSize) };
        }
      }
    }
    return { ready, together, firstReady, missing: [...missing.values()] };
  };
}
