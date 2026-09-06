import type { Catalog } from '../../../packages/domain/types';
import { parseWorkspace, validateWorkspaceCatalog, type Workspace } from '../../../packages/domain/worlds';
import { parseCatalogPlan } from '../../../packages/domain/worldPlanValidation';
export { parseCatalogPlan };

export const WORKSPACE_KEY = 'ficsit-workspace-v1';
export function parseCatalogWorkspace(value: unknown, catalog: Catalog): Workspace {
  const workspace = parseWorkspace(value, plan => parseCatalogPlan(plan, catalog));
  validateWorkspaceCatalog(workspace, catalog);
  return workspace;
}
export function saveGuestWorkspace(storage: Pick<Storage, 'getItem' | 'setItem'>, workspace: Workspace, previousRaw: string | null): string {
  if (storage.getItem(WORKSPACE_KEY) !== previousRaw) throw new Error('Гостевое рабочее пространство изменено в другой вкладке. Загрузите его заново.');
  const raw = JSON.stringify(workspace);
  storage.setItem(WORKSPACE_KEY, raw);
  return raw;
}
