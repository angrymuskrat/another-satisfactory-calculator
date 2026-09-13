/** An edge is one physical belt; parallel edges represent distinct device ports. */
export interface RoutingGraph {
  nodes: { id: string; kind: 'input' | 'split' | 'merge' | 'output'; depth: number }[];
  edges: { from: string; to: string; numerator: number; denominator: number }[];
}
export interface Distribution {
  id: string;
  shares: { numerator: number; denominator: number }[];
  depth: number;
  splitters: number;
  mergers: number;
  graph: RoutingGraph;
}

type Operation = { indices: number[]; outputs: 1 | 2 | 3 };
// At depth <=4 a frontier contains at most 81 wires. Three seven-bit indices
// (zero means absent) plus two output-count bits fit losslessly in one uint32.
const packOperation = ({ indices, outputs }: Operation) => outputs
  | ((indices[0] + 1) << 2) | (((indices[1] ?? -1) + 1) << 9) | (((indices[2] ?? -1) + 1) << 16);
const unpackOperation = (value: number): Operation => ({ outputs: (value & 3) as 1 | 2 | 3,
  indices: [(value >>> 2) & 127, (value >>> 9) & 127, (value >>> 16) & 127].filter(index => index > 0).map(index => index - 1) });
const HISTORY_BLOCK_SIZE = 4096;
const encode = (numerator: number, depth: number) => numerator * 5 + depth;
const amount = (encoded: number) => Math.floor(encoded / 5);
const unpack = (key: string) => Array.from(key, char => char.charCodeAt(0));
const pack = (values: number[]) => String.fromCharCode(...values.sort((a, b) => a - b));
function fraction(numerator: number, denominator: number) {
  let a = numerator; let b = denominator;
  while (b) { const next = a % b; a = b; b = next; }
  return { numerator: numerator / a, denominator: denominator / a };
}
const fractionId = (value: { numerator: number; denominator: number }) => `${value.numerator}/${value.denominator}`;

/**
 * Complete finite search of one-input acyclic networks, including identity [1].
 * States are multisets of live (fraction, longest-path depth) wires. An operation
 * consumes wires exactly once. Equal states therefore have interchangeable
 * continuations, even when their witness histories differ. BFS first witnesses
 * minimise device count, not necessarily depth. No implicit size cap is applied.
 */
export class DistributionSearch {
  private readonly denominator: number;
  private readonly states: string[];
  // Two uint32s per witness predecessor instead of an object and index array
  // per discovered state. Graphs are materialised only for returned results.
  private readonly history: Uint32Array[] = [new Uint32Array(HISTORY_BLOCK_SIZE * 2)];
  private readonly seen: Set<string>;
  private readonly emitted = new Set<string>();
  private head = 0;
  private pending: Generator<{ key: string; operation: Operation }> | undefined;

  constructor(private readonly maxDepth: 1 | 2 | 3 | 4) {
    if (![1, 2, 3, 4].includes(maxDepth)) throw new Error('Глубина должна быть от 1 до 4');
    this.denominator = 6 ** maxDepth;
    const key = pack([encode(this.denominator, 0)]);
    this.states = [key];
    this.seen = new Set([key]);
  }

  /** deadline is an absolute Date.now() timestamp; visited counts discovered states. */
  advance(options: { maxStates: number; maxResults: number; deadline?: number }): { results: Distribution[]; complete: boolean; visited: number } {
    const { maxStates, maxResults, deadline = Infinity } = options;
    if (!Number.isSafeInteger(maxStates) || maxStates < 0 || !Number.isSafeInteger(maxResults) || maxResults < 0) {
      throw new Error('Бюджет поиска должен быть неотрицательным целым числом');
    }
    const results: Distribution[] = [];
    let started = 0;
    while (maxStates > 0 && results.length < maxResults && Date.now() < deadline && this.head < this.states.length) {
      if (!this.pending) {
        if (started >= maxStates) break;
        started++;
        const key = this.states[this.head];
        this.pending = this.expand(key);
        const numerators = unpack(key).map(amount);
        // Shares in a single search have a common denominator: retaining long
        // formatted "n/d,n/d,..." IDs would waste most of the catalogue memory.
        const distributionKey = String.fromCharCode(...numerators);
        if (!this.emitted.has(distributionKey)) {
          this.emitted.add(distributionKey);
          const shares = numerators.map(value => fraction(value, this.denominator));
          const id = shares.map(fractionId).join(',');
          results.push(this.witness(this.head, shares, id));
          if (results.length >= maxResults) break;
        }
      }
      // Yield boundaries occur between individual transitions, including inside
      // large merge-combination loops. The generator retains its exact cursor.
      const next = this.pending.next();
      if (next.done) { this.pending = undefined; this.head++; continue; }
      const { key, operation } = next.value;
      if (!this.seen.has(key)) {
        this.seen.add(key);
        const index = this.states.length, block = Math.floor(index / HISTORY_BLOCK_SIZE), offset = (index % HISTORY_BLOCK_SIZE) * 2;
        this.history[block] ??= new Uint32Array(HISTORY_BLOCK_SIZE * 2);
        this.history[block][offset] = this.head;
        this.history[block][offset + 1] = packOperation(operation);
        this.states.push(key);
      }
    }
    return { results, complete: this.head === this.states.length, visited: this.states.length };
  }

