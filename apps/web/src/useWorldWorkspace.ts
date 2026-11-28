import { useCallback, useEffect, useRef, useState } from 'react';
import type { Catalog } from '../../../packages/domain/types';
import { emptyWorkspace, parseWorkspace, validateWorkspaceCatalog, type Workspace } from '../../../packages/domain/worlds';
import { legacyCleanupMessage, removeLegacyFactories } from '../../../packages/domain/plannerCompatibility';
import { useT, type Messages } from './i18n';
import { parseCatalogWorkspace, saveGuestWorkspace, WORKSPACE_KEY } from './planStorage';

interface WorkspaceState { workspace: Workspace; revision: number; ownerId: string | null; raw: string | null }
async function request<T>(t: Messages, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, { credentials: 'same-origin', method: body ? 'PUT' : 'GET',
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || t.useWorldWorkspace.saveFailed);
  return data;
}
export function useWorldWorkspace(catalog: Catalog, enabled = true) {
  const t = useT();
  const [state, setState] = useState<WorkspaceState>(() => ({ workspace: emptyWorkspace(catalog.version), revision: 0, ownerId: null, raw: null }));
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const epoch = useRef(0);
  const saving = useRef(false);
  const load = useCallback(async () => {
    const generation = ++epoch.current;
    setReady(false); setError(''); setNotice('');
    // Не оставляем данные другого аккаунта на экране во время загрузки.
    setState({ workspace: emptyWorkspace(catalog.version), ownerId: null, revision: 0, raw: null });
    try {
      let user: { id: string } | null;
      try {
        const session = await request<{ user: { id: string } | null; removedLegacyPlans?: number }>(t, '/session');
        user = session.user;
        if (session.removedLegacyPlans) setNotice(legacyCleanupMessage);
      }
      catch { user = null; }
      if (generation !== epoch.current) return;
      let next: WorkspaceState;
      if (user) {
        const data = await request<{ workspace: unknown; ownerId: string; revision: number }>(t, '/workspace');
        if (data.ownerId !== user.id) throw new Error(t.useWorldWorkspace.accountChangedLoading);
        next = { ...data, workspace: parseCatalogWorkspace(data.workspace, catalog), raw: null };
      } else {
        let raw = localStorage.getItem(WORKSPACE_KEY);
        if (raw) {
          const original = parseWorkspace(JSON.parse(raw));
          validateWorkspaceCatalog(original, catalog);
          const cleaned = removeLegacyFactories(original);
          if (cleaned.removed) {
            const checked = parseCatalogWorkspace(cleaned.workspace, catalog);
            raw = saveGuestWorkspace(localStorage, checked, raw, t);
            setNotice(legacyCleanupMessage);
          }
        }
        next = { workspace: raw ? parseCatalogWorkspace(JSON.parse(raw), catalog) : emptyWorkspace(catalog.version), ownerId: null, revision: 0, raw };
      }
      if (generation === epoch.current) { setState(next); setReady(true); }
    } catch (e) { if (generation === epoch.current) setError(e instanceof Error ? e.message : t.useWorldWorkspace.loadFailed); }
  }, [catalog, t]);
  useEffect(() => { if (enabled) void load(); return () => { epoch.current++; }; }, [load, enabled]);
  const save = async (workspace: Workspace) => {
    if (!enabled || !ready || saving.current) throw new Error(t.useWorldWorkspace.waitForWorkspace);
    const generation = epoch.current;
    saving.current = true; setBusy(true); setError('');
    try {
      const checked = parseCatalogWorkspace(workspace, catalog);
      let next: WorkspaceState;
      if (state.ownerId) {
        const data = await request<{ workspace: unknown; ownerId: string; revision: number }>(t, '/workspace', {
          expectedOwnerId: state.ownerId, revision: state.revision, workspace: checked,
        });
        next = { ...data, workspace: parseCatalogWorkspace(data.workspace, catalog), raw: null };
      } else {
        next = { ...state, workspace: checked, raw: saveGuestWorkspace(localStorage, checked, state.raw, t) };
      }
      if (generation !== epoch.current) throw new Error(t.useWorldWorkspace.accountChangedSaving);
      setState(next);
    } finally { saving.current = false; setBusy(false); }
  };
  return { ...state, workspace: enabled ? state.workspace : emptyWorkspace(catalog.version), ready: enabled && ready, busy, error, notice, load, save };
}
