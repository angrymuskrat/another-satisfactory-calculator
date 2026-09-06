// Нормализованный каталог — изменённое производное от Kirk McDonald (Apache-2.0)
// и CommunityResources © Coffee Stain Studios. См. THIRD_PARTY_NOTICES.md.
// Офлайн: node scripts/import-game-data.mjs. Иконки: добавить --download-icons.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const path = p => resolve(root, p);
const json = p => JSON.parse(readFileSync(path(p), 'utf8'));
const output = (p, value) => writeFileSync(path(p), JSON.stringify(value, null, 2) + '\n');
const sourcePath = 'packages/game-data/source/';
const up = json(sourcePath + 'upstream.json');
const overrides = json('packages/game-data/overrides.json');
const tree = json(sourcePath + 'upstream-tree.json').tree;
const readDocs = lang => JSON.parse(gunzipSync(readFileSync(path(`${sourcePath}Docs-${lang}.json.gz`))).toString('utf16le').replace(/^\uFEFF/, '')).flatMap(g => g.Classes.map(c => ({ ...c, nativeClass: g.NativeClass })));
const en = readDocs('en-US'), ru = new Map(readDocs('ru').map(c => [c.ClassName, c]));
const byClass = new Map(en.map(c => [c.ClassName, c]));
const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const localized = c => ru.get(c.ClassName)?.mDisplayName || c.mDisplayName;
const sourceFiles = ['upstream.json', 'LICENSE.upstream', 'upstream-tree.json', 'Docs-en-US.json.gz', 'Docs-ru.json.gz'];
const hashes = Object.fromEntries(sourceFiles.map(f => [f, createHash('sha256').update(readFileSync(path(sourcePath + f))).digest('hex')]));
const pinned = json(sourcePath + 'provenance.json');
for (const [file, hash] of Object.entries(pinned.sha256)) if (hashes[file] !== hash) throw new Error(`Исходный файл изменён: ${file}`);
const report = { schemaVersion: 1, gameVersion: overrides.gameVersion, steamBuildId: overrides.steamBuildId, hashes, counts: {}, recipeClasses: {}, changes: [], excluded: [], unmatchedUpstream: [], missingIcons: [], variablePower: [], notes: overrides.notes };
const itemData = en.filter(c => c.mForm && c.mDisplayName && !c.nativeClass.includes('FGBuildingDescriptor'));
const mappedItems = new Map();
const upstreamItems = new Map();
for (const u of [...up.items, ...up.fluids]) {
  const game = overrides.itemAliases[u.key_name] ? byClass.get(overrides.itemAliases[u.key_name]) : itemData.find(c => norm(c.mDisplayName) === norm(u.name));
  if (!game) throw new Error(`Предмет upstream не сопоставлен: ${u.key_name}`);
  mappedItems.set(game.ClassName, u.key_name);
  upstreamItems.set(u.key_name, u);
}
const gameBuildings = new Map(), buildingData = new Map();
for (const u of up.buildings.filter(b => b.key_name !== 'nuclear-power-plant')) {
  const game = en.find(c => c.ClassName.startsWith('Build_') && norm(c.mDisplayName || '') === norm(u.name));
  if (!game || !game.nativeClass.includes('Manufacturer')) continue;
  gameBuildings.set(game.ClassName, u.key_name);
  buildingData.set(u.key_name, game);
}
const ingredients = text => [...text.matchAll(/ItemClass="[^\"]*\.([A-Za-z0-9_]+)'",Amount=([\d.]+)/g)].map(m => ({ className: m[1], amount: Number(m[2]) }));
const production = [];
for (const game of en.filter(c => c.nativeClass.endsWith(".FGRecipe'"))) {
  const buildingClass = [...gameBuildings.keys()].find(c => (game.mProducedIn || '').includes(`.${c}`));
  const seasonal = Boolean(game.mRelevantEvents) || /Xmas|Christmas|Fireworks|Snowball|CandyCane/.test(game.ClassName);
  if (!buildingClass || seasonal) {
    report.excluded.push({ id: game.ClassName, name: localized(game), reason: seasonal ? 'seasonal' : (game.mProducedIn || '').includes('BuildGun') ? 'construction' : 'manual-or-unsupported-building' });
    continue;
  }
  const input = ingredients(game.mIngredients || ''), out = ingredients(game.mProduct || '');
  if (!out.length) throw new Error(`Нет продуктов: ${game.ClassName}`);
  for (const i of [...input, ...out]) {
    if (!byClass.get(i.className)?.mForm) throw new Error(`Неизвестный предмет: ${i.className}`);
    if (!mappedItems.has(i.className)) {
      if (!overrides.newItemIds[i.className]) throw new Error(`Назначьте стабильный ID предмету ${i.className} в overrides.json`);
      mappedItems.set(i.className, overrides.newItemIds[i.className]);
    }
  }
  production.push({ game, buildingClass, input, out });
}

