import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkExtendedEdge, ElkNode, ElkPort } from 'elkjs/lib/elk-api';
import type { SchematicModel } from '../../../packages/domain/schematic';
import { closeNodeSize, MEDIUM_NODE, SCHEMATIC_TOP, type Point, type Rect, type SchematicLayout } from './schematicLayout';

export type Size = Pick<Rect, 'width' | 'height'>;
export type MediumLayout = SchematicLayout & { bends: Record<string, Point[]> };
export { MEDIUM_NODE };

const rootOptions = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
  'elk.portConstraints': 'FIXED_SIDE',
  // Room for the flow label in front of the consumer's input.
  'elk.layered.spacing.nodeNodeBetweenLayers': '100',
  'elk.padding': `[top=${SCHEMATIC_TOP},left=12,bottom=12,right=12]`,
};
// Nodes come sorted by medium column, so MODEL_ORDER cycle breaking reverses the medium
// layout's leftward edges and both runs share layers.
const orderedOptions = {
  'elk.layered.crossingMinimization.forceNodeModelOrder': 'true',
  'elk.layered.cycleBreaking.strategy': 'MODEL_ORDER',
};
const portKey = (nodeId: string, side: 'in' | 'out', itemId?: string) => `${nodeId}:${side}:${itemId ?? ''}`;

/** With `order`, nodes keep that layout's column-then-top order inside each layer. */
export function toElkGraph(graph: SchematicModel, sizes?: Record<string, Size>, order?: SchematicLayout): ElkNode {
  const ports = new Map<string, Map<string, ElkPort>>();
  const port = (nodeId: string, side: 'in' | 'out', itemId?: string) => {
    const id = portKey(nodeId, side, itemId);
    const list = ports.get(nodeId) ?? new Map<string, ElkPort>();
    ports.set(nodeId, list);
    if (!list.has(id)) list.set(id, { id, layoutOptions: { 'elk.port.side': side === 'in' ? 'WEST' : 'EAST' } });
    return id;
  };
  // ELK does not lay out self-loops reliably; fromElkLayout draws them from the node rect.
  const edges: ElkExtendedEdge[] = graph.edges.filter(e => e.from !== e.to).map(e => ({
    id: e.id, sources: [port(e.from, 'out', e.itemId)], targets: [port(e.to, 'in', e.itemId)],
  }));
  const at = (id: string) => order?.rects[id] ?? { x: Infinity, y: Infinity };
  const nodes = [...graph.nodes].sort(order
    ? (a, b) => at(a.id).x - at(b.id).x || at(a.id).y - at(b.id).y || a.id.localeCompare(b.id)
    : (a, b) => a.stage - b.stage || a.id.localeCompare(b.id));
  return {
    id: 'root',
    layoutOptions: order ? { ...rootOptions, ...orderedOptions } : rootOptions,
    children: nodes.map(n => ({
      id: n.id, ...sizes?.[n.id] ?? MEDIUM_NODE,
      layoutOptions: { 'elk.portConstraints': 'FIXED_SIDE' },
      ports: [...(ports.get(n.id)?.values() ?? [])].sort((a, b) => a.id.localeCompare(b.id)),
    })),
    edges,
  };
}

export function fromElkLayout(graph: SchematicModel, laid: ElkNode): MediumLayout {
  const rects: Record<string, Rect> = {};
  for (const n of laid.children ?? []) {
    rects[n.id] = { x: n.x ?? 0, y: n.y ?? 0, width: n.width ?? MEDIUM_NODE.width, height: n.height ?? MEDIUM_NODE.height };
  }
  const bends: Record<string, Point[]> = {};
  for (const e of (laid.edges ?? []) as ElkExtendedEdge[]) {
    bends[e.id] = (e.sections ?? []).flatMap(s => [s.startPoint, ...(s.bendPoints ?? []), s.endPoint]).map(({ x, y }) => ({ x, y }));
  }
  for (const e of graph.edges) {
    const r = rects[e.from];
    if (e.from === e.to && r && !bends[e.id]) {
      const x = r.x + r.width, y = r.y + r.height / 2;
      bends[e.id] = [{ x, y: y - 8 }, { x: x + 24, y: y - 8 }, { x: x + 24, y: y + 8 }, { x, y: y + 8 }];
    }
  }
  const values = Object.values(rects);
  return {
    width: laid.width ?? Math.max(0, ...values.map(r => r.x + r.width)),
    height: laid.height ?? Math.max(0, ...values.map(r => r.y + r.height)),
    rects, bends,
  };
}

export async function layoutWithElk(graph: SchematicModel, sizes?: Record<string, Size>, order?: SchematicLayout): Promise<MediumLayout> {
  return fromElkLayout(graph, await new ELK().layout(toElkGraph(graph, sizes, order)));
}

/** The close layout is a second ELK run with close card sizes that keeps the medium order. */
export async function layoutBoth(graph: SchematicModel): Promise<{ medium: MediumLayout; close: MediumLayout }> {
  const medium = await layoutWithElk(graph);
  const close = await layoutWithElk(graph, Object.fromEntries(graph.nodes.map(n => [n.id, closeNodeSize(n)])), medium);
  return { medium, close };
}
