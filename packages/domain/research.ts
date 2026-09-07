import type { Catalog } from './types';

export const researchName = (catalog: Catalog, id: string) => catalog.researchNames?.[id]
  ?? catalog.unlocks?.find(u => u.id === id)?.name
  ?? catalog.researchTrees?.flatMap(t => t.nodes).find(n => n.schematicId === id)?.name ?? id;
export function prerequisiteState(alternatives: (string | null)[], completed: readonly string[]): 'satisfied' | 'pending' | 'unknown' {
  if (!alternatives.length || alternatives.some(id => id !== null && completed.includes(id))) return 'satisfied';
  return alternatives.includes(null) ? 'unknown' : 'pending';
}
export const phaseForTier = (catalog: Catalog, tier: number) => catalog.gamePhases?.find(phase => tier <= phase.lastTier);
function researchRecord(catalog: Catalog, id: string) {
  const tree = catalog.researchTrees?.find(t => t.nodes.some(n => n.schematicId === id));
  const node = tree?.nodes.find(n => n.schematicId === id);
  const unlock = catalog.unlocks?.find(u => u.id === id);
  const grants = catalog.unlocks?.filter(u => u.schematicIds?.includes(id)).map(u => u.id) ?? [];
  return { tree, node, unlock, grants, groups: node?.prerequisiteGroups ?? unlock?.prerequisiteGroups ?? [] };
}
export function researchDescription(catalog: Catalog, id: string, completed: readonly string[]): string[] {
  const { tree, node, unlock, grants, groups } = researchRecord(catalog, id);
  const names = (ids: (string | null)[]) => ids.map(ref => ref === null ? 'неизвестная связь в данных игры' : researchName(catalog, ref)).join(' ИЛИ ');
  const state = (ids: (string | null)[]) => ({ satisfied: 'отмечено выполнение условия', pending: 'не отмечено', unknown: 'есть неизвестная связь' })[prerequisiteState(ids, completed)];
  const lines: string[] = [];
  if (tree) lines.push(`Ветка MAM: ${tree.name}${tree.seasonal ? ' (сезонная, исключена из расчётного каталога)' : ''}.`);
  if (node?.parents.length) lines.push(`Родители — достаточно любого: ${names(node.parents)}; ${state(node.parents)}.`);
  if (node?.unhiddenBy.length) lines.push(`Показ узла после любого: ${names(node.unhiddenBy)}; ${state(node.unhiddenBy)}.`);
  groups.forEach((group, i) => lines.push(`Условие схемы ${i + 1} (обязательно каждое условие): ${names(group)}; ${state(group)}.`));
  if (grants.length) lines.push(`Схему открывает: ${names(grants)}.`);
  if (unlock?.kind === 'hub' && unlock.tier !== undefined) {
    const phase = phaseForTier(catalog, unlock.tier);
    if (phase) lines.push(`Уровень HUB ${unlock.tier}: фаза проекта «${phase.name}» (верхний уровень фазы ${phase.lastTier}). Достижение фазы не отслеживается.`);
  }
  if (node?.unresolvedCoordinates.length) lines.push(`Не найдены узлы по координатам ${node.unresolvedCoordinates.map(c => c.join(',')).join('; ')}. Они не считаются выполненными.`);
  lines.push(...(node?.conditions ?? []));
  if (!node && unlock && unlock.prerequisiteGroups === undefined) lines.push('Другие условия схемы не спроецированы; отсутствие списка не означает отсутствие требований.');
  lines.push(...(tree?.conditions ?? []));
  lines.push('Список связей не подтверждает доступность: внешние события и выполнение исследований отмечаются пользователем.');
  return lines;
}
/** All alternatives remain visible; this is a reference graph, never a purchase order. */
export function researchChain(catalog: Catalog, roots: string[], completed: readonly string[]) {
  const visited = new Set<string>(), visiting = new Set<string>(), cycles = new Set<string>();
  const steps: { id: string; name: string; completed: boolean; conditions: string[] }[] = [];
  const visit = (id: string) => {
    if (visiting.has(id)) { cycles.add(id); return; }
    if (visited.has(id)) return;
    visiting.add(id);
    if (!completed.includes(id)) {
      const { node, groups, grants } = researchRecord(catalog, id);
      const refs = [...(node?.parents ?? []), ...(node?.unhiddenBy ?? []), ...groups.flat(), ...grants];
      for (const ref of refs) if (ref !== null) visit(ref);
    }
    visiting.delete(id); visited.add(id);
    steps.push({ id, name: researchName(catalog, id), completed: completed.includes(id), conditions: researchDescription(catalog, id, completed) });
  };
  roots.forEach(visit);
  return { steps, cycles: [...cycles] };
}
export function recipeResearchReasons(catalog: Catalog, recipeId: string, completed: readonly string[]): string[] {
  const roots = catalog.unlocks?.filter(u => u.recipeIds.includes(recipeId)).map(u => u.id) ?? [];
  if (!roots.length) return [];
  const chain = researchChain(catalog, roots, completed);
  return chain.steps.map(step => {
    const { node, groups, grants, unlock } = researchRecord(catalog, step.id);
    const refs = (ids: (string | null)[]) => ids.map(id => id === null ? 'неизвестная связь' : researchName(catalog, id)).join(' ИЛИ ');
    const requirements = [
      node?.parents.length ? `родители: ${refs(node.parents)}` : '',
      ...groups.map(group => `обязательное условие: ${refs(group)}`),
      grants.length ? `открывающая схема: ${refs(grants)}` : '',
      unlock?.kind === 'hub' && unlock.tier !== undefined && phaseForTier(catalog, unlock.tier) ? `фаза: ${phaseForTier(catalog, unlock.tier)!.name}` : '',
    ].filter(Boolean);
    return `Исследование «${step.name}»${step.completed ? ' — отмечено' : ''}${requirements.length ? ': ' + requirements.join('; ') : ''}.`;
  }).concat(chain.cycles.length ? ['В справочных связях обнаружен цикл; автоматическая последовательность покупки не определена.'] : []);
}