function category(game, id, fluid) {
  const n = game.mDisplayName;
  if (/SpaceElevatorPart/.test(game.ClassName)) return 'space';
  if (up.resources.some(r => r.key_name === id)) return 'resources';
  if (/Packaged|Empty Canister|Empty Fluid Tank/.test(n)) return 'packaging';
  if (/Waste|Uranium|Plutonium|Ficsonium/.test(n)) return 'nuclear';
  if (/SAM|Ficsite|Dark Matter|Photonic|Diamond|Time Crystal|Power Shard|Singularity/.test(n)) return 'quantum';
  if (/Ingot/.test(n)) return 'ingots';
  if (/Quartz|Silica|Copper Powder|Aluminum Scrap/.test(n)) return 'minerals';
  if (/Biomass|Biofuel|Leaves|Wood|Remains|Protein|Mycelia|DNA/.test(n)) return 'biomass';
  if (fluid || /Fuel|Petroleum|Polymer|Rubber|Plastic/.test(n)) return 'oil';
  if (/Computer|Processor|Oscillator|Connector|Server|Control|Radio/.test(n)) return 'communications';
  if (/Wire|Cable|Circuit|Limiter|Battery/.test(n)) return 'electronics';
  if (/Motor|Rotor|Stator|Frame|Cooling|Heat Sink|Pressure/.test(n)) return 'industrial';
  if (/Plate|Rod|Screw|Beam|Pipe|Concrete|Casing|Sheet/.test(n)) return 'standard';
  return 'equipment';
}
const items = [...mappedItems].map(([className, id]) => {
  const game = byClass.get(className), fluid = game.mForm !== 'RF_SOLID';
  return { id, name: localized(game), nameEn: game.mDisplayName, category: overrides.categoryLabels[category(game, id, fluid)], fluid, raw: up.resources.some(r => r.key_name === id), sinkable: !fluid && Number(game.mResourceSinkPoints) > 0 };
});
const itemById = new Map(items.map(i => [i.id, i]));
const documentedBuildingPower = { accelerator: 1000, converter: 250, 'quantum-encoder': 1000 };
const buildings = [...buildingData].map(([id, game]) => ({ id, name: localized(game), nameEn: game.mDisplayName, power: Number(game.mPowerConsumption) || documentedBuildingPower[id], ...(game.mEstimatedMaximumPowerConsumption ? { powerMax: Number(game.mEstimatedMaximumPowerConsumption) } : {}) }));
const sink = byClass.get('Build_ResourceSink_C');
buildings.push({ id: 'awesome-sink', name: localized(sink), nameEn: sink.mDisplayName, power: Number(sink.mPowerConsumption) });
const convert = a => a.map(i => ({ itemId: mappedItems.get(i.className), amount: i.amount / (byClass.get(i.className).mForm === 'RF_SOLID' ? 1 : 1000) }));
const mappedRecipes = new Set();
const recipes = production.map(({ game, buildingClass, input, out }) => {
  const u = up.recipes.find(r => overrides.recipeAliases[r.key_name] === game.ClassName) || up.recipes.find(r => norm(r.name) === norm(game.mDisplayName));
  const id = u?.key_name || overrides.newRecipeIds[game.ClassName];
  if (!id) throw new Error(`Назначьте стабильный ID рецепту ${game.ClassName} в overrides.json`);
  if (report.recipeClasses[id]) throw new Error(`Повторный ID рецепта: ${id}`);
  report.recipeClasses[id] = game.ClassName;
  const outputs = convert(out), inputs = convert(input), buildingId = gameBuildings.get(buildingClass);
  if (u) mappedRecipes.add(u.key_name);
  const recipe = { id, name: localized(game), nameEn: game.mDisplayName, category: itemById.get(outputs[0].itemId).category, buildingId, seconds: Number(game.mManufactoringDuration), inputs, outputs, alternate: game.ClassName.startsWith('Recipe_Alternate_') };
  if (game.mDisplayName.startsWith('Unpackage')) recipe.category = overrides.categoryLabels.packaging;
  if (buildingData.get(buildingId).nativeClass.includes('VariablePower')) {
    const constant = Number(game.mVariablePowerConsumptionConstant), factor = Number(game.mVariablePowerConsumptionFactor);
    const description = byClass.get(out[0].className).mDescription || '';
    const documentedAverage = buildingId === 'converter' ? undefined : description.match(/\(([\d.]+)\s*MW average\)/)?.[1];
    recipe.power = documentedAverage ? Number(documentedAverage) : documentedBuildingPower[buildingId];
    recipe.powerMax = constant + factor;
    if (!Number.isFinite(recipe.power) || recipe.power < constant || recipe.power > recipe.powerMax) throw new Error(`Не подтверждена средняя мощность: ${id}`);
    report.variablePower.push({ id, minimum: constant, documentedAverage: recipe.power, maximum: recipe.powerMax, source: documentedAverage ? `Docs-en-US:${out[0].className}.mDescription` : 'source/power-evidence.json', curveExtractedFromBuild: false });
  }
  if (!u) report.changes.push({ id, gameClass: game.ClassName, kind: 'added' });
  else {
    const previous = { seconds: u.time, inputs: u.ingredients.map(([itemId, amount]) => ({itemId, amount})), outputs: u.products.map(([itemId, amount]) => ({itemId, amount})), buildingId: up.buildings.find(b => b.category === u.category)?.key_name };
    const current = { seconds: recipe.seconds, inputs, outputs, buildingId };
    if (JSON.stringify(previous) !== JSON.stringify(current)) report.changes.push({ id, gameClass: game.ClassName, kind: 'changed', previous, current });
  }
  return recipe;
});
for (const u of up.recipes.filter(r => !mappedRecipes.has(r.key_name))) report.unmatchedUpstream.push({ id: u.key_name, reason: u.category === 'nuke-reacting' ? 'generation-excluded' : 'not-present-as-supported-game-recipe' });
// FGRecipe.h: меньший mManufacturingMenuPriority расположен раньше.
// Порядок самих групп и правила при равных приоритетах дамп не подтверждает.
const recipePriority = recipe => Number(byClass.get(report.recipeClasses[recipe.id]).mManufacturingMenuPriority);
recipes.sort((a,b) => a.category.localeCompare(b.category, 'ru') || recipePriority(a)-recipePriority(b) || a.name.localeCompare(b.name, 'ru'));
const miners = up.miners.map(u => {
  const className = {'miner-mk1':'Build_MinerMk1_C','miner-mk2':'Build_MinerMk2_C','miner-mk3':'Build_MinerMk3_C','oil-pump':'Build_OilPump_C','water-extractor':'Build_WaterPump_C'}[u.key_name];
  const game = byClass.get(className);
  const resourceIds = u.category === 'mineral' ? up.resources.filter(r => r.category === 'mineral').map(r => r.key_name) : [u.category === 'oil' ? 'crude-oil' : 'water'];
  const rate = Number(game.mItemsPerCycle) * 60 / Number(game.mExtractCycleTime) / (u.category === 'mineral' ? 1 : 1000);
  return { id: u.key_name, name: localized(game), rate, power: Number(game.mPowerConsumption), resourceIds };
});
const belts = up.belts.map((u, i) => { const game = byClass.get(`Build_ConveyorBeltMk${i+1}_C`); return {id:u.key_name, name:localized(game), rate:Number(game.mSpeed)/2}; });
const pipes = up.pipes.map((u,i) => {const game = byClass.get(i ? 'Build_PipelineMK2_C' : 'Build_Pipeline_C'); return {id:u.key_name, name:localized(game), rate:Number(game.mFlowLimit)*60}; });

