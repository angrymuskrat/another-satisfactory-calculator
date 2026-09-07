// Нормализация локальных assets той же сборки; raw-источник сохраняется отдельно.
export function importResearchAssets({ source, catalog, progression, report, en, ru, pinned }) {
  if (source.provenance.steamBuildId !== pinned.game.steamBuildId) throw new Error('Research assets принадлежат другой сборке игры');
  if (source.provenance.mappingVerification?.verified !== true) throw new Error('Сопоставление типов Research assets не подтверждено');
  if (source.semantics.parents !== 'OR' || source.semantics.unhiddenBy !== 'OR') throw new Error('Операторы графа исследований не подтверждены');
  const records = new Map(progression.schematics.map(s => [s.id, s]));
  const english = new Map(en.map(c => [c.ClassName, c]));
  const refClass = value => value?.match(/([A-Za-z0-9_-]+_C)/)?.[1];
  const itemName = value => {
    const cls = refClass(value);
    return ru.get(cls)?.mDisplayName || english.get(cls)?.mDisplayName || cls || 'неизвестный предмет';
  };
  const condition = dependency => {
    if (dependency.type === 'BP_ItemPickedUpDependency_C') {
      const items = dependency.properties.mItems ?? [];
      return `Условие открытия ветки связано с подбором предметов: ${items.map(i => `${itemName(i.Key)} (${i.Value})`).join(', ')}. События подбора в калькуляторе не отслеживаются.`;
    }
    return `Внешнее условие ${dependency.type}: выполнение не отслеживается.`;
  };
  catalog.researchNames = Object.fromEntries(progression.schematics.map(s => [s.id, s.name || s.nameEn || s.id]));
  catalog.researchTrees = source.trees.map(tree => ({
    id: tree.className, name: tree.name || tree.nameEn || tree.className, seasonal: tree.relevantEvents.length > 0,
    conditions: [...tree.unlockDependencies.map(condition), ...tree.visibilityDependencies.map(d => `Видимость ветки: ${condition(d)}`),
      ...(tree.relevantEvents.length ? ['Сезонная ветка FICSMAS: события не отслеживаются; её рецепты не входят в расчётный каталог.'] : [])],
    nodes: tree.nodes.map(node => {
      const record = records.get(node.className);
      if (!record) throw new Error(`Схема узла не найдена в Docs: ${node.className}`);
      for (const id of [...node.parentClasses, ...node.unhiddenByClasses]) if (id !== null && !records.has(id)) throw new Error(`Схема связи не найдена: ${id}`);
      return { schematicId: node.className, name: record.name || record.nameEn || node.className,
        parents: node.parentClasses, unhiddenBy: node.unhiddenByClasses,
        unresolvedCoordinates: node.unresolvedCoordinates, prerequisiteGroups: record.prerequisiteGroups ?? [],
        conditions: record.prerequisiteGroups === undefined ? ['Другие условия схемы не спроецированы; отсутствие списка не означает отсутствие требований.'] : [] };
    }),
  }));
  catalog.gamePhases = source.phases.map(phase => {
    if (!Number.isSafeInteger(phase.properties.mLastTierOfPhase)) throw new Error(`Не подтверждён последний уровень фазы: ${phase.className}`);
    return { id: phase.className, name: phase.name || phase.nameEn || phase.className, lastTier: phase.properties.mLastTierOfPhase };
  }).sort((a, b) => a.lastTier - b.lastTier);
  const nodeIds = new Set(catalog.researchTrees.flatMap(t => t.nodes.map(n => n.schematicId)));
  for (const record of progression.schematics) if (nodeIds.has(record.id)) {
    record.prerequisitesKnown = false;
    record.prerequisitesUnknownReasons = record.prerequisitesUnknownReasons.filter(reason => reason !== 'research-tree-not-exported');
    record.prerequisitesUnknownReasons.push('external-events-and-manual-completion-not-tracked');
  }
  progression.researchTrees = catalog.researchTrees;
  progression.gamePhases = catalog.gamePhases;
  progression.coverage.researchTreeExported = true;
  progression.coverage.researchAssetNodes = nodeIds.size;
  progression.coverage.researchUnresolvedNodes = catalog.researchTrees.flatMap(t => t.nodes).filter(n => n.unresolvedCoordinates.length).length;
  progression.semantics.prerequisites = 'MAM parents и unhiddenBy: OR внутри каждого списка, отдельные условия. Docs groups: AND между группами, OR внутри. Неизвестные координаты сохраняются. События подбора, видимость, сезонность и завершение фаз не отслеживаются; граф справочный, не автоматический gate.';
  progression.provenance.researchAssets = source.provenance;
  report.researchAssets = { provenance: source.provenance, semantics: source.semantics, trees: catalog.researchTrees.length,
    nodes: nodeIds.size, seasonalNodes: catalog.researchTrees.filter(t => t.seasonal).reduce((n, t) => n + t.nodes.length, 0),
    unresolvedNodes: progression.coverage.researchUnresolvedNodes, gamePhases: catalog.gamePhases.length };
  const note = 'Прямые открытия схем сверены с Docs, граф MAM и фазы HUB — с assets той же сборки. Внешние события и завершение отмечаются пользователем; пять узлов сохраняют неизвестные координатные связи. prerequisitesKnown=false: справочные связи не являются полным автоматическим условием доступа.';
  catalog.provenance.notes = catalog.provenance.notes.filter(text => !/полный граф требований MAM\/этапов не восстановлен/.test(text));
  if (!catalog.provenance.notes.includes(note)) catalog.provenance.notes.push(note);
  report.notes = [...catalog.provenance.notes];
}
