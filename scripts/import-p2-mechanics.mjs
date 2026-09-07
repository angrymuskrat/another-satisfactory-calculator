// Производное закреплённых игровых Docs. См. THIRD_PARTY_NOTICES.md.
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
const raw = readFileSync(new URL('packages/game-data/source/Docs-en-US.json.gz', root));
const sha256 = createHash('sha256').update(raw).digest('hex');
const pinned = JSON.parse(readFileSync(new URL('packages/game-data/source/provenance.json', root), 'utf8'));
if (sha256 !== pinned.sha256['Docs-en-US.json.gz']) throw new Error('Изменились исходные Docs.');
const classes = JSON.parse(gunzipSync(raw).toString('utf16le').replace(/^\uFEFF/, '')).flatMap(g => g.Classes.map(c => ({ ...c, nativeClass: g.NativeClass })));
const catalog = JSON.parse(readFileSync(new URL('packages/game-data/catalog.json', root), 'utf8'));
const defaultsRaw = readFileSync(new URL('packages/game-data/source/buildable-defaults.json', root));
const defaultsHash = createHash('sha256').update(defaultsRaw).digest('hex');
if (defaultsHash !== pinned.sha256['buildable-defaults.json']) throw new Error('Изменились исходные настройки подсистемы зданий.');
const defaults = JSON.parse(defaultsRaw);
if (defaults.provenance.steamBuildId !== pinned.game.steamBuildId || defaults.provenance.mappingVerification?.verified !== true
  || !Number.isSafeInteger(defaults.mDefaultProductionShardSlotSize) || defaults.mDefaultProductionShardSlotSize <= 0) throw new Error('Не подтверждён общий размер слота усилителя.');
const report = JSON.parse(readFileSync(new URL('packages/game-data/audit-report.json', root), 'utf8'));
const itemIds = new Map(Object.entries(report.itemClasses).map(([id, cls]) => [cls, id]));
const ingredients = value => [...value.matchAll(/ItemClass="[^\"]*\.([A-Za-z0-9_]+)'",Amount=([\d.]+)/g)].map(m => ({ className: m[1], amount: Number(m[2]) }));
const buildCosts = {}, costEvidence = {};
for (const [id, buildClass] of Object.entries({ 'resource-well-pressurizer': 'Build_FrackingSmasher_C', 'resource-well-extractor': 'Build_FrackingExtractor_C' })) {
  const build = classes.find(c => c.ClassName === buildClass), descriptorClass = buildClass.replace('Build_', 'Desc_');
  const candidates = classes.filter(c => c.nativeClass.endsWith(".FGRecipe'") && c.mDisplayName === build?.mDisplayName
    && c.mProducedIn?.includes('.BP_BuildGun_C') && ingredients(c.mProduct || '').some(p => p.className === descriptorClass));
  if (candidates.length !== 1) throw new Error(`Неоднозначный строительный рецепт: ${id}`);
  const recipe = candidates[0], product = ingredients(recipe.mProduct);
  if (product.length !== 1 || product[0].amount !== 1 || !classes.some(c => c.ClassName === descriptorClass && c.nativeClass.endsWith(".FGBuildingDescriptor'"))) throw new Error(`Не подтверждён продукт: ${id}`);
  const rawCost = ingredients(recipe.mIngredients || '');
  if (!rawCost.length || rawCost.length !== (recipe.mIngredients.match(/ItemClass=/g) || []).length) throw new Error(`Неполная стоимость: ${id}`);
  buildCosts[id] = rawCost.map(({ className, amount }) => {
    const itemId = itemIds.get(className);
    if (!itemId || !catalog.items.some(i => i.id === itemId) || !classes.some(c => c.ClassName === className && c.mForm === 'RF_SOLID') || !Number.isSafeInteger(amount) || amount <= 0) throw new Error(`Не подтверждён материал: ${id}/${className}`);
    return { itemId, amount };
  });
  costEvidence[id] = { buildClass, descriptorClass, recipeClass: recipe.ClassName, recipePath: recipe.FullName, rawCost };
}
const slots = {}, evidence = {};
for (const b of catalog.buildings) {
  const c = classes.find(c => c.ClassName.startsWith('Build_') && c.mDisplayName === b.nameEn);
  if (!c) continue;
  if (c.mCanChangeProductionBoost === 'True' && !['True', 'False'].includes(c.mOverrideProductionShardSlotSize)) throw new Error(`Не подтверждён override усилителя: ${b.id}`);
  slots[b.id] = c.mCanChangeProductionBoost !== 'True' ? 0 : c.mOverrideProductionShardSlotSize === 'True'
    ? Number(c.mProductionShardSlotSize) : defaults.mDefaultProductionShardSlotSize;
  if (!Number.isSafeInteger(slots[b.id]) || slots[b.id] < 0) throw new Error(`Некорректное число слотов: ${b.id}`);
  evidence[b.id] = { className: c.ClassName, slots: c.mProductionShardSlotSize, override: c.mOverrideProductionShardSlotSize,
    effectiveSlots: slots[b.id], canBoost: c.mCanChangeProductionBoost, exponent: c.mProductionBoostPowerConsumptionExponent };
}
const pressurizer = classes.find(c => c.ClassName === 'Build_FrackingSmasher_C');
const extractor = classes.find(c => c.ClassName === 'Build_FrackingExtractor_C');
const data = { provenance: { catalogVersion: catalog.version, source: 'source/Docs-en-US.json.gz', sha256, defaultsSource: 'source/buildable-defaults.json', defaultsSha256: defaultsHash, importedAt: '2026-09-06', verification: 'Механики из закреплённых Docs и assets. Без индивидуального override используется mDefaultProductionShardSlotSize подсистемы зданий. Эффективное число слотов Smelter — 1; исходный ноль Docs не является размером действующего слота.' },
  slots, well: { resourceIds: ['water', 'crude-oil', 'nitrogen-gas'], power: Number(pressurizer.mPowerConsumption), rate: Number(extractor.mItemsPerCycle) / 1000 * 60 / Number(extractor.mExtractCycleTime), buildCosts, costEvidence }, evidence };
writeFileSync(new URL('packages/game-data/p2-mechanics.json', root), JSON.stringify(data, null, 2) + '\n');
