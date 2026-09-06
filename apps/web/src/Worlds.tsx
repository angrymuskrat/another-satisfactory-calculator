import { useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { Catalog, Plan, Unlock } from '../../../packages/domain/types';
import { createDefaultPlan } from '../../../packages/domain/defaults';
import { applyWorldUpdate, createFactory, createWorld, grantWorldUnlocks, mergeWorkspace, previewWorldUpdate, snapshotWorld, type World, type Workspace } from '../../../packages/domain/worlds';
import { parseCatalogWorkspace, WORKSPACE_KEY } from './planStorage';
import type { useWorldWorkspace } from './useWorldWorkspace';

type Store = ReturnType<typeof useWorldWorkspace>;
interface Props {
  catalog: Catalog; plan: Plan; setPlan: Dispatch<SetStateAction<Plan>>; store: Store;
  activeFactoryId: string | null; setActiveFactoryId: (id: string | null) => void;
}
function download(raw: string, name: string) {
  const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}
const toggle = (values: string[], id: string) => values.includes(id) ? values.filter(value => value !== id) : [...values, id];

export function Worlds({ catalog, plan, setPlan, store, activeFactoryId, setActiveFactoryId }: Props) {
  const { workspace, ready, busy } = store;
  const [draft, setDraft] = useState<World | null>(null);
  const [preview, setPreview] = useState<ReturnType<typeof previewWorldUpdate> | null>(null);
  const [selectedWorld, setSelectedWorld] = useState('');
  const [name, setName] = useState('Новое прохождение');
  const [search, setSearch] = useState('');
  const [tier, setTier] = useState(0);
  const [presetIds, setPresetIds] = useState<string[] | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const locked = !ready || busy;
  const run = async (action: () => Promise<void>) => {
    setError(''); setMessage('');
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось сохранить изменения.'); }
  };
  const edit = (next: World) => { setDraft(next); setPreview(null); };
  const world = workspace.worlds.find(w => w.id === selectedWorld);
  const active = workspace.factories.find(f => f.id === activeFactoryId);
  const dirty = active && JSON.stringify(active.plan) !== JSON.stringify(plan);
  const save = async (next: Workspace, notice: string) => { await store.save(next); setMessage(notice); };
  const addWorld = async (fromPlan: boolean) => {
    const created = createWorld(catalog, name, crypto.randomUUID(), fromPlan ? plan : undefined);
    await save({ ...workspace, worlds: [...workspace.worlds, created] }, 'Мир сохранён. Откройте редактор прогресса, чтобы уточнить открытия.');
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
    await save({ ...workspace, factories: [...workspace.factories, factory] }, 'Фабрика сохранена. Настройки и заказ редактируются в планировщике; изменения сохраняйте кнопкой «Сохранить фабрику».');
    setActiveFactoryId(factory.id); setPlan(structuredClone(factory.plan));
  };
  const saveFactory = async () => {
    if (!active) return;
    const linked = workspace.worlds.find(w => w.id === active.worldId);
    const next = createFactory(plan, active.id, linked);
    await save({ ...workspace, factories: workspace.factories.map(f => f.id === active.id ? next : f) }, 'Полный план фабрики сохранён.');
    setPlan(current => ({ ...current, ...(linked ? { world: snapshotWorld(linked) } : {}) }));
  };
  const grant = (unlock: Unlock) => {
    if (!draft) return;
    try { edit(grantWorldUnlocks(catalog, draft, [unlock.id])); }
    catch (e) { setError(e instanceof Error ? e.message : 'Не удалось применить схему.'); }
  };
  const importWorkspace = async (file?: File) => {
    if (!file) return;
    await run(async () => {
      if (file.size > 8 * 1024 * 1024) throw new Error('Максимальный размер рабочего пространства — 8 МБ.');
      const imported = parseCatalogWorkspace(JSON.parse(await file.text()), catalog);
      await save(mergeWorkspace(workspace, imported, () => crypto.randomUUID()), 'Рабочее пространство импортировано как копии. Существующие фабрики и миры сохранены.');
    });
    if (input.current) input.current.value = '';
  };
  const matches = (value: string) => value.toLocaleLowerCase('ru-RU').includes(search.toLocaleLowerCase('ru-RU'));
  const transportName = (kind: 'belts' | 'pipes', id: string) => catalog[kind].find(t => t.id === id)?.name ?? id;
  const unlockName = (id: string) => catalog.unlocks?.find(u => u.id === id)?.name ?? id;
  return <div className="worlds-view"><section className="panel">
    <h2>Миры и фабрики</h2>
    <p className="hint">{store.ownerId ? 'Рабочее пространство текущего аккаунта. Запись на сервер выполняется по кнопке сохранения.' : 'Гостевое пространство этого браузера. Для переноса используйте JSON или войдите через «Профили».'} Старые профили и локальный черновик доступны отдельно.</p>
    {store.error && <p role="alert" className="form-error">{store.error} Исходные данные не перезаписаны.</p>}
    {error && <p role="alert" className="form-error">{error}</p>}
    {message && <p role="status" className="form-success">{message}</p>}
    <div className="toolbar-actions" style={{ flexWrap: 'wrap' }}>
      <button className="secondary-button" disabled={busy || !!draft} onClick={() => { void store.load(); }}>Загрузить рабочее пространство заново</button>
      <button className="secondary-button" onClick={() => download(JSON.stringify(workspace, null, 2), 'ficsit-workspace.json')} disabled={!ready}>Экспорт рабочего пространства в JSON</button>
      <button className="secondary-button" disabled={locked || !!draft} onClick={() => input.current?.click()}>Импорт рабочего пространства из JSON</button>
      {!ready && <button className="secondary-button" onClick={() => { const raw = localStorage.getItem(WORKSPACE_KEY); if (raw) download(raw, 'ficsit-workspace-recovery.json'); }}>Экспорт исходного гостевого файла</button>}
      <input ref={input} className="sr-only" type="file" accept=".json,application/json" aria-label="Файл рабочего пространства JSON" onChange={e => void importWorkspace(e.target.files?.[0])} />
    </div>
    <fieldset disabled={locked || !!draft}><legend>Новое прохождение</legend>
      <label>Название мира<input aria-label="Название мира" value={name} maxLength={120} onChange={e => setName(e.target.value)} /></label>
      <div className="toolbar-actions" style={{ flexWrap: 'wrap' }}><button className="secondary-button" disabled={!name.trim()} onClick={() => void run(() => addWorld(false))}>Создать пустой мир</button>
        <button className="secondary-button" disabled={!name.trim()} onClick={() => void run(() => addWorld(true))}>Создать мир из настроек плана</button></div>
      <p className="hint">Пустой мир: рецепты и здания закрыты, транспорт — минимальный из каталога. Копия настроек плана — ручное начальное состояние, а не подтверждение прохождения HUB/MAM.</p>
    </fieldset>
    <fieldset disabled={locked || !!draft}><legend>Миры</legend>
      {workspace.worlds.map(w => <article className="saved-profile" key={w.id}><div><h3>{w.name}</h3><p>Ревизия {w.revision} · рецептов {w.unlockedRecipeIds.length} · зданий {w.unlockedBuildingIds.length} · фабрик {workspace.factories.filter(f => f.worldId === w.id).length}</p></div><button className="secondary-button" onClick={() => { setDraft(structuredClone(w)); setPreview(null); setSearch(''); }}>Изменить прогресс {w.name}</button></article>)}
      {!workspace.worlds.length && <p>Создайте мир и отметьте доступные открытия.</p>}
    </fieldset>
    <fieldset disabled={locked || !!draft}><legend>Фабрики</legend>
      <label>Мир для новой фабрики<select aria-label="Мир для новой фабрики" value={selectedWorld} onChange={e => setSelectedWorld(e.target.value)}><option value="">Самостоятельный план</option>{workspace.worlds.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
      <div className="toolbar-actions" style={{ flexWrap: 'wrap' }}><button className="secondary-button" disabled={!!dirty} onClick={() => void run(() => addFactory(false))}>Новая фабрика</button><button className="secondary-button" onClick={() => void run(() => addFactory(true))}>Сохранить копию текущего плана</button>
        {active && <button className="primary-button" onClick={() => void run(saveFactory)}>Сохранить фабрику «{active.name}»</button>}</div>
      <p className="hint">Источники, заказ и локальные исключения принадлежат фабрике. Её полный план хранится отдельно. При открытии фабрики текущий рабочий черновик заменяется; сначала сохраните его копию, если он нужен.</p>
      {dirty && <p role="status">В открытой фабрике есть несохранённые изменения. Сохраните их или откройте её сохранённую версию.</p>}
      {workspace.factories.map(f => <article className="saved-profile" key={f.id}><div><h3>{f.name}{f.id === activeFactoryId ? ' · открыта' : ''}</h3><p>{workspace.worlds.find(w => w.id === f.worldId)?.name ?? 'Самостоятельный план'} · {f.plan.sources.length} источников</p></div>
        <button className="secondary-button" disabled={!!dirty && f.id !== activeFactoryId} onClick={() => { setPlan(structuredClone(f.plan)); setActiveFactoryId(f.id); setMessage(`Фабрика «${f.name}» открыта. Перейдите в планировщик.`); }}>Открыть {f.name}{dirty && f.id === activeFactoryId ? ' без несохранённых изменений' : ''}</button></article>)}
    </fieldset>
  </section>{draft && <section className="panel"><h2>Черновик прогресса: {draft.name}</h2>
    <p className="hint">До применения просмотренных изменений действующий мир и фабрики не меняются. Открытие здания не открывает автоматически все его рецепты. Выбранные в плане рецепты дополнительно ограничены открытиями мира.</p>
    <fieldset disabled={busy}><legend>Открытия мира</legend>
      <label>Имя прохождения<input aria-label="Имя прохождения" value={draft.name} maxLength={120} onChange={e => edit({ ...draft, name: e.target.value })} /></label>
      <label>Поиск открытий<input type="search" aria-label="Поиск открытий мира" value={search} onChange={e => setSearch(e.target.value)} /></label>
      <details><summary>HUB / MAM / другие схемы</summary>
        <p className="hint">Отмечайте отдельные завершённые исследования. Весь уровень автоматически не открывается. Условия открытия содержат только известные связи из источника; полный граф исследований MAM не восстановлен. Ручные открытия доступны ниже.</p>
        {!catalog.unlocks?.length && <p>Сведения о схемах пока отсутствуют в каталоге. Укажите рецепты и здания вручную.</p>}
        {!!catalog.unlocks?.length && <details><summary>Подготовить прогресс HUB по уровню</summary>
          <p>Выберите верхний уровень, затем исключите незавершённые этапы. Это заготовка для ручного подтверждения, а не автоматическое прохождение уровня. MAM и альтернативы добавляются отдельно.</p>
          <label>Уровень HUB<select aria-label="Уровень HUB" value={tier} onChange={e => { setTier(Number(e.target.value)); setPresetIds(null); }}>{[...new Set(catalog.unlocks.filter(u => u.kind === 'hub' && u.tier !== undefined).map(u => u.tier!))].sort((a, b) => a - b).map(t => <option key={t} value={t}>{t}</option>)}</select></label>
          <button className="secondary-button" onClick={() => setPresetIds(catalog.unlocks!.filter(u => u.kind === 'hub' && u.tier !== undefined && u.tier <= tier).map(u => u.id))}>Подготовить список до уровня {tier}</button>
          {presetIds && <><p>Уточните отдельные этапы перед добавлением:</p>{catalog.unlocks.filter(u => u.kind === 'hub' && u.tier !== undefined && u.tier <= tier).map(u => <div key={u.id}><label><input type="checkbox" checked={presetIds.includes(u.id)} onChange={() => setPresetIds(toggle(presetIds, u.id))} />{u.name || u.id} · уровень {u.tier}</label></div>)}
            <button className="secondary-button" onClick={() => { try { edit(grantWorldUnlocks(catalog, draft, presetIds)); setPresetIds(null); } catch (e) { setError(e instanceof Error ? e.message : 'Ошибка открытия схем.'); } }}>Добавить выбранные этапы в черновик</button></>}
        </details>}
        {(['hub', 'mam', 'other'] as const).map(kind => <details key={kind}><summary>{kind === 'hub' ? 'HUB: отдельные этапы' : kind === 'mam' ? 'MAM: отдельные исследования' : 'Альтернативы и другие схемы'}</summary>{catalog.unlocks?.filter(u => u.kind === kind && matches(`${u.name} ${u.id}`)).map(u => <article key={u.id} className="saved-profile"><div><h3>{u.name || u.id}</h3><p>{u.kind === 'hub' ? 'HUB' : u.kind === 'mam' ? 'MAM' : 'Другая схема'}{u.tier !== undefined && u.kind === 'hub' ? ` · уровень ${u.tier}` : ''}</p>
          {(u.prerequisiteGroups?.length ?? 0) > 0 ? <p>Известные условия: {u.prerequisiteGroups!.map(group => `(${group.map(unlockName).join(' ИЛИ ')})`).join(' И ')}.</p> : u.prerequisiteIds.length > 0 && <p>Известные обязательные предпосылки: {u.prerequisiteIds.map(unlockName).join(' И ')}.</p>}
          {!!u.schematicIds?.length && <p>Вместе с прямыми открытиями применятся дочерние схемы: {u.schematicIds.map(unlockName).join(', ')}.</p>}</div>
          <button className="secondary-button" disabled={draft.unlockedMilestoneIds.includes(u.id)} onClick={() => grant(u)}>{draft.unlockedMilestoneIds.includes(u.id) ? 'Отмечено открытым' : 'Добавить открытия'}</button>
          {draft.unlockedMilestoneIds.includes(u.id) && <button className="text-button" onClick={() => edit({ ...draft, unlockedMilestoneIds: draft.unlockedMilestoneIds.filter(id => id !== u.id) })}>Убрать отметку; открытия сохранятся</button>}
        </article>)}</details>)}
      </details>
      <p className="hint">Итоговые открытия можно уточнить вручную. Удаление отметки исследования сохраняет доступность рецептов и зданий; закрывайте их явно ниже, чтобы не потерять ручные открытия.</p>
      <details><summary>Рецепты: открыто {draft.unlockedRecipeIds.length} из {catalog.recipes.length}</summary>
        {catalog.recipes.filter(r => matches(`${r.name} ${r.nameEn}`)).map(r => {
          const opened = draft.unlockedRecipeIds.includes(r.id);
          const prerequisites = catalog.unlocks?.filter(u => u.recipeIds.includes(r.id));
          return <div key={r.id}><label><input type="checkbox" checked={opened} onChange={() => edit({ ...draft, unlockedRecipeIds: toggle(draft.unlockedRecipeIds, r.id) })} />{r.name}{r.alternate ? ' · альтернативный' : ''}</label>
            {!opened && <p className="hint">Закрыт в мире. {prerequisites?.length ? `Открывающие схемы: ${prerequisites.map(u => u.name).join(', ')}. Можно отметить рецепт вручную.` : 'Источник открытия не сопоставлен; отметьте рецепт вручную после открытия в игре.'}</p>}</div>;
        })}
      </details>
      <details><summary>Здания и добытчики: открыто {draft.unlockedBuildingIds.length} из {catalog.buildings.length + catalog.miners.length}</summary>
        {catalog.buildings.filter(b => matches(`${b.name} ${b.nameEn}`)).map(b => <div key={b.id}><label><input type="checkbox" checked={draft.unlockedBuildingIds.includes(b.id)} onChange={() => edit({ ...draft, unlockedBuildingIds: toggle(draft.unlockedBuildingIds, b.id) })} />{b.name}</label><p className="hint">{catalog.unlocks?.filter(u => u.buildingIds.includes(b.id)).map(u => u.name).join(', ') || 'Источник открытия не сопоставлен. Укажите доступность вручную.'}</p></div>)}
        <h3>Добытчики</h3><p className="hint">Месторождение с закрытым добытчиком не даёт сырья в расчёте. Внешние потоки задаются отдельно.</p>
        {catalog.miners.filter(m => matches(m.name)).map(m => <div key={m.id}><label><input type="checkbox" checked={draft.unlockedBuildingIds.includes(m.id)} onChange={() => edit({ ...draft, unlockedBuildingIds: toggle(draft.unlockedBuildingIds, m.id) })} />{m.name}</label><p className="hint">{catalog.unlocks?.filter(u => u.minerIds?.includes(m.id)).map(u => u.name).join(', ') || 'Источник открытия не сопоставлен. Укажите доступность вручную.'}</p></div>)}
      </details>
      <label>Максимальная лента мира<select aria-label="Максимальная лента мира" value={draft.beltId} onChange={e => edit({ ...draft, beltId: e.target.value })}>{catalog.belts.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      <label>Максимальная труба мира<select aria-label="Максимальная труба мира" value={draft.pipeId} onChange={e => edit({ ...draft, pipeId: e.target.value })}>{catalog.pipes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      <label><input type="checkbox" checked={draft.overclockUnlocked} onChange={e => edit({ ...draft, overclockUnlocked: e.target.checked })} />Разгон открыт в мире</label>
      <div className="toolbar-actions" style={{ flexWrap: 'wrap' }}><button className="primary-button" disabled={!draft.name.trim()} onClick={() => { try { setPreview(previewWorldUpdate(workspace, draft)); setError(''); } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось подготовить просмотр изменений.'); } }}>Просмотреть изменения мира</button><button className="secondary-button" onClick={() => { setDraft(null); setPreview(null); }}>Отменить черновик мира</button></div>
    </fieldset>
    {preview && <section aria-label="Просмотр изменений мира"><h3>Изменения до применения</h3>
      <p>{preview.before.name} → {preview.after.name}. Ревизия {preview.before.revision} → {preview.after.revision}.</p>
      <p>Фабрики: {preview.factories.map(f => f.name).join(', ') || 'связанных фабрик нет'}.</p>
      <ul>{(['recipes', 'buildings', 'milestones'] as const).map(kind => {
        const label = kind === 'recipes' ? 'Рецепты' : kind === 'buildings' ? 'Здания' : 'Исследования';
        const nameOf = (id: string) => kind === 'recipes' ? catalog.recipes.find(r => r.id === id)?.name ?? id : kind === 'buildings' ? catalog.buildings.find(b => b.id === id)?.name ?? catalog.miners.find(m => m.id === id)?.name ?? id : unlockName(id);
        return <li key={kind}>{label}: добавить {preview[kind].added.map(nameOf).join(', ') || '—'}; убрать {preview[kind].removed.map(nameOf).join(', ') || '—'}.</li>;
      })}</ul>
      <p>Лента: {transportName('belts', preview.before.beltId)} → {transportName('belts', preview.after.beltId)}.<br />Труба: {transportName('pipes', preview.before.pipeId)} → {transportName('pipes', preview.after.pipeId)}.<br />Разгон: {preview.before.overclockUnlocked ? 'открыт' : 'закрыт'} → {preview.after.overclockUnlocked ? 'открыт' : 'закрыт'}.</p>
      <p className="hint">Заказы, источники и локальные исключения сохраняются. Новые открытия разрешают только то, что также выбрано в плане. Закрытые рецепты и здания исключаются из следующего расчёта; действующие результаты потребуют пересчёта.</p>
      {!preview.after.overclockUnlocked && <p>Разгон закрыт: фабрики с частотой выше 100% потребуют ручного изменения частоты перед расчётом.</p>}
      <button className="primary-button" disabled={locked} onClick={() => void run(async () => {
        const next = applyWorldUpdate(workspace, preview);
        await save(next, 'Прогресс применён ко всем связанным фабрикам. Пересчитайте результаты.');
        if (active?.worldId === preview.after.id || plan.world?.id === preview.after.id) setPlan(current => ({ ...current, world: snapshotWorld(preview.after) }));
        setDraft(null); setPreview(null);
      })}>Применить к миру и {preview.factories.length} фабрикам</button>
    </section>}
  </section>}</div>;
}
