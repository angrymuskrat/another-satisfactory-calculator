import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { Catalog, Plan, Unlock } from '../../../packages/domain/types';
import { applyRecipeSetup, prepareRecipeSetup, prepareDiskSetup, prepareWorkspaceRecipeSetup, unlockOrigin, type AlternativeMode, type RecipeSetup as Setup, type SetupOperation } from '../../../packages/domain/recipeProgress';
import { phaseForTier } from '../../../packages/domain/research';
import type { useWorldWorkspace } from './useWorldWorkspace';

export interface RecipeSetupProps {
  catalog: Catalog; plan: Plan; setPlan: Dispatch<SetStateAction<Plan>>;
  store: ReturnType<typeof useWorldWorkspace>; activeFactoryId: string | null;
}
function GroupCheck({ label, ids, selected, change }: { label: string; ids: string[]; selected: string[]; change: (ids: string[], on: boolean) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const count = ids.filter(id => selected.includes(id)).length;
  useEffect(() => { if (input.current) input.current.indeterminate = count > 0 && count < ids.length; }, [count, ids.length]);
  return <label className="setup-check"><input ref={input} type="checkbox" checked={ids.length > 0 && count === ids.length} disabled={!ids.length}
    onChange={e => change(ids, e.target.checked)} />{label}<small>{count}/{ids.length}</small></label>;
}
export function RecipeSetup({ catalog, plan, setPlan, store, activeFactoryId }: RecipeSetupProps) {
  const selectable = useMemo(() => catalog.unlocks?.filter(u => ['hub', 'mam'].includes(unlockOrigin(u))) ?? [], [catalog]);
  const signature = JSON.stringify(plan.world?.unlockedMilestoneIds ?? plan.recipeProgress?.unlockIds ?? []);
  const [ids, setIds] = useState<string[]>([]);
  const [section, setSection] = useState<'hub' | 'mam'>('hub');
  const [tier, setTier] = useState(0);
  const [alternatives, setAlternatives] = useState<AlternativeMode>('keep');
  const [preview, setPreview] = useState<Setup | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const previewRegion = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const inFlight = useRef(false);
  const world = store.workspace.worlds.find(w => w.id === plan.world?.id);
  const workspaceSignature = JSON.stringify(store.workspace);
  const previewWorkspace = useRef('');
  useEffect(() => { setIds((JSON.parse(signature) as string[]).filter(id => selectable.some(u => u.id === id))); setPreview(null); }, [signature, selectable, plan.world?.id]);
  useEffect(() => { if (preview) previewRegion.current?.focus(); }, [preview]);
  const change = (values: string[], on: boolean) => {
    setIds(current => on ? [...new Set([...current, ...values])] : current.filter(id => !values.includes(id)));
    setPreview(null); setMessage('');
  };
  const hubs = selectable.filter(u => unlockOrigin(u) === 'hub').sort((a, b) => (a.tier ?? 0) - (b.tier ?? 0) || a.name.localeCompare(b.name, 'ru'));
  const tiers = [...new Set(hubs.map(u => u.tier ?? 0))];
  const phases = [...new Map(tiers.map(t => {
    const phase = phaseForTier(catalog, t);
    return [phase?.id ?? 'unknown', { id: phase?.id ?? 'unknown', name: phase?.name ?? 'Начало прохождения' }];
  })).values()];
  const prepare = (operation: SetupOperation, button: HTMLButtonElement, disksOnly = false) => {
    setError(''); setMessage(''); trigger.current = button;
    try {
      const next = disksOnly ? prepareDiskSetup(catalog, plan, ids) : prepareRecipeSetup(catalog, plan, ids, operation, alternatives);
      if (world) prepareWorkspaceRecipeSetup(store.workspace, plan, next, activeFactoryId);
      previewWorkspace.current = workspaceSignature; setPreview(next);
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось подготовить настройку.'); }
  };
  const stale = !!preview && (JSON.stringify(plan) !== JSON.stringify(preview.before) || previewWorkspace.current !== workspaceSignature);
  const apply = async () => {
    if (!preview || inFlight.current) return;
    inFlight.current = true; setSaving(true); setError('');
    try {
      if (stale) throw new Error('План или мир изменился. Подготовьте просмотр заново.');
      let next = applyRecipeSetup(plan, preview);
      if (world) {
        const update = prepareWorkspaceRecipeSetup(store.workspace, plan, preview, activeFactoryId);
        await store.save(update.workspace); next = update.plan;
      }
      // Асинхронное сохранение мира не должно перезаписать новый план/заказ пользователя.
      setPlan(current => JSON.stringify(current) === JSON.stringify(preview.before) ? next
        : current.world?.id === next.world?.id && next.world ? { ...current, world: next.world } : current);
      setPreview(null); setMessage(world ? 'Настройка сохранена в мире. Локальные запреты других фабрик сохранены.' : 'Настройка применена к текущему плану.');
      trigger.current?.focus();
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось применить настройку.'); }
    finally { inFlight.current = false; setSaving(false); }
  };
  const recipeName = (id: string) => catalog.recipes.find(r => r.id === id)?.name ?? id;
  const buildingName = (id: string) => [...catalog.buildings, ...catalog.miners].find(b => b.id === id)?.name ?? id;
  const unlockCheck = (u: Unlock, kind: string) => <label className="setup-check" key={u.id}>
    <input type="checkbox" aria-label={`${kind}: ${u.name}`} checked={ids.includes(u.id)} onChange={e => change([u.id], e.target.checked)} />{u.name}
  </label>;
  const diff = (before: string[], after: string[], name: (id: string) => string, title: string) => {
    const added = after.filter(id => !before.includes(id)), removed = before.filter(id => !after.includes(id));
    return <details><summary>{title}: добавить {added.length} · выключить {removed.length}</summary>
      <p>Добавить: {added.map(name).join(', ') || '—'}</p><p>Выключить: {removed.map(name).join(', ') || '—'}</p></details>;
  };
  const affected = world ? store.workspace.factories.filter(f => f.worldId === world.id) : [];
  return <details className="panel recipe-setup"><summary>Быстрая настройка по прогрессу</summary>
    <p>Отметьте завершённые этапы HUB и исследования MAM. Выбор группы отмечает все её этапы; достижение фазы само по себе не означает их завершение.</p>
    <p className="hint">{world ? `Общий мир «${world.name}». Просмотр покажет изменения для связанных фабрик.` : plan.world ? 'Изменяется только снимок мира этого плана: общего мира в текущем рабочем пространстве нет.' : 'Изменяется текущий план. Выбор этапов сохранится вместе с ним.'}</p>
    <fieldset disabled={saving || store.busy || !store.ready}>
      <legend>Выбор прогресса · отмечено {ids.length}</legend>
      <div className="setup-actions"><button type="button" className="secondary-button" aria-pressed={section === 'hub'} onClick={() => setSection('hub')}>Фазы и этапы HUB</button>
        <button type="button" className="secondary-button" aria-pressed={section === 'mam'} onClick={() => setSection('mam')}>Исследования MAM</button>
        <button type="button" className="text-button" onClick={() => { setIds([]); setPreview(null); }}>Снять весь выбор</button></div>
      {section === 'hub' ? <>
        <div className="setup-controls"><label>Всё до уровня HUB<select value={tier} onChange={e => { setTier(Number(e.target.value)); setPreview(null); }}>{tiers.map(t => <option key={t} value={t}>{t}</option>)}</select></label>
          <button type="button" className="secondary-button" onClick={() => { setIds(current => [...current.filter(id => !hubs.some(u => u.id === id)), ...hubs.filter(u => (u.tier ?? 0) <= tier).map(u => u.id)]); setPreview(null); }}>Выбрать всё до уровня {tier}</button></div>
        <p className="hint">Эта кнопка заменяет выбор HUB до указанного уровня. Выбор MAM сохраняется. Можно снять незавершённые этапы ниже.</p>
        {phases.map(phase => {
          const members = hubs.filter(u => (phaseForTier(catalog, u.tier ?? 0)?.id ?? 'unknown') === phase.id);
          return <details key={phase.id}><summary>{phase.name}</summary>
            <GroupCheck label={`Вся фаза: ${phase.name}`} ids={members.map(u => u.id)} selected={ids} change={change} />
            {tiers.filter(t => members.some(u => (u.tier ?? 0) === t)).map(t => <details key={t}><summary>Уровень HUB {t}</summary>
              <GroupCheck label={`Весь уровень HUB ${t}`} ids={members.filter(u => (u.tier ?? 0) === t).map(u => u.id)} selected={ids} change={change} />
              {members.filter(u => (u.tier ?? 0) === t).map(u => unlockCheck(u, 'Этап'))}</details>)}
          </details>;
        })}
      </> : <>
        <p className="hint">MAM независим от HUB. Можно отметить позднее исследование после находок в обломках. Предки автоматически не отмечаются. Внешние события и неизвестные связи не считаются выполненными.</p>
        {catalog.researchTrees?.filter(t => !t.seasonal).map(tree => {
          const members = selectable.filter(u => tree.nodes.some(n => n.schematicId === u.id));
          return <details key={tree.id}><summary>{tree.name}</summary>
            <GroupCheck label={`Вся ветка: ${tree.name}`} ids={members.map(u => u.id)} selected={ids} change={change} />
            {members.map(u => unlockCheck(u, 'Исследование'))}</details>;
        })}
      </>}
      <label>Альтернативы в настройке<select value={alternatives} onChange={e => { setAlternatives(e.target.value as AlternativeMode); setPreview(null); }}>
        <option value="none">Без альтернатив (при добавлении старые сохраняются)</option><option value="keep">Сохранить выбранные альтернативы</option><option value="all">Все подходящие альтернативы из дисков</option>
      </select></label>
      <p className="hint">«Все подходящие» добавляет рецепты по известным условиям схем выбранного прогресса. Это допущение для планирования, а не отметка изучения дисков. Рецепты MAM открываются выбранными исследованиями. Наличие ресурсов и производственных зданий проверяется отдельно.</p>
      <div className="setup-actions"><button type="button" className="secondary-button" onClick={e => prepare('replace', e.currentTarget)}>Заменить набор</button>
        <button type="button" className="primary-button" onClick={e => prepare('add', e.currentTarget)}>Добавить к текущему</button>
        <button type="button" className="text-button" onClick={e => prepare('add', e.currentTarget, true)}>Добавить все подходящие альтернативы</button></div>
      <p className="hint">Отдельная кнопка альтернатив добавляет только рецепты из дисков по выбранному прогрессу; обычные рецепты и оборудование сохраняются.</p>
      <p className="hint">Замена выключает остальные рецепты и заменяет доступное оборудование и транспорт по выбранным схемам. Добавление сохраняет текущий набор. Заказ, источники, частоты и энергетические лимиты сохраняются.</p>
    </fieldset>
    {preview && <section className="setup-preview" tabIndex={-1} ref={previewRegion} aria-label="Просмотр настройки рецептов">
      <h2>{preview.operation === 'replace' ? 'Замена набора' : 'Добавление к текущему набору'}</h2>
      {diff(plan.settings.enabledRecipeIds, preview.plan.settings.enabledRecipeIds, recipeName, 'Рецепты текущей фабрики')}
      {diff(plan.settings.enabledBuildingIds, preview.plan.settings.enabledBuildingIds, buildingName, 'Здания текущей фабрики')}
      <p>Транспорт: {catalog.belts.find(t => t.id === preview.plan.settings.beltId)?.name}; {catalog.pipes.find(t => t.id === preview.plan.settings.pipeId)?.name}.</p>
      {preview.plan.world && plan.world && <>
        {diff(plan.world.unlockedRecipeIds, preview.plan.world.unlockedRecipeIds, recipeName, 'Открытия рецептов мира')}
        {diff(plan.world.unlockedBuildingIds, preview.plan.world.unlockedBuildingIds, buildingName, 'Открытия зданий и добытчиков мира')}
        <p>Разгон в мире: {preview.plan.world.overclockUnlocked ? 'открыт' : 'закрыт'}. Связанных фабрик: {affected.length}{affected.length ? ` — ${affected.map(f => f.name).join(', ')}` : ''}.</p>
        {world && <p>Открытия мира применятся ко всем этим фабрикам. Локальные настройки рецептов, зданий и транспорта сохранятся только для текущей активной фабрики; её несохранённый заказ останется черновиком.</p>}
      </>}
      {preview.alternatives === 'all' && <p>Подходящих рецептов из дисков: {preview.eligibleAlternatives.length}. Их изучение не отмечается автоматически.</p>}
      {!!preview.unknownAlternatives.length && <details><summary>Неизвестные условия: {preview.unknownAlternatives.length} — автоматически не добавляются</summary><p>{preview.unknownAlternatives.map(recipeName).join(', ')}</p></details>}
      {!!plan.lines?.length && <p className="hint">Существующие линии сохраняются. Выключение их рецептов или зданий может сделать расчёт невыполнимым.</p>}
      {stale && <p role="status">Просмотр устарел. Подготовьте настройку заново.</p>}
      <div className="setup-actions"><button type="button" className="primary-button" disabled={stale || saving || store.busy} onClick={() => void apply()}>Применить настройку</button>
        <button type="button" className="secondary-button" disabled={saving} onClick={() => { setPreview(null); trigger.current?.focus(); }}>Отменить просмотр</button></div>
    </section>}
    {error && <p role="alert" className="form-error">{error}</p>}{message && <p role="status">{message}</p>}
  </details>;
}
