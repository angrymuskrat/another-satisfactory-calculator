import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { Catalog, Plan, SharedResourceNode, Unlock } from '../../../packages/domain/types';
import { createDefaultPlan } from '../../../packages/domain/defaults';
import { applyWorldUpdate, createFactory, createWorld, grantWorldUnlocks, mergeWorkspace, previewWorldUpdate, snapshotWorld, type World, type Workspace } from '../../../packages/domain/worlds';
import { parseCatalogWorkspace, WORKSPACE_KEY } from './planStorage';
import type { useWorldWorkspace } from './useWorldWorkspace';
import { ResearchGuide, ResearchChainView } from './Research';
import { researchDescription } from '../../../packages/domain/research';
import { downloadJson as download, normalize } from './controls';
import { useT } from './i18n';
import { gameName, searchNames, type GameKind } from './i18n/gameNames';

type Store = ReturnType<typeof useWorldWorkspace>;
interface Props {
  catalog: Catalog; plan: Plan; setPlan: Dispatch<SetStateAction<Plan>>; store: Store;
  activeFactoryId: string | null; setActiveFactoryId: (id: string | null) => void;
}
const toggle = (values: string[], id: string) => values.includes(id) ? values.filter(value => value !== id) : [...values, id];
const gameNameOf = (kind: GameKind, entry: { id: string; name: string } | undefined, id: string) => entry ? gameName(kind, entry.id, entry.name) : id;

