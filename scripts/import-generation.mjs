// Производное закреплённых CommunityResources © Coffee Stain Studios.
// Вызывается основным офлайн-импортом после категорий производственных рецептов.
import { unlockCoverage } from './import-p1-game-data.mjs';

export function importGeneration({ en, ru, catalog, report, progression, pinned, hashes, parseIngredients, generationRules }) {
  const byClass = new Map(en.map(c => [c.ClassName, c]));
  const itemIds = new Map(Object.entries(report.itemClasses).map(([id, cls]) => [cls, id]));
  const evidence = [], excluded = [];
  for (const [buildingId, cls] of [['coal-generator', 'Build_GeneratorCoal_C'], ['fuel-generator', 'Build_GeneratorFuel_C'], ['nuclear-power-plant', 'Build_GeneratorNuclear_C']]) {
    const build = byClass.get(cls);
    if (!build || !Array.isArray(build.mFuel)) throw new Error(`Нет данных генератора ${cls}`);
    const power = Number(build.mPowerProduction);
    if (!(power > 0)) throw new Error(`Нет мощности ${cls}`);
    const construction = en.filter(c => c.nativeClass.endsWith(".FGRecipe'") && c.mProducedIn?.includes('.BP_BuildGun_C') && c.mDisplayName === build.mDisplayName
      && parseIngredients(c.mProduct || '').some(p => p.className === cls.replace('Build_', 'Desc_')));
    if (construction.length !== 1 || parseIngredients(construction[0].mProduct)[0]?.amount !== 1) throw new Error(`Не подтверждена стоимость ${cls}`);
    const buildCost = parseIngredients(construction[0].mIngredients).map(c => {
      const itemId = itemIds.get(c.className); if (!itemId || !(c.amount > 0)) throw new Error(`Нет материала ${c.className}`);
      return { itemId, amount: c.amount };
    });
    catalog.buildings.push({ id: buildingId, name: ru.get(cls)?.mDisplayName || build.mDisplayName, nameEn: build.mDisplayName, power: 0, buildCost });
    report.buildCosts.entries.push({ id: buildingId, buildClass: cls, descriptorClass: cls.replace('Build_', 'Desc_'), recipeClass: construction[0].ClassName, recipePath: construction[0].FullName, rawCost: parseIngredients(construction[0].mIngredients), buildCost });
    report.buildingClasses[buildingId] = cls;
    const recipeIds = [];
    for (const mode of build.mFuel) {
      const itemId = itemIds.get(mode.mFuelClass), family = generationRules.fuelFamilies[itemId];
      if (!family) { excluded.push({ generator: cls, fuel: mode.mFuelClass, reason: 'Вне охвата: биотопливо/неподтверждённое семейство' }); continue; }
      if (!Object.hasOwn(generationRules.paths, family)) throw new Error('Неизвестное семейство топлива: ' + family);
      const fuel = byClass.get(mode.mFuelClass), energy = Number(fuel.mEnergyValue);
      const units = fuel.mForm === 'RF_SOLID' ? 1 : 1000;
      if (!(energy > 0)) throw new Error(`Нет теплотворности ${itemId}`);
      const rate = power * 60 / (energy * units);
      const inputs = [{ itemId, amount: rate }], outputs = [];
      if (build.mRequiresSupplementalResource === 'True') {
        const supplemental = itemIds.get(mode.mSupplementalResourceClass);
        if (!supplemental || byClass.get(mode.mSupplementalResourceClass)?.mForm !== 'RF_LIQUID') throw new Error(`Не подтверждена вода ${cls}`);
        inputs.push({ itemId: supplemental, amount: power * Number(build.mSupplementalToPowerRatio) * 60 / 1000 });
      }
      if (mode.mByproduct) {
        const waste = itemIds.get(mode.mByproduct), amount = Number(mode.mByproductAmount);
        if (!waste || !(amount > 0) || byClass.get(mode.mByproduct)?.mForm !== 'RF_SOLID') throw new Error(`Не подтверждены отходы ${cls}`);
        outputs.push({ itemId: waste, amount: rate * amount });
      }
      const id = `generate-${itemId}`; recipeIds.push(id);
      report.recipeClasses[id] = construction[0].ClassName;
      catalog.recipes.push({ id, name: `${ru.get(cls)?.mDisplayName || build.mDisplayName}: ${catalog.items.find(i => i.id === itemId).name}`, nameEn: `${build.mDisplayName}: ${fuel.mDisplayName}`,
        category: 'Генерация (расчёт)', buildingId, seconds: 60, inputs, outputs, alternate: false, power: 0, generation: { power, family } });
      evidence.push({ id, generatorClass: cls, fuelClass: mode.mFuelClass, rawFuel: mode, energy, units, power, supplementalRatio: build.mSupplementalToPowerRatio, inputs, outputs, buildRecipe: construction[0].ClassName });
    }
    let unlocked = false;
    for (const schematic of en.filter(c => c.nativeClass.endsWith(".FGSchematic'"))) {
      if (!schematic.mUnlocks?.some(u => u.Class === 'BP_UnlockRecipe_C' && u.mRecipes?.includes(`.${construction[0].ClassName}`))) continue;
      const unlock = catalog.unlocks?.find(u => u.id === schematic.ClassName);
      if (!unlock) throw new Error(`Нет схемы открытия генератора ${schematic.ClassName}`);
      unlock.buildingIds.push(buildingId); unlock.recipeIds.push(...recipeIds); unlocked = true;
    }
    if (!unlocked) throw new Error(`Не подтверждено открытие ${cls}`);
  }
  catalog.categories.push('Генерация (расчёт)');
  catalog.generationPaths = generationRules.paths;
  for (const path of Object.values(catalog.generationPaths)) {
    if (path.itemIds.some(id => !catalog.items.some(i => i.id === id)) || path.recipeIds.some(id => !catalog.recipes.some(r => r.id === id))) throw new Error('Не подтверждён путь энергетического сырья.');
  }
  progression.coverage.recipes = unlockCoverage(catalog.unlocks, catalog.recipes, 'recipeIds');
  progression.coverage.buildings = unlockCoverage(catalog.unlocks, catalog.buildings, 'buildingIds');
  report.counts.buildings = catalog.buildings.length; report.counts.recipes = catalog.recipes.length;
  catalog.provenance.notes.push('Генерация: закреплённые Docs той же сборки; 100% частоты, полный расход топлива. «Генерация (расчёт)» — служебная группа, не меню игры.');
  return { catalogVersion: catalog.version, steamBuildId: pinned.game.steamBuildId, importedAt: '2026-11-05', source: 'Satisfactory CommunityResources Docs', hashes, verified: true, evidence, excluded, paths: catalog.generationPaths };
}
