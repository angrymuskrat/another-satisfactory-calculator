import { useEffect, useRef, useState } from 'react';
import { FolderOpen, LogOut, Save, Trash2, UserRound } from 'lucide-react';
import type { Plan } from '../../../packages/domain/types';
import { parseCatalogPlan } from './planStorage';
import { legacyCleanupMessage } from '../../../packages/domain/plannerCompatibility';
import type { PlanProps } from './Planner';
import { useLocale, useT, type Messages } from './i18n';
interface User { id: string; username: string }
interface Profile { id: string; name: string; revision: number; updatedAt: string; data: Plan }
async function request<T>(t: Messages, path: string, method = 'GET', body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, { method, credentials: 'same-origin', headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  } catch {
    throw new Error(t.profiles.serverUnreachable);
  }
  const data = await response.json().catch(() => ({ error: t.profiles.badResponse }));
  if (!response.ok) {
    const auth = path === '/auth/register' || path === '/auth/login';
    let message = typeof data?.error === 'string' && data.error.trim() ? data.error : t.profiles.requestFailedRetry;
    if (response.status === 400 && auth) message = t.profiles.authBadInput;
    if (response.status === 401) message = auth
      ? t.profiles.authBadCredentials
      : t.profiles.sessionExpired;
    if (response.status === 403) message = t.profiles.forbidden;
    if (response.status === 404 && auth) message = t.profiles.authServiceMissing;
    if (response.status === 409 && path === '/auth/register') message = t.profiles.loginTaken;
    if (response.status === 413) message = t.profiles.payloadTooLarge;
    if (response.status === 429) message = t.profiles.tooManyAttempts;
    if (response.status >= 500) message = t.profiles.serverError;
    throw new Error(t.profiles.withHttpStatus(message, response.status));
  }
  return data as T;
}
export function Profiles({ catalog, plan, setPlan, onSessionChange }: PlanProps & { onSessionChange?: () => void }) {
  const t = useT();
  const locale = useLocale();
  const api = <T,>(path: string, method = 'GET', body?: unknown) => request<T>(t, path, method, body);
  const [user, setUser] = useState<User | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [register, setRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState(plan.name);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const deleteTrigger = useRef<HTMLButtonElement | null>(null);
  const saveName = useRef<HTMLInputElement>(null);
  const wasDeleting = useRef(false);
  useEffect(() => {
    if (!pendingDelete && wasDeleting.current) {
      if (deleteTrigger.current?.isConnected) deleteTrigger.current.focus(); else saveName.current?.focus();
    }
    wasDeleting.current = !!pendingDelete;
  }, [pendingDelete]);
  const refresh = async () => setProfiles((await api<{ profiles: Profile[] }>('/profiles')).profiles);
  useEffect(() => { let active = true; api<{ user: User | null; removedLegacyPlans?: number }>('/session').then(async data => { if (data.removedLegacyPlans) setNotice(legacyCleanupMessage); if (!active) return; setUser(data.user); if (data.user) await refresh(); }).catch(e => active && setError(e instanceof Error ? e.message : t.profiles.connectFailed)).finally(() => active && setLoading(false)); return () => { active = false; }; }, []);
  const run = async (action: () => Promise<void>) => { setLoading(true); setError(''); setNotice(''); try { await action(); } catch (e) { setError(e instanceof Error ? e.message : t.profiles.requestFailed); } finally { setLoading(false); } };
  return <div className="profiles-view"><section className="panel profile-account"><div className="account-icon"><UserRound size={28} /></div>{user ? <><h2>{user.username}</h2><p className="hint">{t.profiles.accountHint}</p><button className="secondary-button" disabled={loading} onClick={() => run(async () => { await api('/auth/logout', 'POST'); setUser(null); setProfiles([]); onSessionChange?.(); })}><LogOut size={16} />{t.profiles.logout}</button></> : <><h2>{register ? t.profiles.createAccount : t.profiles.guestHeading}</h2><p className="hint">{t.profiles.guestHint}</p><form onSubmit={e => { e.preventDefault(); void run(async () => { const data = await api<{ user: User }>(register ? '/auth/register' : '/auth/login', 'POST', { username, password }); setUser(data.user); setPassword(''); onSessionChange?.(); await refresh(); }); }}><label><span className="field-label">{t.profiles.login}</span><input aria-label={t.profiles.login} aria-describedby="account-username-hint" required minLength={3} maxLength={40} autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} /><small id="account-username-hint" className="hint">{t.profiles.usernameHint}</small></label><label><span className="field-label">{t.profiles.password}</span><input aria-label={t.profiles.password} aria-describedby="account-password-hint" required minLength={8} maxLength={128} type="password" autoComplete={register ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} /><small id="account-password-hint" className="hint">{t.profiles.passwordHint}</small></label><button className="primary-button" disabled={loading} type="submit">{loading ? t.profiles.connecting : register ? t.profiles.signUp : t.profiles.signIn}</button></form><button className="text-button" onClick={() => { setRegister(!register); setError(''); }}>{register ? t.profiles.haveAccount : t.profiles.createAccount}</button></>}{error && <p role="alert" className="form-error">{error}</p>}{notice && <p role="status" className="form-success">{notice}</p>}</section><section className="panel saved-profiles"><div className="section-heading"><div><h2>{t.profiles.savedPlans}</h2></div><span className="count-badge">{profiles.length}</span></div>{user ? <><form className="save-profile-form" onSubmit={e => { e.preventDefault(); void run(async () => { await api('/profiles', 'POST', { name: name.trim(), data: { ...plan, name: name.trim() } }); await refresh(); setNotice(t.profiles.planSaved); }); }}><input ref={saveName} aria-label={t.profiles.saveNameLabel} required maxLength={100} placeholder={t.profiles.saveNamePlaceholder} value={name} onChange={e => setName(e.target.value)} /><button className="primary-button" type="submit" disabled={loading || !name.trim()}><Save size={16} />{t.profiles.saveCurrent}</button></form><div className="profile-list">{profiles.map(profile => <article className="saved-profile" key={profile.id}><div><h3>{profile.name}</h3><small>{t.profiles.savedVersion(new Date(profile.updatedAt).toLocaleString(locale.tag), profile.revision)}</small><p>{t.profiles.planSummary(profile.data.targets.length, profile.data.sources.length, profile.data.mode === 'target' ? t.profiles.modeTarget : t.profiles.modeMaximize)}</p></div><div className="profile-actions"><button disabled={loading} className="secondary-button" onClick={() => { try { setPlan(parseCatalogPlan(profile.data, catalog)); setName(profile.name); setNotice(t.profiles.planRestored(profile.name)); setError(''); } catch (e) { setError(e instanceof Error ? e.message : t.profiles.invalidPlan); } }}><FolderOpen size={15} />{t.profiles.open}</button><button disabled={loading} className="secondary-button" title={t.profiles.updateTitle} onClick={() => run(async () => { await api(`/profiles/${profile.id}`, 'PUT', { name: profile.name, data: { ...plan, name: profile.name }, revision: profile.revision }); await refresh(); setNotice(t.profiles.profileUpdated); })}>{t.profiles.update}</button><button className="icon-button danger" disabled={loading} aria-label={t.profiles.deleteProfile(profile.name)} onClick={e => { deleteTrigger.current = e.currentTarget; setPendingDelete(profile.id); }}><Trash2 size={16} /></button></div>{pendingDelete === profile.id && <div className="delete-confirm" role="group" aria-label={t.profiles.deletingProfile(profile.name)} onKeyDown={e => { if (e.key === 'Escape') setPendingDelete(null); }}><span>{t.profiles.confirmDelete(profile.name)}</span><button className="danger text-button" disabled={loading} onClick={() => run(async () => { await api(`/profiles/${profile.id}`, 'DELETE'); await refresh(); setPendingDelete(null); setNotice(t.profiles.profileDeleted(profile.name)); })}>{t.profiles.delete}</button><button autoFocus className="text-button" onClick={() => setPendingDelete(null)}>{t.profiles.cancel}</button></div>}</article>)}</div>{!profiles.length && <div className="empty-panel"><FolderOpen size={35} /><h3>{t.profiles.emptyTitle}</h3><p>{t.profiles.emptyHint}</p></div>}</> : <div className="empty-panel"><FolderOpen size={40} /><h3>{t.profiles.guestEmptyTitle}</h3><p>{t.profiles.guestEmptyHint()}</p></div>}</section></div>;
}