export function Worlds({ catalog, plan, setPlan, store, activeFactoryId, setActiveFactoryId }: Props) {
  const t = useT();
  const { workspace, ready, busy } = store;
  const [draft, setDraft] = useState<World | null>(null);
  const [preview, setPreview] = useState<ReturnType<typeof previewWorldUpdate> | null>(null);
  const [selectedWorld, setSelectedWorld] = useState('');
  const [name, setName] = useState(t.worlds.newWorldName);
  const [search, setSearch] = useState('');
  const [tier, setTier] = useState(0);
  const [presetIds, setPresetIds] = useState<string[] | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const editor = useRef<HTMLElement>(null);
  const previewRegion = useRef<HTMLElement>(null);
  const editorTrigger = useRef<HTMLButtonElement | null>(null);
  const editingId = draft?.id;
  useEffect(() => { if (editingId) editor.current?.focus(); else editorTrigger.current?.focus(); }, [editingId]);
  useEffect(() => { if (preview) previewRegion.current?.focus(); }, [preview]);
  const locked = !ready || busy;
  const run = async (action: () => Promise<void>) => {
    setError(''); setMessage('');
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : t.worlds.saveFailed); }
  };
  const edit = (next: World) => { setDraft(next); setPreview(null); };
  const world = workspace.worlds.find(w => w.id === selectedWorld);
  const active = workspace.factories.find(f => f.id === activeFactoryId);
  const dirty = active && JSON.stringify(active.plan) !== JSON.stringify(plan);
  const save = async (next: Workspace, notice: string) => { await store.save(next); setMessage(notice); };
  const addWorld = async (fromPlan: boolean) => {
    const created = createWorld(catalog, name, crypto.randomUUID(), fromPlan ? plan : undefined);
    await save({ ...workspace, worlds: [...workspace.worlds, created] }, t.worlds.worldSaved);
    setSelectedWorld(created.id);
  };
  const addFactory = async (copyCurrent: boolean) => {
    let source = copyCurrent ? plan : createDefaultPlan(catalog);
    // В новой фабрике локальные исключения пусты: доступность задаёт snapshot мира.
    if (!copyCurrent && world) source = { ...source, settings: { ...source.settings,
      enabledRecipeIds: catalog.recipes.map(r => r.id), enabledBuildingIds: catalog.buildings.map(b => b.id),
      beltId: [...catalog.belts].sort((a, b) => b.rate - a.rate)[0].id,
      pipeId: [...catalog.pipes].sort((a, b) => b.rate - a.rate)[0].id,
    } };
    const factory = createFactory(source, crypto.randomUUID(), world);
    await save({ ...workspace, factories: [...workspace.factories, factory] }, t.worlds.factorySaved);
    setActiveFactoryId(factory.id); setPlan(structuredClone(factory.plan));
  };
  const saveFactory = async () => {
    if (!active) return;
    const linked = workspace.worlds.find(w => w.id === active.worldId);
    const next = createFactory(plan, active.id, linked);
    await save({ ...workspace, factories: workspace.factories.map(f => f.id === active.id ? next : f) }, t.worlds.factoryFullySaved);
    setPlan(current => ({ ...current, ...(linked ? { world: snapshotWorld(linked) } : {}) }));
  };
  const grant = (unlock: Unlock) => {
    if (!draft) return;
    try { edit(grantWorldUnlocks(catalog, draft, [unlock.id])); }
    catch (e) { setError(e instanceof Error ? e.message : t.worlds.unlockFailed); }
  };
  const importWorkspace = async (file?: File) => {
    if (!file) return;
    await run(async () => {
      if (file.size > 8 * 1024 * 1024) throw new Error(t.worlds.workspaceTooLarge);
      const imported = parseCatalogWorkspace(JSON.parse(await file.text()), catalog);
      await save(mergeWorkspace(workspace, imported, () => crypto.randomUUID()), t.worlds.workspaceImported);
    });
    if (input.current) input.current.value = '';
  };
  const matches = (value: string) => normalize(value).includes(normalize(search));
  const transportName = (kind: 'belts' | 'pipes', id: string) => { const found = catalog[kind].find(transport => transport.id === id); return found ? gameName(kind === 'belts' ? 'belt' : 'pipe', found.id, found.name) : id; };
  const unlockName = (id: string) => catalog.unlocks?.find(u => u.id === id)?.name ?? id;
  const updateNode = (id: string, patch: Partial<SharedResourceNode>) => {
    if (!draft) return;
    edit({ ...draft, resourceNodes: (draft.resourceNodes ?? []).map(node => node.id === id ? { ...node, ...patch } : node) });
  };
  return <div className="worlds-view"><section className="panel">
    <h2>{t.worlds.title}</h2>
    <p className="hint">{store.ownerId ? t.worlds.accountWorkspaceHint : t.worlds.guestWorkspaceHint} {t.worlds.legacyHint}</p>
    {store.error && <p role="alert" className="form-error">{store.error} {t.worlds.dataNotOverwritten}</p>}
    {error && <p role="alert" className="form-error">{error}</p>}
    {message && <p role="status" className="form-success">{message}</p>}
    <div className="toolbar-actions" style={{ flexWrap: 'wrap' }}>
      <button className="secondary-button" onClick={() => download(JSON.stringify(workspace, null, 2), 'ficsit-workspace.json')} disabled={!ready}>{t.worlds.exportWorkspace}</button>
      <button className="secondary-button" disabled={locked || !!draft} onClick={() => input.current?.click()}>{t.worlds.importWorkspace}</button>
      <button className="text-button" disabled={busy || !!draft} onClick={() => { void store.load(); }}>{t.worlds.reloadWorkspace}</button>
      {!ready && <button className="secondary-button" onClick={() => { const raw = localStorage.getItem(WORKSPACE_KEY); if (raw) download(raw, 'ficsit-workspace-recovery.json'); }}>{t.worlds.exportRawGuest}</button>}
      <input ref={input} hidden type="file" accept=".json,application/json" aria-label={t.worlds.workspaceFileLabel} onChange={e => void importWorkspace(e.target.files?.[0])} />
    </div>
    <fieldset disabled={locked || !!draft}><legend>{t.worlds.newRun}</legend>
      <label>{t.worlds.worldNameLabel}<input aria-label={t.worlds.worldNameLabel} value={name} maxLength={120} onChange={e => setName(e.target.value)} /></label>
      <div className="toolbar-actions" style={{ flexWrap: 'wrap' }}><button className="primary-button" disabled={!name.trim()} onClick={() => void run(() => addWorld(false))}>{t.worlds.createEmptyWorld}</button>
        <button className="secondary-button" disabled={!name.trim()} onClick={() => void run(() => addWorld(true))}>{t.worlds.createWorldFromPlan}</button></div>
      <p className="hint">{t.worlds.newWorldHint}</p>
    </fieldset>
    <fieldset disabled={locked || !!draft}><legend>{t.worlds.worldsLegend}</legend>
      {workspace.worlds.map(w => <article className="saved-profile" key={w.id}><div><h3>{w.name}</h3><p>{t.worlds.worldSummary(w.revision, w.unlockedRecipeIds.length, w.unlockedBuildingIds.length, workspace.factories.filter(f => f.worldId === w.id).length)}</p></div><button className="secondary-button" onClick={e => { editorTrigger.current = e.currentTarget; setDraft(structuredClone(w)); setPreview(null); setSearch(''); }}>{t.worlds.editProgress(w.name)}</button></article>)}
      {!workspace.worlds.length && <p>{t.worlds.noWorlds}</p>}
    </fieldset>
    <fieldset disabled={locked || !!draft}><legend>{t.worlds.factoriesLegend}</legend>
      <label>{t.worlds.worldForNewFactory}<select aria-label={t.worlds.worldForNewFactory} value={selectedWorld} onChange={e => setSelectedWorld(e.target.value)}><option value="">{t.worlds.standalonePlan}</option>{workspace.worlds.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
      <div className="toolbar-actions" style={{ flexWrap: 'wrap' }}><button className="primary-button" disabled={!!dirty} onClick={() => void run(() => addFactory(false))}>{t.worlds.newFactory}</button><button className="secondary-button" onClick={() => void run(() => addFactory(true))}>{t.worlds.saveCopy}</button>
        {active && <button className="primary-button" onClick={() => void run(saveFactory)}>{t.worlds.saveFactory(active.name)}</button>}</div>
      <p className="hint">{t.worlds.factoriesHint}</p>
      {dirty && <p role="status">{t.worlds.unsavedChanges}</p>}
      {workspace.factories.map(f => <article className="saved-profile" key={f.id}><div><h3>{f.name}{f.id === activeFactoryId ? t.worlds.openedSuffix : ''}</h3><p>{t.worlds.factorySummary(workspace.worlds.find(w => w.id === f.worldId)?.name ?? t.worlds.standalonePlan, f.plan.sources.length)}</p></div>
        <button className="secondary-button" disabled={!!dirty && f.id !== activeFactoryId} onClick={() => { setPlan(structuredClone(f.plan)); setActiveFactoryId(f.id); setMessage(t.worlds.factoryOpened(f.name)); }}>{t.worlds.openFactory(f.name)}{dirty && f.id === activeFactoryId ? t.worlds.withoutUnsaved : ''}</button></article>)}
    </fieldset>
  </section>{draft && <section className="panel" ref={editor} tabIndex={-1} aria-label={t.worlds.draftRegion}><h2>{t.worlds.draftTitle(draft.name)}</h2>
    <p className="hint">{t.worlds.draftHint}</p>
    <fieldset disabled={busy}><legend>{t.worlds.discoveriesLegend}</legend>
      <label>{t.worlds.runNameLabel}<input aria-label={t.worlds.runNameLabel} value={draft.name} maxLength={120} onChange={e => edit({ ...draft, name: e.target.value })} /></label>
      <label>{t.worlds.searchDiscoveries}<input type="search" aria-label={t.worlds.searchDiscoveriesLabel} value={search} onChange={e => setSearch(e.target.value)} /></label>
      <ResearchGuide catalog={catalog} completed={draft.unlockedMilestoneIds} mark={grant} />
      <details><summary>{t.worlds.schemesSummary}</summary>
        <p className="hint">{t.worlds.schemesHint}</p>
        {!catalog.unlocks?.length && <p>{t.worlds.noSchemes}</p>}
        {!!catalog.unlocks?.length && <details><summary>{t.worlds.hubPresetSummary}</summary>
          <p>{t.worlds.hubPresetHint}</p>
          <label>{t.worlds.hubTier}<select aria-label={t.worlds.hubTier} value={tier} onChange={e => { setTier(Number(e.target.value)); setPresetIds(null); }}>{[...new Set(catalog.unlocks.filter(u => u.kind === 'hub' && u.tier !== undefined).map(u => u.tier!))].sort((a, b) => a - b).map(t => <option key={t} value={t}>{t}</option>)}</select></label>
          <button className="secondary-button" onClick={() => setPresetIds(catalog.unlocks!.filter(u => u.kind === 'hub' && u.tier !== undefined && u.tier <= tier).map(u => u.id))}>{t.worlds.prepareUpToTier(tier)}</button>
          {presetIds && <><p>{t.worlds.refineStages}</p>{catalog.unlocks.filter(u => u.kind === 'hub' && u.tier !== undefined && u.tier <= tier).map(u => <div key={u.id}><label><input type="checkbox" checked={presetIds.includes(u.id)} onChange={() => setPresetIds(toggle(presetIds, u.id))} />{t.worlds.hubStageLabel(u.name || u.id, u.tier!)}</label></div>)}
            <button className="secondary-button" onClick={() => { try { edit(grantWorldUnlocks(catalog, draft, presetIds)); setPresetIds(null); } catch (e) { setError(e instanceof Error ? e.message : t.worlds.unlockSchemesFailed); } }}>{t.worlds.addSelectedStages}</button></>}
        </details>}
        {(['hub', 'mam', 'other'] as const).map(kind => <details key={kind}><summary>{t.worlds.kindSummary[kind]}</summary>{catalog.unlocks?.filter(u => u.kind === kind && matches(`${u.name} ${u.id} ${searchNames('schematic', u.id, u.name)}`)).map(u => <article key={u.id} className="saved-profile"><div><h3>{u.name || u.id}</h3><p>{t.worlds.kindLabel[kind]}{u.tier !== undefined && u.kind === 'hub' ? t.worlds.tierSuffix(u.tier) : ''}</p>
          {(u.prerequisiteGroups?.length ?? 0) > 0 ? <p>{t.worlds.knownConditions(u.prerequisiteGroups!.map(group => `(${group.map(unlockName).join(` ${t.worlds.or} `)})`).join(` ${t.worlds.and} `))}</p> : u.prerequisiteIds.length > 0 && <p>{t.worlds.knownPrerequisites(u.prerequisiteIds.map(unlockName).join(` ${t.worlds.and} `))}</p>}
          {!!u.schematicIds?.length && <p>{t.worlds.childSchematics(u.schematicIds.map(unlockName).join(', '))}</p>}</div>
          {u.kind === 'hub' && catalog.gamePhases?.length && <p className="hint">{researchDescription(catalog, u.id, draft.unlockedMilestoneIds).find(line => line.startsWith('Уровень HUB'))}</p>}
          {catalog.researchTrees?.length && <ResearchChainView catalog={catalog} roots={[u.id]} completed={draft.unlockedMilestoneIds} />}
          <button className="secondary-button" disabled={draft.unlockedMilestoneIds.includes(u.id)} onClick={() => grant(u)}>{draft.unlockedMilestoneIds.includes(u.id) ? t.worlds.markedOpen : t.worlds.addDiscoveries}</button>
          {draft.unlockedMilestoneIds.includes(u.id) && <button className="text-button" onClick={() => edit({ ...draft, unlockedMilestoneIds: draft.unlockedMilestoneIds.filter(id => id !== u.id) })}>{t.worlds.removeMark}</button>}
        </article>)}</details>)}
      </details>
      <details><summary>{t.worlds.sharedNodesSummary(draft.resourceNodes?.length ?? 0)}</summary>
        <p className="hint">{t.worlds.sharedNodesHint}</p>
        {(draft.resourceNodes ?? []).map((node, index) => <article className="source-card" key={node.id}>
          <label><span className="field-label">{t.worlds.nodeNameLabel}</span><input aria-label={t.worlds.nodeNameOf(index + 1)} maxLength={120} value={node.name} onChange={event => updateNode(node.id, { name: event.target.value })} /></label>
          <div className="source-fields"><label><span className="field-label">{t.worlds.resourceLabel}</span><select aria-label={t.worlds.nodeResourceOf(index + 1)} value={node.itemId} onChange={event => updateNode(node.id, { itemId: event.target.value })}>{catalog.items.filter(item => item.raw).map(item => <option key={item.id} value={item.id}>{gameName('item', item.id, item.name)}</option>)}</select></label>
            <label><span className="field-label">{t.worlds.nodeLimitLabel}</span><input type="number" min={0} max={1e9} step="any" aria-label={t.worlds.nodeLimitOf(index + 1)} value={node.limit} onChange={event => updateNode(node.id, { limit: Number(event.target.value) })} /></label></div>
          <button className="text-button danger" onClick={() => edit({ ...draft, resourceNodes: draft.resourceNodes?.filter(candidate => candidate.id !== node.id) })}>{t.worlds.removeNode}</button>
        </article>)}
        <button className="secondary-button" disabled={!catalog.items.some(item => item.raw)} onClick={() => {
          const item = catalog.items.find(candidate => candidate.raw);
          if (item) edit({ ...draft, resourceNodes: [...(draft.resourceNodes ?? []), { id: crypto.randomUUID(), name: t.worlds.defaultNodeName(gameName('item', item.id, item.name)), itemId: item.id, limit: 120 }] });
        }}>{t.worlds.addSharedNode}</button>
      </details>
      <fieldset><legend>{t.worlds.manualP2Legend}</legend>
        <p className="hint">{t.worlds.manualP2Hint}</p>
        <label><input type="checkbox" checked={draft.unlockedMilestoneIds.includes('p2:resource-wells')} onChange={() => edit({ ...draft, unlockedMilestoneIds: toggle(draft.unlockedMilestoneIds, 'p2:resource-wells') })} />{t.worlds.wellsOpen}</label>
        <label><input type="checkbox" checked={draft.unlockedMilestoneIds.includes('p2:production-amplifier')} onChange={() => edit({ ...draft, unlockedMilestoneIds: toggle(draft.unlockedMilestoneIds, 'p2:production-amplifier') })} />{t.worlds.amplifiersOpen}</label>
      </fieldset>
      <p className="hint">{t.worlds.finalDiscoveriesHint}</p>
      <details><summary>{t.worlds.recipesSummary(draft.unlockedRecipeIds.length, catalog.recipes.length)}</summary>
        {catalog.recipes.filter(r => matches(`${r.name} ${r.nameEn} ${searchNames('recipe', r.id, r.name)}`)).map(r => {
          const opened = draft.unlockedRecipeIds.includes(r.id);
          const prerequisites = catalog.unlocks?.filter(u => u.recipeIds.includes(r.id));
          return <div key={r.id}><label><input type="checkbox" checked={opened} onChange={() => edit({ ...draft, unlockedRecipeIds: toggle(draft.unlockedRecipeIds, r.id) })} />{gameName('recipe', r.id, r.name)}{r.alternate ? t.worlds.alternateSuffix : ''}</label>
            {!opened && <p className="hint">{t.worlds.closedInWorld} {prerequisites?.length ? t.worlds.unlockingSchematics(prerequisites.map(u => u.name).join(', ')) : t.worlds.recipeSourceUnmatched}</p>}</div>;
        })}
      </details>
      <details><summary>{t.worlds.buildingsSummary(draft.unlockedBuildingIds.length, catalog.buildings.length + catalog.miners.length)}</summary>
        {catalog.buildings.filter(b => matches(`${b.name} ${b.nameEn} ${searchNames('building', b.id, b.name)}`)).map(b => <div key={b.id}><label><input type="checkbox" checked={draft.unlockedBuildingIds.includes(b.id)} onChange={() => edit({ ...draft, unlockedBuildingIds: toggle(draft.unlockedBuildingIds, b.id) })} />{gameName('building', b.id, b.name)}</label><p className="hint">{catalog.unlocks?.filter(u => u.buildingIds.includes(b.id)).map(u => u.name).join(', ') || t.worlds.buildingSourceUnmatched}</p></div>)}
        <h3>{t.worlds.minersHeading}</h3><p className="hint">{t.worlds.minersHint}</p>
        {catalog.miners.filter(m => matches(`${m.name} ${searchNames('miner', m.id, m.name)}`)).map(m => <div key={m.id}><label><input type="checkbox" checked={draft.unlockedBuildingIds.includes(m.id)} onChange={() => edit({ ...draft, unlockedBuildingIds: toggle(draft.unlockedBuildingIds, m.id) })} />{gameName('miner', m.id, m.name)}</label><p className="hint">{catalog.unlocks?.filter(u => u.minerIds?.includes(m.id)).map(u => u.name).join(', ') || t.worlds.buildingSourceUnmatched}</p></div>)}
      </details>
      <label>{t.worlds.maxBelt}<select aria-label={t.worlds.maxBelt} value={draft.beltId} onChange={e => edit({ ...draft, beltId: e.target.value })}>{catalog.belts.map(belt => <option key={belt.id} value={belt.id}>{gameName('belt', belt.id, belt.name)}</option>)}</select></label>
      <label>{t.worlds.maxPipe}<select aria-label={t.worlds.maxPipe} value={draft.pipeId} onChange={e => edit({ ...draft, pipeId: e.target.value })}>{catalog.pipes.map(pipe => <option key={pipe.id} value={pipe.id}>{gameName('pipe', pipe.id, pipe.name)}</option>)}</select></label>
      <label><input type="checkbox" checked={draft.overclockUnlocked} onChange={e => edit({ ...draft, overclockUnlocked: e.target.checked })} />{t.worlds.overclockOpen}</label>
      <div className="toolbar-actions" style={{ flexWrap: 'wrap' }}><button className="primary-button" disabled={!draft.name.trim()} onClick={() => { try { setPreview(previewWorldUpdate(workspace, draft)); setError(''); } catch (e) { setError(e instanceof Error ? e.message : t.worlds.previewFailed); } }}>{t.worlds.previewChanges}</button><button className="secondary-button" onClick={() => { setDraft(null); setPreview(null); }}>{t.worlds.cancelDraft}</button></div>
    </fieldset>
    {preview && <section ref={previewRegion} tabIndex={-1} aria-label={t.worlds.previewRegion}><h3>{t.worlds.previewTitle}</h3>
      <p>{preview.before.name} → {preview.after.name}. {t.worlds.revisionChange(preview.before.revision, preview.after.revision)}</p>
      <p>{t.worlds.factoriesLine(preview.factories.map(f => f.name).join(', ') || t.worlds.noLinkedFactories)}</p>
      <ul>{(['recipes', 'buildings', 'milestones'] as const).map(kind => {
        const label = t.worlds.kindName[kind];
        const nameOf = (id: string) => kind === 'recipes' ? gameNameOf('recipe', catalog.recipes.find(r => r.id === id), id) : kind === 'buildings' ? catalog.buildings.some(b => b.id === id) ? gameNameOf('building', catalog.buildings.find(b => b.id === id), id) : gameNameOf('miner', catalog.miners.find(m => m.id === id), id) : unlockName(id);
        return <li key={kind}>{t.worlds.kindChange(label, preview[kind].added.map(nameOf).join(', ') || '—', preview[kind].removed.map(nameOf).join(', ') || '—')}</li>;
      })}</ul>
      <p>{t.worlds.nodesChange(preview.resources.added.map(node => node.name).join(', ') || '—', preview.resources.removed.map(node => node.name).join(', ') || '—', preview.resources.changed.map(change => t.worlds.nodeLimitChange(change.before.name, change.before.limit, change.after.limit)).join(', ') || '—')}</p>
      <p>{t.worlds.beltChange(transportName('belts', preview.before.beltId), transportName('belts', preview.after.beltId))}<br />{t.worlds.pipeChange(transportName('pipes', preview.before.pipeId), transportName('pipes', preview.after.pipeId))}<br />{t.worlds.overclockChange(preview.before.overclockUnlocked, preview.after.overclockUnlocked)}</p>
      <p className="hint">{t.worlds.previewKeepsHint}</p>
      {!preview.after.overclockUnlocked && <p>{t.worlds.overclockClosedWarning}</p>}
      <button className="primary-button" disabled={locked} onClick={() => void run(async () => {
        const next = applyWorldUpdate(workspace, preview);
        await save(next, t.worlds.progressApplied);
        if (active?.worldId === preview.after.id || plan.world?.id === preview.after.id) setPlan(current => ({ ...current, world: snapshotWorld(preview.after) }));
        setDraft(null); setPreview(null);
      })}>{t.worlds.applyToFactories(preview.factories.length)}</button>
    </section>}
  </section>}</div>;
}
