import { describe, expect, it } from 'vitest';
import { buildComplexity, simplerMachineAllowance } from '../packages/domain/complexity';
import { parallelLines } from '../packages/domain/transport';
import type { StepResult } from '../packages/domain/types';

const step = (recipeId: string, inputs: [string, number][], outputs: [string, number][], cycles = 1): StepResult => ({
  recipeId, cycles, machines: 1, installedMachines: 1, power: 4, powerMax: 4,
  inputs: inputs.map(([itemId, rate]) => ({ itemId, rate })), outputs: outputs.map(([itemId, rate]) => ({ itemId, rate })),
});

describe('buildComplexity', () => {
  it('считает уникальные рецепты и внутренние предметы цепочки', () => {
    const steps = [
      step('iron-ingot', [['iron-ore', 30]], [['iron-ingot', 30]]),
      step('iron-ingot', [['iron-ore', 30]], [['iron-ingot', 30]]),
      step('iron-plate', [['iron-ingot', 60]], [['iron-plate', 40]]),
    ];
    expect(buildComplexity({ targets: [{ itemId: 'iron-plate', rate: 40, weight: 1, scale: 1 }] }, { steps }))
      .toEqual({ distinctRecipes: 2, intermediateItems: 1 });
  });
  it('учитывает цикл и побочный продукт, исключает целевой продукт и простаивающие линии', () => {
    const steps = [
      step('a', [['ore', 10], ['water', 5]], [['x', 10], ['by', 2]]),
      step('b', [['x', 10], ['by', 2]], [['target', 5], ['water', 5]]),
      step('c', [['target', 1]], [['other', 1]]),
      step('idle', [['ore', 0]], [['y', 0]], 0),
    ];
    // x, by, water — внутренние; target выпускается и частично потребляется, но это цель.
    expect(buildComplexity({ targets: [{ itemId: 'target', rate: 4, weight: 1, scale: 1 }] }, { steps }))
      .toEqual({ distinctRecipes: 3, intermediateItems: 3 });
  });
});

describe('buildComplexity в режиме партии', () => {
  it('целями считает позиции партии, а не устаревшие цели плана', () => {
    const steps = [
      step('a', [['ore', 10]], [['target', 5], ['other', 2]]),
      step('b', [['target', 1], ['other', 2]], [['final', 1]]),
    ];
    const plan = { targets: [{ itemId: 'other', rate: 1, weight: 1, scale: 1 }], batch: { minutes: 1, items: [{ itemId: 'target', required: 10, stock: 0 }] } };
    // target — цель партии (исключён), other — внутренний предмет.
    expect(buildComplexity(plan, { steps })).toEqual({ distinctRecipes: 2, intermediateItems: 1 });
    // Если other не потребляется, внутренним остаётся ничто: цель партии target исключена.
    const open = [step('a', [['ore', 10]], [['target', 5], ['other', 2]]), step('b', [['target', 1]], [['final', 1]])];
    expect(buildComplexity(plan, { steps: open })).toEqual({ distinctRecipes: 2, intermediateItems: 0 });
  });
});

describe('simplerMachineAllowance', () => {
  it.each([[0, 10, 0], [2, 10, 1], [10, 10, 1], [20, 10, 2], [3, 0, 0], [5, 1000, 50]])('минимум %i, %i%% → +%i', (minimum, percent, extra) => {
    expect(simplerMachineAllowance(minimum, percent)).toBe(extra);
  });
});

describe('parallelLines', () => {
  it.each([[0, 60, 0], [1e-9, 60, 1], [60, 60, 1], [60 * (1 + 1e-10), 60, 1], [60 * (1 + 1e-6), 60, 2], [61, 60, 2], [600, 300, 2]])('%f при %f → %i', (rate, capacity, lines) => {
    expect(parallelLines(rate, capacity)).toBe(lines);
  });
});