  private *expand(key: string): Generator<{ key: string; operation: Operation }> {
    const values = unpack(key);
    const transition = (indices: number[], outputs: 1 | 2 | 3) => {
      const inputs = indices.map(index => values[index]);
      const depth = Math.max(...inputs.map(value => value % 5)) + 1;
      const numerator = inputs.reduce((sum, value) => sum + amount(value), 0) / outputs;
      const rest = values.filter((_, index) => !indices.includes(index));
      return { key: pack([...rest, ...Array<number>(outputs).fill(encode(numerator, depth))]), operation: { indices, outputs } };
    };
    for (let i = 0; i < values.length; i++) {
      if ((i > 0 && values[i] === values[i - 1]) || values[i] % 5 >= this.maxDepth) continue;
      yield transition([i], 2);
      yield transition([i], 3);
      for (let j = i + 1; j < values.length; j++) {
        if ((j > i + 1 && values[j] === values[j - 1]) || values[j] % 5 >= this.maxDepth) continue;
        yield transition([i, j], 1);
        for (let k = j + 1; k < values.length; k++) {
          if ((k > j + 1 && values[k] === values[k - 1]) || values[k] % 5 >= this.maxDepth) continue;
          yield transition([i, j, k], 1);
        }
      }
    }
  }

  private witness(index: number, shares: Distribution['shares'], id: string): Distribution {
    const operations: Operation[] = [];
    for (let cursor = index; cursor > 0;) {
      const block = this.history[Math.floor(cursor / HISTORY_BLOCK_SIZE)], offset = (cursor % HISTORY_BLOCK_SIZE) * 2;
      operations.push(unpackOperation(block[offset + 1]));
      cursor = block[offset];
    }
    operations.reverse();
    const graph: RoutingGraph = { nodes: [{ id: 'input', kind: 'input', depth: 0 }], edges: [] };
    let frontier = [{ from: 'input', value: encode(this.denominator, 0) }];
    let splitters = 0; let mergers = 0;
    for (const [step, operation] of operations.entries()) {
      const inputs = operation.indices.map(position => frontier[position]);
      const depth = Math.max(...inputs.map(input => input.value % 5)) + 1;
      const nodeId = `device-${step}`;
      const kind = operation.outputs === 1 ? 'merge' : 'split';
      if (kind === 'split') splitters++; else mergers++;
      graph.nodes.push({ id: nodeId, kind, depth });
      for (const input of inputs) graph.edges.push({ from: input.from, to: nodeId, ...fraction(amount(input.value), this.denominator) });
      const numerator = inputs.reduce((sum, input) => sum + amount(input.value), 0) / operation.outputs;
      frontier = [
        ...frontier.filter((_, position) => !operation.indices.includes(position)),
        ...Array.from({ length: operation.outputs }, () => ({ from: nodeId, value: encode(numerator, depth) })),
      ].sort((a, b) => a.value - b.value);
    }
    frontier.forEach((output, position) => {
      const outputId = `output-${position}`;
      graph.nodes.push({ id: outputId, kind: 'output', depth: output.value % 5 });
      graph.edges.push({ from: output.from, to: outputId, ...fraction(amount(output.value), this.denominator) });
    });
    return { id, shares, depth: Math.max(...frontier.map(output => output.value % 5)), splitters, mergers, graph };
  }
}

