import type { Plan, SharedResourceNode, WorldSnapshot } from './types';

interface SharedWorkspace {
  worlds: Array<WorldSnapshot & { name?: string }>;
  factories: Array<{ name: string; worldId: string | null; plan: Plan }>;
}
const exceeds = (value: number, limit: number) => value > limit + Math.max(1e-9, Math.abs(limit) * 1e-12);

export function sharedNode(plan: Plan, nodeId: string): SharedResourceNode | undefined {
  return plan.world?.resourceNodes?.find(node => node.id === nodeId);
}

export function validatePlanSharedResources(plan: Plan): void {
  const totals = new Map<string, number>();
  for (const source of plan.sources) {
    if (!source.sharedNodeId) continue;
    if (!plan.world) throw new Error('Общий узел источника требует связанный мир.');
    if (source.kind !== 'flow') throw new Error('Квота общего узла задаётся только внешним потоком.');
    if (source.limit === null) throw new Error('Источник общего узла требует конечную квоту.');
    const node = sharedNode(plan, source.sharedNodeId);
    if (!node) throw new Error(`Общий узел ${source.sharedNodeId} отсутствует в мире.`);
    if (node.itemId !== source.itemId) throw new Error(`Ресурс источника не совпадает с ресурсом общего узла ${node.name}.`);
    if (exceeds(source.limit, node.limit)) throw new Error(`Квота источника превышает лимит общего узла ${node.name}.`);
    const total = (totals.get(node.id) ?? 0) + source.limit;
    totals.set(node.id, total);
    if (exceeds(total, node.limit)) throw new Error(`Сумма квот источников превышает лимит общего узла ${node.name}.`);
  }
}

export function validateWorkspaceSharedResources(workspace: SharedWorkspace): void {
  const totals = new Map<string, number>();
  for (const factory of workspace.factories) {
    validatePlanSharedResources(factory.plan);
    for (const source of factory.plan.sources) {
      if (!source.sharedNodeId || source.limit === null || factory.worldId === null) continue;
      const key = `${factory.worldId}\u0000${source.sharedNodeId}`;
      totals.set(key, (totals.get(key) ?? 0) + source.limit);
    }
  }
  for (const world of workspace.worlds) {
    for (const node of world.resourceNodes ?? []) {
      const allocated = totals.get(`${world.id}\u0000${node.id}`) ?? 0;
      if (exceeds(allocated, node.limit)) {
        throw new Error(`Сумма квот общего узла «${node.name}» (${allocated}) превышает его лимит (${node.limit}).`);
      }
    }
  }
}