const iconTasks = [];
mkdirSync(path('apps/web/public/icons'), {recursive:true});
for (const entry of [...items, ...buildings]) {
  const u = upstreamItems.get(entry.id) || up.buildings.find(b => b.key_name === entry.id);
  const asset = tree.find(f => f.path === `images/${u?.name || entry.nameEn}.png`);
  if (!asset) {report.missingIcons.push(entry.id); continue;}
  entry.icon = `/icons/${entry.id}.png`;
  iconTasks.push({id:entry.id, upstreamPath:asset.path, gitBlobSha:asset.sha, size:asset.size});
}
if (process.argv.includes('--download-icons')) {
  const queue = [...iconTasks];
  await Promise.all(Array.from({length:8}, async () => {
    while(queue.length) {
      const asset = queue.shift(), dest = path(`apps/web/public/icons/${asset.id}.png`);
      if (existsSync(dest)) continue;
      const url = `https://raw.githubusercontent.com/KirkMcDonald/satisfactory-calculator/c5664fc8fba4ff7dcb3f29f84f74278f497e9bb6/${asset.upstreamPath.split('/').map(encodeURIComponent).join('/')}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Icon HTTP ${res.status}: ${url}`);
      const data = Buffer.from(await res.arrayBuffer());
      const sha = createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');
      if (sha !== asset.gitBlobSha) throw new Error(`Icon checksum: ${asset.id}`);
      writeFileSync(dest, data);
    }
  }));
}
const catalog = { version: `steam-${overrides.steamBuildId}-v1`, provenance: {source: 'Satisfactory CommunityResources Docs en-US/ru; https://github.com/KirkMcDonald/satisfactory-calculator', commit: 'c5664fc8fba4ff7dcb3f29f84f74278f497e9bb6', importedAt: overrides.importedAt, verified: false, notes: overrides.notes}, items, buildings, recipes, miners, belts, pipes, categories: Object.values(overrides.categoryLabels) };
report.counts = { upstreamRecipes:up.recipes.length, gameRecipes:en.filter(c=>c.nativeClass.endsWith(".FGRecipe'")).length, items:items.length, buildings:buildings.length, recipes:recipes.length, alternates:recipes.filter(r=>r.alternate).length, excluded:report.excluded.length, icons:iconTasks.length };
report.itemClasses = Object.fromEntries([...mappedItems].map(([className,id])=>[id,className]));
report.buildingClasses = Object.fromEntries([...gameBuildings].map(([className,id])=>[id,className]));
report.verification = { quantitiesAndDuration:'game-docs', buildingPower:'game-docs', recipePowerRanges:'game-docs', averagePower:'game-description-and-official-wiki', itemLocalization:'game-ru-docs', menuCategories:'approximate-manual', mineralsOilWater:'game-docs', transport:'game-docs; belt mSpeed/2, pipe mFlowLimit*60', resourceWellNodes:'unsupported' };
report.menuEvidence = {
  source: 'source/menu-evidence.json',
  categoryClassesExported: en.filter(c => /\.FG(?:Item)?Category'/.test(c.nativeClass)).length,
  itemCategoryFieldsExported: [...mappedItems.keys()].filter(id => 'mCategory' in byClass.get(id)).length,
  recipeCategoryOverridesExported: production.filter(({game}) => 'mOverriddenCategory' in game).length,
  recipePrioritiesExported: production.filter(({game}) => 'mManufacturingMenuPriority' in game).length,
  recipePriorities: Object.fromEntries(recipes.map(r => [r.id,recipePriority(r)])),
  groupNamesAndOrderVerified: false,
  recipePriorityOrderApplied: true,
  equalPriorityOrder: 'alphabetical-ru; not-verified-in-game'
};
output('packages/game-data/catalog.json', catalog);
output('packages/game-data/audit-report.json', report);
output('packages/game-data/source/icon-manifest.json', iconTasks);
console.log(JSON.stringify(report.counts));
