import { describe, expect, it, vi } from 'vitest';
import { DistributionSearch, validateDistribution, type Distribution } from '../packages/domain/beltRouting';

function collect(depth: 1 | 2 | 3 | 4, page = 10000) {
  const search = new DistributionSearch(depth);
  const results: Distribution[] = [];
  for (let attempts = 0; attempts < 10000; attempts++) {
    const batch = search.advance({ maxStates: page, maxResults: page });
    results.push(...batch.results);
    if (batch.complete) return results;
  }
  throw new Error('Поиск не завершился');
}

describe('полные распределения конвейеров', () => {
  it.each([[1, 3], [2, 19], [3, 1355]] as const)('исчерпывает глубину %s и выдаёт %s совместных векторов', (depth, count) => {
    const values = collect(depth);
    expect(values).toHaveLength(count);
    expect(new Set(values.map(value => value.id)).size).toBe(count);
    for (const value of values) expect(validateDistribution(value, depth), value.id).toEqual([]);
  });

  it('возобновляется на границах страниц без потерь и дубликатов', () => {
    expect(collect(2, 1)).toEqual(collect(2));
  });

  it('сохраняет свидетели четвёртого уровня при выдаче небольшими страницами', () => {
    const expected = new DistributionSearch(4).advance({ maxStates: 100000, maxResults: 1000 });
    const search = new DistributionSearch(4);
    const actual: Distribution[] = [];
    while (actual.length < expected.results.length) {
      actual.push(...search.advance({ maxStates: 17, maxResults: Math.min(31, 1000 - actual.length) }).results);
    }
    expect(actual).toEqual(expected.results);
    expect(expected.complete).toBe(false);
    for (const value of actual) expect(validateDistribution(value, 4), value.id).toEqual([]);
  });

  it('совпадает с полным перебором размеченных историй второго уровня без склейки состояний', () => {
    const expected = new Set<string>();
    function visit(wires: { flow: number; depth: number }[]) {
      expected.add(wires.map(wire => wire.flow).sort((a, b) => a - b).join(','));
      const eligible = wires.map((wire, index) => wire.depth < 2 ? index : -1).filter(index => index >= 0);
      for (const index of eligible) for (const degree of [2, 3]) {
        visit([...wires.filter((_, other) => other !== index), ...Array.from({ length: degree }, () => ({ flow: wires[index].flow / degree, depth: wires[index].depth + 1 }))]);
      }
      for (let i = 0; i < eligible.length; i++) for (let j = i + 1; j < eligible.length; j++) {
        const combinations = [[eligible[i], eligible[j]], ...eligible.slice(j + 1).map(k => [eligible[i], eligible[j], k])];
        for (const indices of combinations) visit([
          ...wires.filter((_, index) => !indices.includes(index)),
          { flow: indices.reduce((sum, index) => sum + wires[index].flow, 0), depth: 1 + Math.max(...indices.map(index => wires[index].depth)) },
        ]);
      }
    }
    visit([{ flow: 36, depth: 0 }]);
    const actual = new Set(collect(2).map(value => value.shares.map(share => 36 * share.numerator / share.denominator).join(',')));
    expect(actual).toEqual(expected);
  });

  it('сохраняет курсор внутри перебора переходов при частом истечении срока', () => {
    const expected = collect(2);
    const search = new DistributionSearch(2);
    const actual: Distribution[] = [];
    let now = 0;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now++);
    try {
      for (let i = 0; i < 10000; i++) {
        const batch = search.advance({ maxStates: 10000, maxResults: 10000, deadline: now + 3 });
        actual.push(...batch.results);
        if (batch.complete) break;
      }
    } finally { clock.mockRestore(); }
    expect(actual).toEqual(expected);
  });

  it('включает прямую ленту и одновременное получение 1/3 и 2/3', () => {
    const values = collect(2);
    expect(values.find(value => value.id === '1/1')).toMatchObject({ depth: 0, splitters: 0, mergers: 0 });
    expect(values.find(value => value.id === '1/3,2/3')).toMatchObject({ depth: 2, splitters: 1, mergers: 1 });
    expect(values.some(value => value.shares.some(share => share.denominator === 5))).toBe(false);
  });

  it('при истёкшем сроке не обещает полноту и продолжает с того же места', () => {
    const search = new DistributionSearch(4);
    expect(search.advance({ maxStates: 100, maxResults: 100, deadline: Date.now() - 1 })).toEqual({ results: [], complete: false, visited: 1 });
    const next = search.advance({ maxStates: 5, maxResults: 2 });
    expect(next.results).toHaveLength(2);
    expect(next.complete).toBe(false);
  });

  it('независимо отвергает неверные доли, глубину, порты, циклы и метаданные', () => {
    const original = collect(2).find(value => value.id === '1/3,2/3')!;
    const fraction = structuredClone(original);
    fraction.graph.edges[0].numerator++;
    expect(validateDistribution(fraction, 2).length).toBeGreaterThan(0);
    const depth = structuredClone(original);
    depth.graph.nodes.find(node => node.kind === 'merge')!.depth = 0;
    expect(validateDistribution(depth, 2).length).toBeGreaterThan(0);
    const reuse = structuredClone(original);
    reuse.graph.edges.push({ ...reuse.graph.edges[0] });
    expect(validateDistribution(reuse, 2).length).toBeGreaterThan(0);
    const cycle = structuredClone(original);
    const merge = cycle.graph.nodes.find(node => node.kind === 'merge')!;
    const split = cycle.graph.nodes.find(node => node.kind === 'split')!;
    cycle.graph.edges.push({ from: merge.id, to: split.id, numerator: 1, denominator: 3 });
    expect(validateDistribution(cycle, 2).length).toBeGreaterThan(0);
    const meta = structuredClone(original);
    meta.shares[0] = { numerator: 1, denominator: 2 };
    meta.mergers = 0;
    expect(validateDistribution(meta, 2).length).toBeGreaterThan(0);
  });
});