/** Independent exact-rational graph validator; no trust in recorded depths or shares. */
export function validateDistribution(distribution: Distribution, maxDepth: number): string[] {
  const errors: string[] = [];
  const { nodes, edges } = distribution.graph;
  const ids = new Map(nodes.map(node => [node.id, node]));
  if (ids.size !== nodes.length) errors.push('Идентификаторы узлов повторяются');
  const validFraction = (value: { numerator: number; denominator: number }) =>
    Number.isSafeInteger(value.numerator) && Number.isSafeInteger(value.denominator) && value.numerator > 0 && value.denominator > 0;
  if (edges.some(edge => !validFraction(edge)) || distribution.shares.some(value => !validFraction(value))) {
    return [...errors, 'Недопустимая положительная рациональная доля'];
  }
  if (edges.some(edge => !ids.has(edge.from) || !ids.has(edge.to))) return [...errors, 'Ребро ссылается на неизвестный узел'];
  type Rational = { n: bigint; d: bigint };
  const rational = (value: { numerator: number; denominator: number }): Rational => ({ n: BigInt(value.numerator), d: BigInt(value.denominator) });
  const equal = (a: Rational, b: Rational) => a.n * b.d === b.n * a.d;
  const sum = (values: typeof edges): Rational => values.reduce((a, value) => {
    const b = rational(value); return { n: a.n * b.d + b.n * a.d, d: a.d * b.d };
  }, { n: 0n, d: 1n });
  const incoming = new Map(nodes.map(node => [node.id, edges.filter(edge => edge.to === node.id)]));
  const outgoing = new Map(nodes.map(node => [node.id, edges.filter(edge => edge.from === node.id)]));
  if (nodes.filter(node => node.kind === 'input').length !== 1) errors.push('Требуется ровно один вход');
  const depths = new Map<string, number>();
  const remaining = new Set(nodes.map(node => node.id));
  while (remaining.size) {
    let advanced = false;
    for (const id of remaining) {
      const node = ids.get(id)!; const ins = incoming.get(id)!; const outs = outgoing.get(id)!;
      if (ins.some(edge => !depths.has(edge.from))) continue;
      advanced = true; remaining.delete(id);
      const device = node.kind === 'split' || node.kind === 'merge';
      const depth = Math.max(0, ...ins.map(edge => depths.get(edge.from)!)) + Number(device);
      depths.set(id, depth);
      if (depth > maxDepth || node.depth !== depth) errors.push(`Неверная глубина: ${id}`);
      if (node.kind === 'input') {
        if (ins.length || outs.length !== 1 || !equal(sum(outs), { n: 1n, d: 1n })) errors.push(`Неверный вход: ${id}`);
      } else if (node.kind === 'output') {
        if (ins.length !== 1 || outs.length) errors.push(`Неверный выход: ${id}`);
      } else {
        const ports = node.kind === 'split' ? ins.length === 1 && [2, 3].includes(outs.length) : [2, 3].includes(ins.length) && outs.length === 1;
        if (!ports) errors.push(`Неверное число портов: ${id}`);
        if (!equal(sum(ins), sum(outs))) errors.push(`Нарушен баланс: ${id}`);
        if (node.kind === 'split' && outs.some(edge => !equal(rational(edge), rational(outs[0])))) errors.push(`Неравные выходы: ${id}`);
      }
    }
    if (!advanced) { errors.push('Логистический цикл'); break; }
  }
  const outputs = nodes.filter(node => node.kind === 'output').flatMap(node => incoming.get(node.id)!);
  const canonical = (values: { numerator: number; denominator: number }[]) => values.map(value => fraction(value.numerator, value.denominator)).sort((a, b) => {
    const diff = BigInt(a.numerator) * BigInt(b.denominator) - BigInt(b.numerator) * BigInt(a.denominator);
    return diff < 0n ? -1 : diff > 0n ? 1 : 0;
  }).map(fractionId).join(',');
  if (canonical(outputs) !== canonical(distribution.shares) || distribution.id !== canonical(distribution.shares)) errors.push('Вектор долей не соответствует выходам');
  if (!equal(sum(outputs), { n: 1n, d: 1n })) errors.push('Сумма выходов должна равняться единице');
  if (distribution.depth !== Math.max(0, ...depths.values())) errors.push('Неверная общая глубина');
  if (distribution.splitters !== nodes.filter(node => node.kind === 'split').length || distribution.mergers !== nodes.filter(node => node.kind === 'merge').length) errors.push('Неверное число устройств');
  return errors;
}
