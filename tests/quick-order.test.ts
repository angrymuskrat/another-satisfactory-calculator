import { beforeAll, expect, it } from 'vitest';
import { firstProductionBlock, quickOrderPlan } from '../apps/web/src/quickOrderPlan';
import { buildConstruction } from '../packages/domain/construction';
import { hasSolution, type Catalog } from '../packages/domain/types';
import gameCatalog from '../packages/game-data/catalog.json';
import { createHighs } from '../packages/solver/highs';
import { solve } from '../packages/solver/solve';

const catalog = gameCatalog as Catalog;
const product = (id: string) => catalog.items.find(item => item.id === id)!;
const plateRecipes = catalog.recipes.filter(recipe => ['iron-plate', 'iron-ingot'].includes(recipe.id));
const smallCatalog = { ...catalog, recipes: plateRecipes };
let highs: Awaited<ReturnType<typeof createHighs>>;
beforeAll(async () => { highs = await createHighs(); });

it('начинает с фиксированного выпуска, обычных рецептов и неограниченного первичного сырья', () => {
  const plan = quickOrderPlan(catalog, product('iron-plate'), 20);
  expect(plan).toMatchObject({
    catalogVersion: catalog.version, mode: 'target', targets: [{ itemId: 'iron-plate', rate: 20 }],
    sources: [], settings: { objective: 'smooth-power', resourcePolicy: 'unlimited-unlisted', clock: 100, allowSink: false },
  });
  expect(plan.settings.enabledRecipeIds).toEqual(catalog.recipes.filter(recipe => !recipe.alternate).map(recipe => recipe.id));
  expect(plan.settings.enabledBuildingIds).toEqual(catalog.buildings.map(building => building.id));
});

it('для 20 пластин показывает 30 руды и первой строит плавильню, пропуская простаивающие линии', () => {
  const plan = quickOrderPlan(smallCatalog, product('iron-plate'), 20);
  const result = solve(smallCatalog, plan, highs);
  expect(hasSolution(result), result.message).toBe(true);
  expect(result.resources.find(row => row.itemId === 'iron-ore')?.rate).toBeCloseTo(30);
  const { production } = buildConstruction(smallCatalog, plan, result);
  const idle = { ...production[0], id: 'aaa', activeDuty: 0, averageInputs: [], averageOutputs: [] };
  const first = firstProductionBlock([idle, ...production.slice().reverse()]);
  expect(first).toMatchObject({ cyclic: false, groups: [{ buildingId: 'smelter', recipeId: 'iron-ingot', count: 1 }] });
  expect(first?.groups[0].averageOutputs[0].rate).toBeCloseTo(30);
});

it('показывает обе части первого замкнутого блока при возврате побочного потока', () => {
  const loopCatalog = { ...smallCatalog, recipes: plateRecipes.map(recipe => recipe.id === 'iron-ingot'
    ? { ...recipe, inputs: [...recipe.inputs, { itemId: 'water', amount: 1 }] }
    : { ...recipe, outputs: [...recipe.outputs, { itemId: 'water', amount: recipe.inputs[0].amount }] }) };
  const plan = quickOrderPlan(loopCatalog, product('iron-plate'), 20);
  const result = solve(loopCatalog, plan, highs);
  expect(hasSolution(result), result.message).toBe(true);
  const block = firstProductionBlock(buildConstruction(loopCatalog, plan, result).production);
  expect(block?.cyclic).toBe(true);
  expect(block?.groups.map(group => group.recipeId).sort()).toEqual(['iron-ingot', 'iron-plate']);
});

it('для прямой подачи жидкости сохраняет рассчитанный поток без выдуманного производственного блока', () => {
  const plan = quickOrderPlan(smallCatalog, product('water'), 90);
  const result = solve(smallCatalog, plan, highs);
  expect(hasSolution(result), result.message).toBe(true);
  expect(result.products).toEqual([{ itemId: 'water', rate: 90 }]);
  expect(result.resources.find(row => row.itemId === 'water')?.rate).toBeCloseTo(90);
  const model = buildConstruction(smallCatalog, plan, result);
  expect(firstProductionBlock(model.production)).toBeNull();
  expect(model.externalSources).toMatchObject([{ itemId: 'water', power: null }]);
});
