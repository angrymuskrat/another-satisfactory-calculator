// Категории и принадлежность из assets установленной сборки, отдельно от Docs.
export function importMenuAssets({ source, catalog, report, pinned }) {
  if (source.provenance.steamBuildId !== pinned.game.steamBuildId) throw new Error('Категории относятся к другой сборке.');
  if (source.provenance.mappingVerification?.verified !== true) throw new Error('Совместимость mappings категорий не проверена.');
  const unique = (list, key) => {
    const map = new Map(list.map(value => [value[key], value]));
    if (map.size !== list.length) throw new Error(`Неоднозначные данные категорий: ${key}`);
    return map;
  };
  const categories = unique(source.categories, 'className'), items = unique(source.items, 'id'), recipes = unique(source.recipes, 'id');
  const itemsByClass = unique(source.items, 'className');
  const category = id => {
    const c = categories.get(id);
    if (!c?.name?.trim() || !c.nameEn?.trim() || (c.menuPriority !== null && !Number.isFinite(c.menuPriority))) throw new Error(`Не подтверждена категория: ${id}`);
    return c;
  };
  for (const item of catalog.items) {
    const evidence = items.get(item.id);
    if (evidence?.className !== report.itemClasses[item.id]) throw new Error(`Не подтверждён предмет категории: ${item.id}`);
    item.category = category(evidence.categoryClass).name;
  }
  const used = new Set();
  for (const recipe of catalog.recipes) {
    const evidence = recipes.get(recipe.id);
    if (evidence?.className !== report.recipeClasses[recipe.id] || evidence.firstProductClass !== report.itemClasses[recipe.outputs[0].itemId]) throw new Error(`Не подтверждён рецепт категории: ${recipe.id}`);
    if (evidence.menuPriority !== null && evidence.menuPriority !== report.menuEvidence.recipePriorities[recipe.id]) throw new Error(`Приоритет assets не совпал с Docs: ${recipe.id}`);
    const id = evidence.overriddenCategoryClass ?? itemsByClass.get(evidence.firstProductClass)?.categoryClass;
    recipe.category = category(id).name;
    used.add(id);
  }
  // Отсутствующий сериализованный приоритет не подменяем предполагаемым native 0.
  // Неподтверждённые позиции идут после известных, затем применяется русский алфавит.
  const ordered = [...used].map(category).sort((a, b) => (a.menuPriority ?? Infinity) - (b.menuPriority ?? Infinity) || a.name.localeCompare(b.name, 'ru'));
  catalog.categories = ordered.map(c => c.name);
  const rank = new Map(catalog.categories.map((name, i) => [name, i]));
  catalog.recipes.sort((a, b) => rank.get(a.category) - rank.get(b.category)
    || report.menuEvidence.recipePriorities[a.id] - report.menuEvidence.recipePriorities[b.id] || a.name.localeCompare(b.name, 'ru'));
  catalog.categorySource = 'game-assets';
  catalog.provenance.source += '; pinned game assets and AllStringTables localization';
  catalog.provenance.notes = catalog.provenance.notes.filter(n => !n.startsWith('Группы тематические:'));
  catalog.provenance.notes.push('Названия и принадлежность категорий подтверждены assets и русской игровой локализацией той же сборки; учитываются mCategory и mOverriddenCategory. Приоритеты рецептов из Docs; для категорий без сериализованного приоритета и равных приоритетов используется русский алфавит. Полное совпадение порядка меню не заявляется.');
  report.notes = catalog.provenance.notes;
  report.verification.menuCategories = 'pinned-game-assets-and-ru-localization; partial-order';
  report.menuEvidence = { ...report.menuEvidence, docsEvidenceSource: report.menuEvidence.source, source: 'source/menu-assets.json',
    labelsAndMembershipVerified: true, groupNamesAndOrderVerified: false,
    categoryClassesExportedFromAssets: source.categories.length,
    itemMembershipCoverage: catalog.items.length, recipeMembershipCoverage: catalog.recipes.length,
    categories: ordered.map(c => ({ className: c.className, name: c.name, menuPriority: c.menuPriority })),
    missingCategoryPriorities: ordered.filter(c => c.menuPriority === null).map(c => c.className),
    equalPriorityOrder: 'alphabetical-ru; not-verified-in-game' };
}
