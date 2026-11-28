import type { Catalog } from '../../../packages/domain/types';
import { parseWorkspace, validateWorkspaceCatalog, type Workspace } from '../../../packages/domain/worlds';
import { validateCatalogPlan } from '../../../packages/domain/worldPlanValidation';
import { parsePlannerPlan } from '../../../packages/domain/plannerCompatibility';
import type { Messages } from './i18n';
export function parseCatalogPlan(value: unknown, catalog: Catalog) {
  return validateCatalogPlan(parsePlannerPlan(value), catalog);
}

export const WORKSPACE_KEY = 'ficsit-workspace-v1';
export function parseCatalogWorkspace(value: unknown, catalog: Catalog): Workspace {
  const workspace = parseWorkspace(value, plan => parseCatalogPlan(plan, catalog));
  validateWorkspaceCatalog(workspace, catalog);
  return workspace;
}
export function saveGuestWorkspace(storage: Pick<Storage, 'getItem' | 'setItem'>, workspace: Workspace, previousRaw: string | null, t: Messages): string {
  if (storage.getItem(WORKSPACE_KEY) !== previousRaw) throw new Error(t.planStorage.guestWorkspaceChanged);
  const raw = JSON.stringify(workspace);
  storage.setItem(WORKSPACE_KEY, raw);
  return raw;
}
