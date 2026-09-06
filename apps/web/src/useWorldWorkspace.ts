import { useCallback, useEffect, useRef, useState } from 'react';
import type { Catalog } from '../../../packages/domain/types';
import { emptyWorkspace, type Workspace } from '../../../packages/domain/worlds';
import { parseCatalogWorkspace, saveGuestWorkspace, WORKSPACE_KEY } from './planStorage';

interface WorkspaceState { workspace: Workspace; revision: number; ownerId: string | null; raw: string | null }
async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, { credentials: 'same-origin', method: body ? 'PUT' : 'GET',
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Не удалось сохранить рабочее пространство.');
  return data;
}
export function useWorldWorkspace(catalog: Catalog) {
  const [state, setState] = useState<WorkspaceState>(() => ({ workspace: emptyWorkspace(catalog.version), revision: 0, ownerId: null, raw: null }));
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const epoch = useRef(0);
  const saving = useRef(false);
  const load = useCallback(async () => {
    const generation = ++epoch.current;
    setReady(false); setError('');
    // Не оставляем данные другого аккаунта на экране во время загрузки.
    setState({ workspace: emptyWorkspace(catalog.version), ownerId: null, revision: 0, raw: null });
    try {
      let user: { id: string } | null;
      try { user = (await request<{ user: { id: string } | null }>('/session')).user; }
      catch { user = null; }
      let next: WorkspaceState;
      if (user) {
        const data = await request<{ workspace: unknown; ownerId: string; revision: number }>('/workspace');
        if (data.ownerId !== user.id) throw new Error('Аккаунт изменился во время загрузки. Повторите загрузку.');
        next = { ...data, workspace: parseCatalogWorkspace(data.workspace, catalog), raw: null };
      } else {
        const raw = localStorage.getItem(WORKSPACE_KEY);
        next = { workspace: raw ? parseCatalogWorkspace(JSON.parse(raw), catalog) : emptyWorkspace(catalog.version), ownerId: null, revision: 0, raw };
      }
      if (generation === epoch.current) { setState(next); setReady(true); }
    } catch (e) { if (generation === epoch.current) setError(e instanceof Error ? e.message : 'Ошибка загрузки рабочего пространства. Исходные данные сохранены.'); }
  }, [catalog]);
  useEffect(() => { void load(); return () => { epoch.current++; }; }, [load]);
  const save = async (workspace: Workspace) => {
    if (!ready || saving.current) throw new Error('Дождитесь загрузки или сохранения рабочего пространства.');
    const generation = epoch.current;
    saving.current = true; setBusy(true); setError('');
    try {
      const checked = parseCatalogWorkspace(workspace, catalog);
      let next: WorkspaceState;
      if (state.ownerId) {
        const data = await request<{ workspace: unknown; ownerId: string; revision: number }>('/workspace', {
          expectedOwnerId: state.ownerId, revision: state.revision, workspace: checked,
        });
        next = { ...data, workspace: parseCatalogWorkspace(data.workspace, catalog), raw: null };
      } else {
        next = { ...state, workspace: checked, raw: saveGuestWorkspace(localStorage, checked, state.raw) };
      }
      if (generation !== epoch.current) throw new Error('Аккаунт изменился во время сохранения. Загрузите данные заново.');
      setState(next);
    } finally { saving.current = false; setBusy(false); }
  };
  return { ...state, ready, busy, error, load, save };
}
