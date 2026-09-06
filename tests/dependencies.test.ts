import { describe, expect, it } from 'vitest';
import { orderDependencies } from '../packages/domain/dependencies';

const step = (recipeId: string, inputs: string[], outputs: string[]) => ({
  recipeId, inputs: inputs.map(itemId => ({ itemId, rate: 10 })), outputs: outputs.map(itemId => ({ itemId, rate: 10 })),
});

describe('порядок строительства и циклы', () => {
  it('ставит поставщиков раньше потребителей независимо от порядка каталога', () => {
    const steps = [step('motor', ['rotor', 'stator'], ['motor']), step('stator', ['ingot'], ['stator']), step('rotor', ['ingot'], ['rotor']), step('smelt', ['ore'], ['ingot'])];
    const groups = orderDependencies(steps);
    expect(groups.map(g => g.recipeIds)).toEqual([['smelt'], ['rotor'], ['stator'], ['motor']]);
    expect(orderDependencies([...steps].reverse())).toEqual(groups);
  });
  it('сворачивает SCC между входной и выходной стадией с внутренними потоками', () => {
    const groups = orderDependencies([step('finish', ['alumina'], ['ingot']), step('water', [], ['water']), step('bauxite', ['water'], ['alumina']), step('recycle', ['alumina'], ['water'])]);
    expect(groups.map(g => g.recipeIds)).toEqual([['water'], ['bauxite', 'recycle'], ['finish']]);
    expect(groups[1].cyclic).toBe(true);
    expect(groups[1].internalFlows).toEqual([{ itemId: 'alumina', produced: 10, consumed: 10 }, { itemId: 'water', produced: 10, consumed: 10 }]);
  });
  it('показывает самовозврат, сохраняет следовые связи и не создаёт связь по нулю', () => {
    const loop = step('loop', ['water'], ['water']); loop.outputs[0].rate = 1e-12;
    expect(orderDependencies([loop])[0].cyclic).toBe(true);
    loop.outputs[0].rate = 0;
    expect(orderDependencies([loop])[0].cyclic).toBe(false);
    expect(orderDependencies([])).toEqual([]);
  });
});
