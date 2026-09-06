import { describe, expect, it } from 'vitest';
import { groupRecipes, matchesRecipe, recipeMetrics, recipeAvailability } from '../apps/web/src/recipeCatalog';
import { createDefaultPlan } from '../packages/domain/defaults';
import type { Catalog, Recipe } from '../packages/domain/types';
import gameCatalog from '../packages/game-data/catalog.json';
const catalog = gameCatalog as Catalog;
const screw = catalog.recipes.find(r => r.id === 'screw')!;
describe('каталог рецептов', () => {
  it('поиск винтов отличает производителя от потребителя, учитывает ё и английский', () => {
    const consumer = catalog.recipes.find(r => r.inputs.some(i => i.itemId === 'screw') && !r.outputs.some(i => i.itemId === 'screw'))!;
    expect(matchesRecipe(catalog, screw, 'винт', 'produces')).toBe(true);
    expect(matchesRecipe(catalog, screw, 'винт', 'uses')).toBe(false);
    expect(matchesRecipe(catalog, consumer, 'винт', 'produces')).toBe(false);
    expect(matchesRecipe(catalog, consumer, 'винт', 'uses')).toBe(true);
    expect(matchesRecipe(catalog, consumer, 'screw', 'all')).toBe(true);
    expect(matchesRecipe(catalog, { ...screw, name: 'Литё' }, 'лить', 'all')).toBe(false);
    expect(matchesRecipe(catalog, { ...screw, name: 'Литё' }, 'лите', 'all')).toBe(true);
  });
  it('группирует альтернативы с базовым продуктом, сохраняя порядок продуктов каталога', () => {
    const other = { ...screw, id: 'other', outputs: [{ itemId: 'iron-plate', amount: 1 }] };
    const alt = { ...screw, id: 'alt', alternate: true };
    const groups = groupRecipes([screw, other, alt]);
    expect(groups[0].products.map(p => p.recipes.map(r => r.id))).toEqual([['screw', 'alt'], ['other']]);
  });
  it('вычисляет поток и энергию на единицу при 50%, с явным выбранным выходом для побочных продуктов', () => {
    const recipe: Recipe = { ...screw, seconds: 6, power: 4, inputs: [{ itemId: 'iron-rod', amount: 3 }], outputs: [{ itemId: 'screw', amount: 2 }, { itemId: 'iron-plate', amount: 1 }] };
    const metrics = recipeMetrics(catalog, recipe, 50, 'minute', 'screw');
    expect(metrics.inputs[0].amount).toBe(15); expect(metrics.outputs[0].amount).toBe(10);
    expect(metrics.power).toBeCloseTo(1.6, 6); expect(metrics.energyPerUnit).toBeCloseTo(.16, 6);
    expect(recipeMetrics(catalog, recipe, 50, 'unit', 'iron-plate').inputs[0].amount).toBe(3);
    expect(recipeMetrics(catalog, recipe, 50, 'cycle', 'screw').inputs[0].amount).toBe(3);
  });
  it('разрешённый в плане рецепт остаётся закрытым в мире', () => {
    const plan = createDefaultPlan(catalog);
    Object.assign(plan, { world: { id: 'w', revision: 1, unlockedRecipeIds: [], unlockedBuildingIds: catalog.buildings.map(b => b.id), beltId: plan.settings.beltId, pipeId: plan.settings.pipeId, overclockUnlocked: false, unlockedMilestoneIds: [] } });
    const availability = recipeAvailability(catalog, plan, screw);
    expect(availability.enabled).toBe(true); expect(availability.opened).toBe(false); expect(availability.usable).toBe(false);
    expect(availability.reasons.length).toBeGreaterThan(0);
  });
});
