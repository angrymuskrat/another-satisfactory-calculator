import { beforeAll, expect, it } from 'vitest';
import catalogJson from '../packages/game-data/catalog.json';
import type { Catalog } from '../packages/domain/types';
import { createDefaultPlan } from '../packages/domain/defaults';
import { createHighs } from '../packages/solver/highs';
import { solve } from '../packages/solver/solve';
import { validateResult } from '../packages/solver/validate';
import { buildConstruction } from '../packages/domain/construction';
const catalog = catalogJson as Catalog;
let highs: Awaited<ReturnType<typeof createHighs>>;
beforeAll(async () => { highs = await createHighs(); });
it('импортирует базовые семейства с точными расходами на 100%', () => {
  const coal = catalog.recipes.find(r => r.id === 'generate-coal')!;
  expect(coal?.generation?.power).toBe(75);
  expect(coal.inputs).toEqual([{ itemId: 'coal', amount: 15 }, { itemId: 'water', amount: 45 }]);
  const oil = catalog.recipes.find(r => r.id === 'generate-fuel')!;
  expect(oil?.generation?.power).toBe(250); expect(oil.inputs[0].amount).toBe(20);
  const nuclear = catalog.recipes.find(r => r.id === 'generate-uranium-fuel-rod')!;
  expect(nuclear?.generation?.power).toBe(2500);
  expect(nuclear.inputs).toEqual([{ itemId: 'uranium-fuel-rod', amount: 0.2 }, { itemId: 'water', amount: 240 }]);
  expect(nuclear.outputs).toEqual([{ itemId: 'uranium-waste', amount: 10 }]);
  for (const r of [coal, oil, nuclear]) {
    expect(catalog.buildings.find(b => b.id === r.buildingId)?.buildCost?.length).toBeGreaterThan(0);
    expect(catalog.unlocks?.some(u => u.buildingIds.includes(r.buildingId) && u.recipeIds.includes(r.id))).toBe(true);
  }
});
it('покрывает локальный пик, учитывает топливо и отделяет энергию импорта', () => {
  const plan = createDefaultPlan(catalog); plan.mode = 'target'; plan.settings.pareto = true; plan.settings.selfSupply = 'coal';
  plan.targets = [{ itemId: 'iron-ingot', rate: 30, weight: 1, scale: 1 }];
  plan.settings.enabledRecipeIds = ['iron-ingot', 'generate-coal']; plan.settings.powerReserve = 10;
  plan.sources = ['iron-ore', 'coal', 'water'].map(itemId => ({ id: itemId, itemId, kind: 'flow' as const, limit: 100, count: 1, purity: 1 as const, minerId: '', clock: 100, importPower: 10 }));
  const result = solve(catalog, plan, highs);
  expect(result.status, JSON.stringify(result)).toBe('approximate');
  expect(result.generation?.power).toBe(75); expect(result.generation!.localPeak + 10).toBeLessThanOrEqual(75);
  expect(result.generation!.importPower).toBeGreaterThan(75);
  expect(result.steps.find(s => s.recipeId === 'generate-coal')?.installedMachines).toBe(1);
  expect(validateResult(catalog, plan, result).errors).toEqual([]);
  const forged = structuredClone(result); forged.fuelProvenance!.sources = [];
  expect(validateResult(catalog, plan, forged).errors).toContain('Топливо не обеспечено выбранным первичным сырьём.');
  expect(buildConstruction(catalog, plan, result).production.some(g => g.recipeId === 'generate-coal')).toBe(true);
  result.generation!.power = 1000; expect(validateResult(catalog, plan, result).errors).toContain('Неверная сводка генерации.');
  plan.settings.inputLimits = { water: 0 }; expect(solve(catalog, plan, highs).status).not.toBe('approximate');
});
it.each(['crude-oil', 'uranium'] as const)('совместно считает топливную цепочку %s, отходы и ограничения', family => {
  // Small hand-computable factory using the imported generator coefficients;
  // the synthetic fuel recipe isolates generation from the large game chain.
  const local = structuredClone(catalog);
  const gen = local.recipes.find(r => r.id === (family === 'uranium' ? 'generate-uranium-fuel-rod' : 'generate-fuel'))!;
  local.recipes.push({ id: 'test-fuel', name: 'test-fuel', nameEn: 'test-fuel', category: 'test', buildingId: 'constructor', seconds: 60,
    inputs: [{ itemId: family, amount: 1 }], outputs: [{ itemId: gen.inputs[0].itemId, amount: 1 }], power: 2, alternate: false });
  local.generationPaths![family].recipeIds.push('test-fuel');
  const plan = createDefaultPlan(local); plan.mode = 'target'; plan.settings.pareto = true; plan.settings.selfSupply = family;
  plan.targets = [{ itemId: 'iron-ingot', rate: 30, weight: 1, scale: 1 }];
  plan.settings.enabledRecipeIds = ['iron-ingot', 'test-fuel', gen.id];
  plan.sources = ['iron-ore', family, 'water'].map(itemId => ({ id: itemId, itemId, kind: 'flow', limit: 500, count: 1, purity: 1, minerId: '', clock: 100 }));
  if (family === 'uranium') plan.exports = [{ itemId: 'uranium-waste', limit: 10, name: 'Переработка другой фабрикой' }];
  const result = solve(local, plan, highs);
  expect(result.status, JSON.stringify(result)).toBe('approximate');
  expect(result.steps.find(s => s.recipeId === gen.id)?.installedMachines).toBe(1);
  expect(result.resources.find(s => s.itemId === family)?.rate).toBeCloseTo(gen.inputs[0].amount, 6);
  expect(validateResult(local, plan, result).errors).toEqual([]);
  if (family === 'uranium') {
    expect(result.exports).toEqual([{ itemId: 'uranium-waste', rate: 10 }]);
    delete plan.exports; expect(solve(local, plan, highs).status).not.toBe('approximate');
  }
  plan.settings.buildingLimits = { [gen.buildingId]: 0 }; expect(solve(local, plan, highs).status).not.toBe('approximate');
});
it('не открывает генератор в мире скрыто и отклоняет импорт готового топлива', () => {
  const plan = createDefaultPlan(catalog); plan.mode = 'target'; plan.settings.pareto = true; plan.settings.selfSupply = 'coal';
  plan.world = { id: 'w', revision: 1, unlockedRecipeIds: ['iron-ingot'], unlockedBuildingIds: ['smelter'], beltId: plan.settings.beltId, pipeId: plan.settings.pipeId, overclockUnlocked: true, unlockedMilestoneIds: [] };
  expect(solve(catalog, plan, highs).message).toContain('генератора');
  delete plan.world; plan.sources.push({ ...plan.sources[0], id: 'fuel', itemId: 'fuel', kind: 'flow' });
  expect(solve(catalog, plan, highs).message).toContain('первичное сырьё');
});
it('выбор угля требует угольное сырьё, не заменяет его преобразованием железа', () => {
  const plan = createDefaultPlan(catalog); plan.mode = 'target'; plan.settings.pareto = true; plan.settings.selfSupply = 'coal';
  plan.targets = [{ itemId: 'iron-ingot', rate: 30, weight: 1, scale: 1 }];
  plan.settings.enabledRecipeIds = ['iron-ingot', 'coal-iron', 'reanimated-sam', 'generate-coal'];
  plan.settings.inputLimits = { coal: 0 };
  plan.sources = ['iron-ore', 'sam', 'water'].map(itemId => ({ id: itemId, itemId, kind: 'flow', limit: 100, count: 1, purity: 1, minerId: '', clock: 100 }));
  expect(solve(catalog, plan, highs).status).not.toBe('approximate');
});
