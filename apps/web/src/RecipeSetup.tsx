import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { Catalog, Plan } from '../../../packages/domain/types';
import { applyRecipeSetup, prepareRecipeSetup, prepareDiskSetup, prepareWorkspaceRecipeSetup, unlockOrigin, type AlternativeMode, type RecipeSetup as Setup, type SetupOperation } from '../../../packages/domain/recipeProgress';
import { phaseForTier } from '../../../packages/domain/research';
import { exportRecipeSettings, parseRecipeSettings, prepareRecipeSettingsImport } from '../../../packages/domain/recipeSettingsFile';
import { downloadJson } from './controls';
import type { useWorldWorkspace } from './useWorldWorkspace';
import { HubBoard, MamBoard, type HubPhase } from './ProgressBoard';
import { useT } from './i18n';
import { gameName, nameCollator } from './i18n/gameNames';

export interface RecipeSetupProps {
  catalog: Catalog; plan: Plan; setPlan: Dispatch<SetStateAction<Plan>>;
  store: ReturnType<typeof useWorldWorkspace>; activeFactoryId: string | null;
}
export function RecipeSetup({ catalog, plan, setPlan, store, activeFactoryId }: RecipeSetupProps) {
  const t = useT();
  const selectable = useMemo(() => catalog.unlocks?.filter(u => ['hub', 'mam'].includes(unlockOrigin(u))) ?? [], [catalog]);
  const signature = JSON.stringify(plan.world?.unlockedMilestoneIds ?? plan.recipeProgress?.unlockIds ?? []);
  const [ids, setIds] = useState<string[]>([]);
  const [section, setSection] = useState<'hub' | 'mam'>('hub');
  const [alternatives, setAlternatives] = useState<AlternativeMode>('keep');
  const [preview, setPreview] = useState<Setup | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const previewRegion = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const inFlight = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const importButton = useRef<HTMLButtonElement>(null);
  const world = store.workspace.worlds.find(w => w.id === plan.world?.id);
  const workspaceSignature = JSON.stringify(store.workspace);
  const previewWorkspace = useRef('');
  useEffect(() => { setIds((JSON.parse(signature) as string[]).filter(id => selectable.some(u => u.id === id))); setPreview(null); }, [signature, selectable, plan.world?.id]);
  useEffect(() => { if (preview) previewRegion.current?.focus(); }, [preview]);
  const change = (values: string[], on: boolean) => {
    setIds(current => on ? [...new Set([...current, ...values])] : current.filter(id => !values.includes(id)));
    setPreview(null); setMessage('');
  };
  const collator = nameCollator();
  const hubs = selectable.filter(u => unlockOrigin(u) === 'hub').sort((a, b) => (a.tier ?? 0) - (b.tier ?? 0) || collator.compare(gameName('schematic', a.id, a.name), gameName('schematic', b.id, b.name)));
  const tiers = [...new Set(hubs.map(u => u.tier ?? 0))];
  const phases = [...tiers.reduce((map, tier) => {
    const phase = phaseForTier(catalog, tier), id = phase?.id ?? 'unknown';
    const entry = map.get(id) ?? { id, name: phase ? gameName('gamePhase', phase.id, phase.name) : t.recipeSetup.startOfGame, tiers: [] };
    entry.tiers.push(tier);
    return map.set(id, entry);
  }, new Map<string, HubPhase>()).values()];
  const preparePreview = (build: () => Setup, button: HTMLButtonElement | null) => {
    setError(''); setMessage(''); trigger.current = button;
    try {
      const next = build();
      if (world) prepareWorkspaceRecipeSetup(store.workspace, plan, next, activeFactoryId);
      previewWorkspace.current = workspaceSignature; setPreview(next);
    } catch (e) { setError(e instanceof Error ? e.message : t.recipeSetup.prepareFailed); }
  };
  const prepare = (operation: SetupOperation, button: HTMLButtonElement, disksOnly = false) =>
    preparePreview(() => disksOnly ? prepareDiskSetup(catalog, plan, ids) : prepareRecipeSetup(catalog, plan, ids, operation, alternatives), button);
  const exportFile = () => {
    const name = plan.name.replace(/[^\p{L}\p{N}_-]/gu, '-').slice(0, 60) || 'factory';
    downloadJson(JSON.stringify(exportRecipeSettings(catalog, plan), null, 2), `${name}-recipes.json`);
    setError(''); setMessage(t.recipeSetup.fileSaved);
  };
  const importFile = async (file?: File) => {
    if (fileInput.current) fileInput.current.value = '';
    if (!file) return;
    let value: unknown;
    try {
      if (file.size > 2_000_000) throw new Error(t.app.importTooLarge);
      value = JSON.parse(await file.text());
    } catch (e) { setMessage(''); setError(e instanceof SyntaxError ? t.recipeSetup.notJson : e instanceof Error ? e.message : t.recipeSetup.readFailed); return; }
    preparePreview(() => prepareRecipeSettingsImport(catalog, plan, parseRecipeSettings(value, catalog)), importButton.current);
  };
  const stale = !!preview && (JSON.stringify(plan) !== JSON.stringify(preview.before) || previewWorkspace.current !== workspaceSignature);
  const apply = async () => {
    if (!preview || inFlight.current) return;
    inFlight.current = true; setSaving(true); setError('');
    try {
      if (stale) throw new Error(t.recipeSetup.stalePreviewError);
      let next = applyRecipeSetup(plan, preview);
      if (world) {
        const update = prepareWorkspaceRecipeSetup(store.workspace, plan, preview, activeFactoryId);
        await store.save(update.workspace); next = update.plan;
      }
      // Асинхронное сохранение мира не должно перезаписать новый план/заказ пользователя.
      setPlan(current => JSON.stringify(current) === JSON.stringify(preview.before) ? next
        : current.world?.id === next.world?.id && next.world ? { ...current, world: next.world } : current);
      setPreview(null); setMessage(preview.importedFrom ? (world ? t.recipeSetup.importedSavedInWorld : t.recipeSetup.importedApplied) : world ? t.recipeSetup.savedInWorld : t.recipeSetup.applied);
      trigger.current?.focus();
    } catch (e) { setError(e instanceof Error ? e.message : t.recipeSetup.applyFailed); }
    finally { inFlight.current = false; setSaving(false); }
  };
  const recipeName = (id: string) => { const found = catalog.recipes.find(r => r.id === id); return found ? gameName('recipe', found.id, found.name) : id; };
  const buildingName = (id: string) => {
    const building = catalog.buildings.find(b => b.id === id);
    if (building) return gameName('building', building.id, building.name);
    const miner = catalog.miners.find(b => b.id === id);
    return miner ? gameName('miner', miner.id, miner.name) : id;
  };
  const diff = (before: string[], after: string[], name: (id: string) => string, title: string) => {
    const added = after.filter(id => !before.includes(id)), removed = before.filter(id => !after.includes(id));
    return <details><summary>{t.recipeSetup.diffSummary(title, added.length, removed.length)}</summary>
      <p>{t.recipeSetup.diffAdd(added.map(name).join(', ') || '—')}</p><p>{t.recipeSetup.diffRemove(removed.map(name).join(', ') || '—')}</p></details>;
  };
  const transportName = (kind: 'belt' | 'pipe', id: string) => {
    const found = (kind === 'belt' ? catalog.belts : catalog.pipes).find(entry => entry.id === id);
    return found ? gameName(kind, found.id, found.name) : '';
  };
  const affected = world ? store.workspace.factories.filter(f => f.worldId === world.id) : [];
  return <details className="panel recipe-setup"><summary>{t.recipeSetup.title}</summary>
    <p>{t.recipeSetup.intro}</p>
    <p className="hint">{world ? t.recipeSetup.scopeWorld(world.name) : plan.world ? t.recipeSetup.scopeSnapshot : t.recipeSetup.scopePlan}</p>
    <fieldset disabled={saving || store.busy || !store.ready}>
      <legend>{t.recipeSetup.selectionLegend(ids.length)}</legend>
      <div className="setup-actions"><button type="button" className="secondary-button" onClick={exportFile}>{t.recipeSetup.exportFile}</button>
        <button type="button" className="secondary-button" ref={importButton} onClick={() => fileInput.current?.click()}>{t.recipeSetup.importFile}</button>
        <input hidden ref={fileInput} type="file" accept=".json,application/json" aria-label={t.recipeSetup.fileLabel} onChange={e => void importFile(e.target.files?.[0])} /></div>
      <p className="hint">{t.recipeSetup.fileHint}</p>
      <div className="setup-actions"><button type="button" className="secondary-button" aria-pressed={section === 'hub'} onClick={() => setSection('hub')}>{t.recipeSetup.sectionHub}</button>
        <button type="button" className="secondary-button" aria-pressed={section === 'mam'} onClick={() => setSection('mam')}>{t.recipeSetup.sectionMam}</button>
        <button type="button" className="text-button" onClick={() => { setIds([]); setPreview(null); }}>{t.recipeSetup.clearSelection}</button></div>
      {section === 'hub' ? <>
        <HubBoard hubs={hubs} phases={phases} selected={ids} change={change} />
      </> : <>
        <p className="hint">{t.recipeSetup.mamHint}</p>
        <MamBoard catalog={catalog} selectable={selectable} selected={ids} change={change} />
      </>}
      <label>{t.recipeSetup.alternativesLabel}<select value={alternatives} onChange={e => { setAlternatives(e.target.value as AlternativeMode); setPreview(null); }}>
        <option value="none">{t.recipeSetup.alternatives.none}</option><option value="keep">{t.recipeSetup.alternatives.keep}</option><option value="all">{t.recipeSetup.alternatives.all}</option>
      </select></label>
      <p className="hint">{t.recipeSetup.alternativesHint}</p>
      <div className="setup-actions"><button type="button" className="secondary-button" onClick={e => prepare('replace', e.currentTarget)}>{t.recipeSetup.replaceSet}</button>
        <button type="button" className="primary-button" onClick={e => prepare('add', e.currentTarget)}>{t.recipeSetup.addToCurrent}</button>
        <button type="button" className="text-button" onClick={e => prepare('add', e.currentTarget, true)}>{t.recipeSetup.addAllAlternatives}</button></div>
      <p className="hint">{t.recipeSetup.alternativesButtonHint}</p>
      <p className="hint">{t.recipeSetup.replaceHint}</p>
    </fieldset>
    {preview && <section className="setup-preview" tabIndex={-1} ref={previewRegion} aria-label={t.recipeSetup.previewLabel}>
      <h2>{preview.importedFrom ? t.recipeSetup.importTitle(preview.importedFrom.name) : preview.operation === 'replace' ? t.recipeSetup.replaceTitle : t.recipeSetup.addTitle}</h2>
      {preview.importedFrom && <p>{t.recipeSetup.importStats(preview.plan.recipeProgress?.unlockIds.length ?? 0, preview.plan.settings.clock, Object.keys(preview.plan.settings.buildingLimits ?? {}).length)}
        {preview.importedFrom.catalogVersion !== catalog.version && t.recipeSetup.importVersionNote(preview.importedFrom.catalogVersion, catalog.version)}</p>}
      {preview.importedFrom && plan.world && <p className="hint">{t.recipeSetup.importWorldHint}</p>}
      {diff(plan.settings.enabledRecipeIds, preview.plan.settings.enabledRecipeIds, recipeName, t.recipeSetup.diffRecipes)}
      {diff(plan.settings.enabledBuildingIds, preview.plan.settings.enabledBuildingIds, buildingName, t.recipeSetup.diffBuildings)}
      <p>{t.recipeSetup.transport(transportName('belt', preview.plan.settings.beltId), transportName('pipe', preview.plan.settings.pipeId))}</p>
      {preview.plan.world && plan.world && <>
        {diff(plan.world.unlockedRecipeIds, preview.plan.world.unlockedRecipeIds, recipeName, t.recipeSetup.diffWorldRecipes)}
        {diff(plan.world.unlockedBuildingIds, preview.plan.world.unlockedBuildingIds, buildingName, t.recipeSetup.diffWorldBuildings)}
        <p>{t.recipeSetup.worldOverclock(preview.plan.world.overclockUnlocked, affected.length, affected.map(f => f.name))}</p>
        {world && <p>{t.recipeSetup.worldAppliesAll}</p>}
      </>}
      {preview.alternatives === 'all' && <p>{t.recipeSetup.eligibleAlternatives(preview.eligibleAlternatives.length)}</p>}
      {!!preview.unknownAlternatives.length && <details><summary>{t.recipeSetup.unknownAlternatives(preview.unknownAlternatives.length)}</summary><p>{preview.unknownAlternatives.map(recipeName).join(', ')}</p></details>}
      {!!plan.lines?.length && <p className="hint">{t.recipeSetup.existingLinesHint}</p>}
      {stale && <p role="status">{t.recipeSetup.stalePreview}</p>}
      <div className="setup-actions"><button type="button" className="primary-button" disabled={stale || saving || store.busy} onClick={() => void apply()}>{t.recipeSetup.apply}</button>
        <button type="button" className="secondary-button" disabled={saving} onClick={() => { setPreview(null); trigger.current?.focus(); }}>{t.recipeSetup.cancelPreview}</button></div>
    </section>}
    {error && <p role="alert" className="form-error">{error}</p>}{message && <p role="status">{message}</p>}
  </details>;
}
