// Производное от локальных CommunityResources © Coffee Stain Studios.
// Вызывается основным офлайн-импортом; никаких сетевых источников или иконок.
export function importP1Data({ en, ru, catalog, report, machineClasses, transportClasses, parseIngredients, hashes, pinned }) {
  const byClass = new Map(en.map(c => [c.ClassName, c]));
  const recipeIds = new Map(Object.entries(report.recipeClasses).map(([id, cls]) => [cls, id]));
  const itemIds = new Map(Object.entries(report.itemClasses).map(([id, cls]) => [cls, id]));
  const refs = value => [...(value || '').matchAll(/\.([A-Za-z0-9_-]+_C)['"]/g)].map(m => m[1]);
  const unique = values => [...new Set(values)];
  const construction = en.filter(c => c.nativeClass.endsWith(".FGRecipe'") && refs(c.mProducedIn).includes('BP_BuildGun_C'));
  const constructionIds = new Map();
  const entries = [];
  for (const [id, buildClass] of Object.entries({ ...machineClasses, ...transportClasses })) {
    const build = byClass.get(buildClass);
    const descriptorClass = buildClass.replace(/^Build_/, 'Desc_');
    // Docs не экспортирует FGBuildingDescriptor.mBuildableClass. Требуем оба
    // независимых совпадения: именование descriptor и точное EN-имя build recipe.
    const candidates = construction.filter(r => r.mDisplayName === build.mDisplayName
      && parseIngredients(r.mProduct || '').some(p => p.className === descriptorClass));
    if (candidates.length !== 1) throw new Error(`Неоднозначный build recipe: ${id} (${candidates.length})`);
    const recipe = candidates[0], product = parseIngredients(recipe.mProduct);
    if (product.length !== 1 || product[0].amount !== 1 || !byClass.get(descriptorClass)?.nativeClass.endsWith(".FGBuildingDescriptor'")) {
      throw new Error(`Не подтверждён единичный продукт build recipe: ${id}`);
    }
    constructionIds.set(recipe.ClassName, id);
    if (!(id in machineClasses)) continue;
    const rawCost = parseIngredients(recipe.mIngredients || '');
    if (!rawCost.length || rawCost.length !== (recipe.mIngredients.match(/ItemClass=/g) || []).length) throw new Error(`Неполная стоимость: ${id}`);
    const buildCost = rawCost.map(({ className, amount }) => {
      const itemId = itemIds.get(className);
      if (!itemId || byClass.get(className)?.mForm !== 'RF_SOLID' || !Number.isSafeInteger(amount) || amount <= 0) throw new Error(`Не подтверждён строительный материал: ${id}/${className}`);
      return { itemId, amount };
    });
    const target = [...catalog.buildings, ...catalog.miners].find(b => b.id === id);
    target.buildCost = buildCost;
    entries.push({ id, buildClass, descriptorClass, recipeClass: recipe.ClassName, recipePath: recipe.FullName, rawCost, buildCost });
  }
  const schematics = en.filter(c => c.nativeClass.endsWith(".FGSchematic'"));
  const bySchematic = new Map(schematics.map(s => [s.ClassName, s]));
  const buildingIds = new Set(catalog.buildings.map(b => b.id)), minerIds = new Set(catalog.miners.map(b => b.id));
  const beltIds = new Set(catalog.belts.map(b => b.id)), pipeIds = new Set(catalog.pipes.map(b => b.id));
  const records = schematics.map(s => {
    const recipeClasses = unique(s.mUnlocks.filter(u => u.Class === 'BP_UnlockRecipe_C').flatMap(u => refs(u.mRecipes)));
    const constructed = unique(recipeClasses.map(cls => constructionIds.get(cls)).filter(Boolean));
    const schematicIds = unique(s.mUnlocks.filter(u => u.Class === 'BP_UnlockSchematic_C').flatMap(u => refs(u.mSchematics)));
    const prerequisiteIds = unique(s.mSchematicDependencies.filter(d => d.Class === 'BP_SchematicPurchasedDependency_C'
      && (d.mRequireAllSchematicsToBePurchased === 'True' || refs(d.mSchematics).length === 1)).flatMap(d => refs(d.mSchematics)));
    // В закреплённом наборе у выбранных схем не более одного dependency-объекта.
    // Не угадываем оператор между несколькими объектами или game-phase условия.
    const dependenciesProjectable = s.mSchematicDependencies.length <= 1 && s.mSchematicDependencies.every(d =>
      d.Class === 'BP_SchematicPurchasedDependency_C' && ['True', 'False'].includes(d.mRequireAllSchematicsToBePurchased) && refs(d.mSchematics).length > 0);
    const prerequisiteGroups = dependenciesProjectable ? s.mSchematicDependencies.flatMap(d =>
      d.mRequireAllSchematicsToBePurchased === 'True' ? unique(refs(d.mSchematics)).map(id => [id]) : [unique(refs(d.mSchematics))]) : undefined;
    return {
      id: s.ClassName, name: ru.get(s.ClassName)?.mDisplayName || '', nameEn: s.mDisplayName,
      sourcePath: s.FullName, sourceType: s.mType,
      kind: ['EST_Milestone', 'EST_Tutorial'].includes(s.mType) ? 'hub' : s.mType === 'EST_MAM' ? 'mam' : 'other',
      tier: Number(s.mTechTier), recipeIds: recipeClasses.map(cls => recipeIds.get(cls)).filter(Boolean),
      buildingIds: constructed.filter(id => buildingIds.has(id)), minerIds: constructed.filter(id => minerIds.has(id)),
      beltIds: constructed.filter(id => beltIds.has(id)), pipeIds: constructed.filter(id => pipeIds.has(id)),
      overclock: s.mUnlocks.some(u => u.Class === 'BP_UnlockBuildOverclock_C'),
      prerequisiteIds, prerequisiteGroups, prerequisitesKnown: false,
      prerequisitesUnknownReasons: [s.mType === 'EST_MAM' ? 'research-tree-not-exported' : 'full-availability-not-established',
        ...(!dependenciesProjectable ? ['dependency-expression-not-projectable'] : [])],
      schematicIds, dependencies: s.mSchematicDependencies,
      dependenciesBlocksSchematicAccess: s.mDependenciesBlocksSchematicAccess === 'True',
      hiddenUntilDependenciesMet: s.mHiddenUntilDependenciesMet === 'True',
      relevantEvents: s.mRelevantEvents, includeInBuilds: s.mIncludeInBuilds,
      cost: parseIngredients(s.mCost || ''), timeToComplete: Number(s.mTimeToComplete),
      rawUnlocks: s.mUnlocks,
      unmappedRecipeClasses: recipeClasses.filter(cls => !recipeIds.has(cls) && !constructionIds.has(cls)),
    };
  });
  const byRecord = new Map(records.map(s => [s.id, s]));
  const eligible = s => s.name && !s.relevantEvents && s.includeInBuilds === 'IIB_PublicBuilds';
  const relevant = records.filter(s => eligible(s) && (s.kind !== 'other' || s.overclock
    || s.recipeIds.length || s.buildingIds.length || s.minerIds.length || s.beltIds.length || s.pipeIds.length)).map(s => s.id);
  const selected = new Set(relevant);
  // Сохраняем также имена схем, на которые ссылаются эффекты/зависимости.
  for (const id of selected) {
    const s = byRecord.get(id);
    for (const ref of s.schematicIds) {
      if (!byRecord.has(ref) || !eligible(byRecord.get(ref))) throw new Error(`Не подтверждена дочерняя схема ${id} → ${ref}: источник, RU-имя или условия события`);
      selected.add(ref);
    }
    for (const ref of s.dependencies.flatMap(d => refs(d.mSchematics))) {
      if (byRecord.has(ref) && eligible(byRecord.get(ref))) selected.add(ref);
    }
  }
  catalog.unlocks = records.filter(s => selected.has(s.id)).map(s => ({
    id: s.id, name: s.name, kind: s.kind, tier: s.tier, recipeIds: s.recipeIds,
    buildingIds: s.buildingIds, minerIds: s.minerIds, beltIds: s.beltIds, pipeIds: s.pipeIds,
    overclock: s.overclock, prerequisiteIds: s.prerequisiteIds,
    schematicIds: s.schematicIds, prerequisiteGroups: s.prerequisiteGroups, prerequisitesKnown: s.prerequisitesKnown,
  }));
  const coverageOf = (list, field) => {
    const covered = new Set(records.filter(s => selected.has(s.id)).flatMap(s => s[field]));
    return { total: list.length, covered: list.filter(x => covered.has(x.id)).length, missingIds: list.filter(x => !covered.has(x.id)).map(x => x.id) };
  };
  const excluded = records.filter(s => !selected.has(s.id)).map(s => ({ id: s.id, reason: !s.name ? 'missing-ru-display-name' : s.relevantEvents ? 'event-restricted' : s.includeInBuilds !== 'IIB_PublicBuilds' ? 'not-public-build' : 'no-catalog-effects-or-dependencies' }));
  const unprojectedDependencies = records.filter(s => selected.has(s.id) && s.prerequisiteGroups === undefined)
    .flatMap(s => s.dependencies.map(dependency => ({ id: s.id, dependency })));
  const coverage = {
    sourceSchematics: records.length, catalogUnlocks: catalog.unlocks.length,
    relevantSchematics: relevant.length, closureAddedIds: [...selected].filter(id => !relevant.includes(id)),
    childSchemeReferences: catalog.unlocks.reduce((n, s) => n + s.schematicIds.length, 0), childSchemeClosureComplete: true,
    prerequisitesKnown: catalog.unlocks.filter(s => s.prerequisitesKnown).length,
    explicitDependencyGroups: catalog.unlocks.reduce((n, s) => n + (s.prerequisiteGroups?.length || 0), 0),
    kinds: Object.fromEntries(['hub', 'mam', 'other'].map(kind => [kind, catalog.unlocks.filter(s => s.kind === kind).length])),
    recipes: coverageOf(catalog.recipes, 'recipeIds'), buildings: coverageOf(catalog.buildings, 'buildingIds'),
    miners: coverageOf(catalog.miners, 'minerIds'), belts: coverageOf(catalog.belts, 'beltIds'), pipes: coverageOf(catalog.pipes, 'pipeIds'),
    overclockIds: records.filter(s => s.overclock).map(s => s.id),
    researchTreeExported: en.some(c => /\.FGResearchTree'/.test(c.nativeClass)), prerequisitesComplete: false,
    unprojectedDependencies, excluded,
    missingSchematicReferences: unique(records.flatMap(s => [...s.schematicIds, ...s.dependencies.flatMap(d => refs(d.mSchematics))]).filter(id => !bySchematic.has(id))),
  };
  const provenance = { source: pinned.game.source, steamBuildId: pinned.game.steamBuildId, versionLabel: pinned.game.versionLabel,
    importedAt: pinned.importedAt, docsFileDate: pinned.game.docsFileDate,
    sha256: Object.fromEntries(['Docs-en-US.json.gz', 'Docs-ru.json.gz'].map(f => [f, hashes[f]])),
    verification: 'pinned-local-game-docs; no-new-external-source',
  };
  report.buildCosts = { provenance, unit: 'items-per-new-machine', entries,
    coverage: { productionBuildings: catalog.buildings.filter(b => b.id !== 'awesome-sink').length, sinks: 1, miners: catalog.miners.length, covered: entries.length, missingIds: [] },
    mappingBasis: 'Build_/Desc_ class naming checked against exact build/recipe EN display name and single FGBuildingDescriptor product; mBuildableClass not exported',
    limitations: ['Полная стоимость нового здания; не дельта апгрейда.', 'Ленты, трубы, питание, фундаменты, энергомодули и усилители в стоимость машины не входят.'] };
  report.progression = { provenance, coverage, dataFile: 'progression.json' };
  return {
    schemaVersion: 1, catalogVersion: catalog.version, provenance, coverage,
    semantics: {
      catalogUnlocks: 'Прямые эффекты купленной схемы. Наличие схемы в списке не означает её доступность или покупку.',
      prerequisiteIds: 'Совместимый список явно обязательных purchased dependencies. Для OR использовать prerequisiteGroups.',
      prerequisiteGroups: 'AND между группами, OR внутри. requireAll=True → [[A],[B]], False → [[A,B]]. [] означает отсутствие экспортированных purchased dependencies, не доказанную доступность; поле отсутствует при непредставимом условии.',
      prerequisitesKnown: 'Полнота всех условий доступности. false у всех схем этого Docs: полный граф/внешние условия не установлены; точный разбор purchased dependencies сам по себе не означает true.',
      schematicIds: 'Ссылки BP_UnlockSchematic_C сохранены отдельно; не развёрнуты в прямые recipeIds родителя.',
      minerIds: 'ID из Catalog.miners, также опубликованы в Catalog.unlocks. buildingIds остаётся списком ID из Catalog.buildings.',
      tier: 'Исходный mTechTier; не подтверждение автоматического открытия tier или порядка ветки MAM.',
      prerequisites: 'FGResearchTree не экспортирован; пустые dependencies не доказывают отсутствие требований. Не использовать как полный gate прогресса.',
      cost: 'Исходные количества mCost со стабильными игровыми className, без выдуманных ID отсутствующих в каталоге предметов.',
    },
    schematics: records,
  };
}
