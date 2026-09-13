export interface BeltNetwork {
  itemId: string;
  nodes: { id: string; kind: 'supply' | 'demand' | 'split' | 'merge' }[];
  edges: { from: string; to: string; rate: number }[];
}
export interface BeltEndpoint { id: string; direction: 'supply' | 'demand'; rate: number }

/** Recompute degrees, balance and longest device path; do not trust solver metadata. */
export function validateBeltNetwork(graph: BeltNetwork, endpoints: BeltEndpoint[], depth: number, capacity: number): string[] {
  const errors: string[] = [];
  if (![1, 2, 3, 4].includes(depth)) errors.push('Недопустимая максимальная глубина конвейерной схемы.');
  if (!Number.isFinite(capacity) || capacity <= 0) errors.push('Недопустимая пропускная способность конвейера.');
  if (new Set(endpoints.map(endpoint => endpoint.id)).size !== endpoints.length) errors.push('Повторяющиеся физические концы конвейера.');
  if (endpoints.some(endpoint => !Number.isFinite(endpoint.rate) || endpoint.rate < 0)) errors.push('Недопустимый расход физического конца конвейера.');
  if (errors.length) return errors;
  const tolerance = (scale: number) => Math.min(1e-7 + scale * 1e-8, scale * 1e-6);
  const close = (a: number, b: number) => Number.isFinite(a + b) && Math.abs(a - b) <= tolerance(Math.max(Math.abs(a), Math.abs(b)));
  const nodes = new Map(graph.nodes.map(n => [n.id, n]));
  if (nodes.size !== graph.nodes.length) errors.push('Повторяющиеся узлы конвейерной схемы.');
  const expected = new Map(endpoints.map(e => [e.id, e]));
  const incoming = new Map(graph.nodes.map(n => [n.id, [] as BeltNetwork['edges']]));
  const outgoing = new Map(graph.nodes.map(n => [n.id, [] as BeltNetwork['edges']]));
  for (const edge of graph.edges) {
    if (!nodes.has(edge.from) || !nodes.has(edge.to)) { errors.push('Связь с неизвестным узлом конвейера.'); continue; }
    if (!Number.isFinite(edge.rate) || edge.rate <= 0 || edge.rate > capacity + tolerance(capacity)) errors.push('Недопустимый расход конвейера.');
    incoming.get(edge.to)!.push(edge); outgoing.get(edge.from)!.push(edge);
  }
  for (const node of graph.nodes) {
    const ins = incoming.get(node.id)!, outs = outgoing.get(node.id)!;
    const input = ins.reduce((s, e) => s + e.rate, 0), output = outs.reduce((s, e) => s + e.rate, 0);
    if (node.kind === 'supply' || node.kind === 'demand') {
      const endpoint = expected.get(node.id);
      if (!endpoint || endpoint.direction !== node.kind) errors.push('Неизвестный физический конец конвейера.');
      else if (!close(node.kind === 'supply' ? output : input, endpoint.rate)) errors.push(`Не сходится поток конца конвейера: ${node.id}.`);
      if (endpoint && (node.kind === 'supply' ? outs.length : ins.length) !== (endpoint.rate > 0 ? 1 : 0)) errors.push('Не совпадает число подключений физического конца конвейера.');
      if (node.kind === 'supply' ? ins.length !== 0 || outs.length > 1 : outs.length !== 0 || ins.length > 1) errors.push('У физического конца конвейера более одного соединения.');
    } else {
      if (!close(input, output)) errors.push('Нарушен баланс устройства конвейера.');
      if (node.kind === 'split') {
        if (ins.length !== 1 || ![2, 3].includes(outs.length)) errors.push('Разделитель должен иметь один вход и два или три выхода.');
        if (outs.some(e => !close(e.rate, input / outs.length))) errors.push('Разделитель не делит поток поровну.');
      } else if (node.kind === 'merge') {
        if (![2, 3].includes(ins.length) || outs.length !== 1) errors.push('Соединитель должен иметь два или три входа и один выход.');
      } else errors.push('Неизвестный тип устройства конвейера.');
    }
  }
  for (const endpoint of endpoints) if (endpoint.rate > 0 && !nodes.has(endpoint.id)) errors.push(`Нет физического конца конвейера: ${endpoint.id}.`);
  const degrees = new Map(graph.nodes.map(n => [n.id, incoming.get(n.id)!.length]));
  const queue = graph.nodes.filter(n => degrees.get(n.id) === 0).map(n => n.id);
  const depths = new Map<string, number>();
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i], node = nodes.get(id)!;
    const d = (depths.get(id) ?? 0) + (node.kind === 'split' || node.kind === 'merge' ? 1 : 0);
    if (d > depth) errors.push('Превышена максимальная глубина конвейерной схемы.');
    for (const edge of outgoing.get(id)!) {
      depths.set(edge.to, Math.max(depths.get(edge.to) ?? 0, d));
      degrees.set(edge.to, degrees.get(edge.to)! - 1);
      if (degrees.get(edge.to) === 0) queue.push(edge.to);
    }
  }
  if (queue.length !== nodes.size) errors.push('Возвратная лента внутри распределительного блока.');
  return errors;
}
