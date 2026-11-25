import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BookOpen, ChevronRight, Download, Factory, FolderHeart, HardHat, Info, LayoutDashboard, Play, RotateCcw, Square, Upload, X } from 'lucide-react';
import type { Catalog, Plan } from '../../../packages/domain/types';
import { createDefaultPlan } from '../../../packages/domain/defaults';
import { parseCatalogPlan } from './planStorage';
import { legacyCleanupMessage, legacyPlanMessage } from '../../../packages/domain/plannerCompatibility';
import catalogJson from '../../../packages/game-data/catalog.json';
import { Planner } from './Planner';
import { SupplyGaps } from './SupplyGaps';
import { ResidueHelp } from './ResidueHelp';
import { Recipes } from './Recipes';
import { Technologies } from './Technologies';
import { Profiles } from './Profiles';
import { ProductionVariants } from './ProductionVariants';
import { useSolver } from './useSolver';
import { Worlds } from './Worlds';
import { useWorldWorkspace } from './useWorldWorkspace';
import { ConstraintSummary } from './ConstraintSummary';
import { SplitterSchemes } from './SplitterSchemes';
import { QuickOrder } from './QuickOrder';
import { SharedOrderPreview } from './SharedOrderPreview';
import { ShareOrder } from './ShareOrder';

const catalog = catalogJson as Catalog;
const DRAFT_KEY = 'ficsit-plan-v1';
const nav = [{ id: 'planner', name: 'Цели и ограничения', short: 'Цели', icon: LayoutDashboard }, { id: 'results', name: 'Результаты', short: 'Результаты', icon: HardHat }, { id: 'recipes', name: 'Рецепты', short: 'Рецепты', icon: BookOpen }, { id: 'splitters', name: 'Схемы разделителей', short: 'Разделители', icon: BookOpen }, { id: 'technologies', name: 'Технологии', short: 'Технологии', icon: Factory }, { id: 'worlds', name: 'Миры и фабрики', short: 'Миры', icon: FolderHeart }, { id: 'profiles', name: 'Профили', short: 'Профили', icon: FolderHeart }] as const;
type Tab = typeof nav[number]['id'];
function loadPersonalDraft(fallback?: Plan) {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) return parseCatalogPlan(JSON.parse(raw), catalog);
  } catch { /* Проверка черновика ниже объяснит ошибку и сохранит исходные данные. */ }
  return fallback ?? createDefaultPlan(catalog);
}

export function App() {
  const [activeFactoryId, setActiveFactoryId] = useState<string | null>(null);
  const [orderHash, setOrderHash] = useState(() => location.hash.startsWith('#order=') ? location.hash : '');
  const [personalSession, setPersonalSession] = useState<{ plan: Plan; tab: Tab; factoryId: string | null; hash: string; scope: string } | null>(null);
  const preview = !!orderHash && personalSession?.hash !== orderHash;
  const isolated = !!personalSession || preview;
  const worldStore = useWorldWorkspace(catalog, !isolated);
  const [draftIssue, setDraftIssue] = useState('');
  const enteredViaLink = useRef(!!orderHash);
  const [plan, setPlan] = useState<Plan>(() => orderHash ? createDefaultPlan(catalog) : loadPersonalDraft());
  const [tab, setTab] = useState<Tab>('planner');
  const [quickOpen, setQuickOpen] = useState(false);
  const quickOnly = quickOpen && tab === 'planner' && !isolated;
  function openOrder(next: Plan) {
    setPersonalSession(previous => ({
      plan: previous?.plan ?? plan, tab: previous?.tab ?? tab,
      factoryId: previous ? previous.factoryId : activeFactoryId, hash: orderHash, scope: crypto.randomUUID(),
    }));
    setActiveFactoryId(null);
    setPlan(next);
    setTab('planner');
    window.scrollTo({ top: 0 });
  }
  function restoreSession() {
    if (enteredViaLink.current) {
      enteredViaLink.current = false;
      setPlan(loadPersonalDraft());
      setActiveFactoryId(null);
      setTab('planner');
    } else if (personalSession) {
      setActiveFactoryId(personalSession.factoryId);
      setPlan(personalSession.factoryId ? personalSession.plan : loadPersonalDraft(personalSession.plan));
      setTab(personalSession.tab);
    }
    setPersonalSession(null);
    setOrderHash('');
  }
  function closeOrder() {
    if (location.hash.startsWith('#order=')) history.replaceState(history.state, '', location.pathname + location.search);
    restoreSession();
  }
  useEffect(() => {
    const navigate = () => {
      if (location.hash.startsWith('#order=')) setOrderHash(location.hash);
      else if (orderHash && (!personalSession || !location.hash)) restoreSession();
      else if (orderHash) history.replaceState(history.state, '', location.pathname + location.search + orderHash);
    };
    window.addEventListener('hashchange', navigate);
    return () => window.removeEventListener('hashchange', navigate);
  }, [orderHash, personalSession]);
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }); }, [tab]);
  const [toast, setToast] = useState('');
  const [draftReady, setDraftReady] = useState(false);
  const [resetPending, setResetPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const resetTrigger = useRef<HTMLButtonElement>(null);
  const wasResetOpen = useRef(false);
  useEffect(() => { if (!resetPending && wasResetOpen.current) resetTrigger.current?.focus(); wasResetOpen.current = resetPending; }, [resetPending]);
  const solver = useSolver(catalog, plan);
  const constructionScope = personalSession ? JSON.stringify(['order', personalSession.scope]) : JSON.stringify([worldStore.ownerId ?? 'guest', activeFactoryId]);
  const report = solver.stale ? null : solver.report;
  const workingResult = report?.variants.find(v => v.result.products.some(p => p.rate > 0))?.result ?? report?.workingPlans?.[0]?.result;
  const zeroOutput = report?.variants.find(v => v.result.status === 'optimal' || v.result.status === 'approximate')?.result;
  const residueResult = solver.stale || report?.supplyGaps?.length ? null : solver.selected?.result ?? workingResult ?? solver.result ?? zeroOutput ?? (!solver.running ? report?.pareto?.failures[0] : null) ?? null;
  const sidebarRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const sidebar = sidebarRef.current;
    if (!sidebar) return;
    const update = () => document.documentElement.style.setProperty('--sticky-top', getComputedStyle(sidebar).position === 'sticky' ? sidebar.offsetHeight + 'px' : '0px');
    update();
    const observer = new ResizeObserver(update);
    observer.observe(sidebar);
    window.addEventListener('resize', update);
    return () => { observer.disconnect(); window.removeEventListener('resize', update); };
  }, [preview]);
  const planTabs = tab === 'planner' || tab === 'results';
  // Мобильные вкладки прокручиваются вбок: активная видна, у скрытого края — затухание.
  const navRef = useRef<HTMLElement>(null);
  const updateNavEdges = () => {
    const element = navRef.current;
    if (!element) return;
    element.dataset.overflowStart = String(element.scrollLeft > 2);
    element.dataset.overflowEnd = String(element.scrollLeft + element.clientWidth < element.scrollWidth - 2);
  };
  useEffect(() => {
    const element = navRef.current;
    if (!element) return;
    const observer = new ResizeObserver(updateNavEdges);
    observer.observe(element);
    return () => observer.disconnect();
  }, [preview]);
  useEffect(() => {
    const element = navRef.current, active = element?.querySelector<HTMLElement>('[aria-current="page"]');
    if (element && active && element.scrollWidth > element.clientWidth) element.scrollTo({ left: active.offsetLeft - (element.clientWidth - active.offsetWidth) / 2, behavior: 'instant' });
    updateNavEdges();
  }, [tab, preview]);
  useEffect(() => { if (isolated) return; try { const raw = localStorage.getItem(DRAFT_KEY); if (raw) { const saved = parseCatalogPlan(JSON.parse(raw), catalog); if (saved.catalogVersion !== catalog.version) { setDraftIssue('Сохранённый черновик относится к другой версии каталога. Он сохранён в браузере; экспортируйте его перед сбросом.'); return; } } setDraftReady(true); } catch (error) { if (error instanceof Error && error.message === legacyPlanMessage) { try { localStorage.removeItem(DRAFT_KEY); setDraftIssue(legacyCleanupMessage); setDraftReady(true); } catch { setDraftIssue('Браузер не разрешил удалить старый черновик. Сбросьте план или очистите его вручную.'); } } else setDraftIssue('Черновик не удалось загрузить. Исходные данные сохранены в браузере; экспортируйте их перед сбросом.'); } }, [isolated]);
  useEffect(() => { if (isolated || !draftReady || activeFactoryId) return; try { localStorage.setItem(DRAFT_KEY, JSON.stringify(plan)); } catch { setDraftIssue('Браузер не разрешил сохранить черновик. Экспортируйте план в JSON.'); } }, [plan, draftReady, activeFactoryId, isolated]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 5000); return () => clearTimeout(timer); }, [toast]);
  const sessionChanged = () => { setActiveFactoryId(null); try { const raw = localStorage.getItem(DRAFT_KEY); setPlan(raw ? parseCatalogPlan(JSON.parse(raw), catalog) : createDefaultPlan(catalog)); } catch { setPlan(createDefaultPlan(catalog)); } void worldStore.load(); };
  const openLegacyPlan = (next: Plan) => { setActiveFactoryId(null); setPlan(next); };
  const exportPlan = () => { const preserved = !isolated && draftIssue && !draftReady ? localStorage.getItem(DRAFT_KEY) : null; const blob = new Blob([preserved ?? JSON.stringify(plan, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${plan.name.replace(/[^\p{L}\p{N}_-]/gu, '-').slice(0, 70) || 'factory'}.json`; a.click(); URL.revokeObjectURL(url); };
  const importPlan = async (file?: File) => { if (!file) return; try { if (file.size > 2_000_000) throw new Error('Файл слишком большой. Максимум 2 МБ.'); const imported = parseCatalogPlan(JSON.parse(await file.text()), catalog); if (imported.catalogVersion !== catalog.version) throw new Error('Версия каталога в файле отличается. Требуется миграция профиля.'); const itemIds = new Set(catalog.items.map(i => i.id)); const recipes = new Set(catalog.recipes.map(r => r.id)); const buildings = new Set(catalog.buildings.map(b => b.id)); if (imported.targets.some(t => !itemIds.has(t.itemId)) || imported.sources.some(s => !itemIds.has(s.itemId)) || imported.settings.enabledRecipeIds.some(id => !recipes.has(id)) || imported.settings.enabledBuildingIds.some(id => !buildings.has(id))) throw new Error('В плане есть неизвестные предметы, рецепты или здания.'); openLegacyPlan(imported); if (!isolated) { setDraftReady(true); setDraftIssue(''); } setToast('План импортирован'); } catch (e) { setToast(e instanceof Error ? e.message : 'Не удалось импортировать план.'); } if (inputRef.current) inputRef.current.value = ''; };
  if (preview) return <SharedOrderPreview key={orderHash} hash={orderHash} catalog={catalog} onAdvanced={openOrder} onClose={closeOrder} />;
  const visibleNav = isolated ? nav.filter(link => link.id !== 'worlds' && link.id !== 'profiles') : nav;
  return <div className="app-shell"><a className="skip-link" href="#main-content" inert={resetPending}>Перейти к содержимому</a><aside className="sidebar" ref={sidebarRef} inert={resetPending}><a className="brand" href="#" onClick={e => { e.preventDefault(); setTab('planner'); }} aria-label="FICSIT — планировщик"><span className="brand-mark"><Factory size={24} /></span><span>FICSIT<span className="brand-dot">.</span><small>FACTORY PLANNER</small></span></a><div className="workspace-label">РАБОЧЕЕ ПРОСТРАНСТВО</div><nav aria-label="Основная навигация" ref={navRef} onScroll={updateNavEdges}>{visibleNav.map(link => <button key={link.id} className={tab === link.id ? 'nav-item active' : 'nav-item'} aria-label={link.name} aria-current={tab === link.id ? 'page' : undefined} onClick={() => setTab(link.id)}><link.icon size={18} /><span className="nav-label">{link.name}</span><span className="nav-label-short" aria-hidden="true">{link.short}</span>{tab === link.id && <ChevronRight size={14} />}</button>)}</nav></aside><div className="main-shell" inert={resetPending}><header className="topbar"><div className="breadcrumbs">Рабочее пространство<ChevronRight size={13} /><strong>{nav.find(n => n.id === tab)?.name}</strong></div>{activeFactoryId && <div className="local-status"><span />Черновик фабрики — сохраните в разделе миров</div>}</header><main id="main-content" tabIndex={-1} className={tab === 'results' ? 'results-page' : undefined}><div className="page-heading"><h1 aria-live="polite">{nav.find(n => n.id === tab)?.name}</h1></div>{!isolated && <div hidden={tab !== 'planner'} inert={tab !== 'planner'}><QuickOrder catalog={catalog} open={quickOpen} onToggle={setQuickOpen} onAdvanced={openOrder} /></div>}{personalSession && <aside className="order-session"><span>Вы редактируете отдельный заказ. Изменения можно сохранить ссылкой или в JSON.</span><button type="button" className="secondary-button" onClick={closeOrder}>Вернуться к своей фабрике</button></aside>}
    <div className="plan-toolbar" hidden={quickOnly} inert={quickOnly}><label className="plan-name"><Factory size={17} /><input aria-label="Название плана" value={plan.name} maxLength={100} onBlur={() => { if (!plan.name.trim()) setPlan({ ...plan, name: 'Моя фабрика' }); }} onChange={e => setPlan({ ...plan, name: e.target.value })} /></label><div className="toolbar-actions">{planTabs && <ShareOrder plan={plan} />}<button className="icon-button" aria-label="Импортировать JSON" title="Импортировать JSON" onClick={() => inputRef.current?.click()}><Upload size={17} /></button><button className="icon-button" aria-label="Экспортировать JSON" title="Экспортировать JSON" onClick={exportPlan}><Download size={17} /></button><button className="icon-button" ref={resetTrigger} aria-label="Сбросить план" title="Сбросить план" onClick={() => setResetPending(true)}><RotateCcw size={16} /></button>{tab !== 'worlds' && tab !== 'profiles' && <><span className="toolbar-divider" />{solver.running ? <button className="primary-button" onClick={solver.cancel}><Square size={15} />Отменить расчёт</button> : <button className="primary-button" onClick={() => { setTab('results'); solver.calculate(); }}><Play size={15} fill="currentColor" />Рассчитать</button>}</>}</div><input hidden ref={inputRef} type="file" accept=".json,application/json" aria-label="Файл плана JSON" onChange={e => void importPlan(e.target.files?.[0])} /></div>{planTabs && !quickOnly && <ConstraintSummary catalog={catalog} plan={plan} />}{!isolated && draftIssue && <div role="alert" className="alert warning">{draftIssue}</div>}{!isolated && worldStore.notice && worldStore.notice !== draftIssue && <div role="alert" className="alert warning">{worldStore.notice}</div>}<div className="planner-settings" hidden={tab !== 'planner' || quickOnly} inert={tab !== 'planner' || quickOnly}><Planner catalog={catalog} plan={plan} setPlan={setPlan} /></div><div hidden={tab !== 'results'} inert={tab !== 'results'}>{!!report?.supplyGaps?.length && <SupplyGaps key={JSON.stringify([constructionScope, plan, report.supplyGaps])} catalog={catalog} plan={plan} gaps={report.supplyGaps} setPlan={setPlan} />}
    <ProductionVariants catalog={catalog} plan={plan} setPlan={setPlan} solver={solver} constructionScope={constructionScope} />
    <ResidueHelp catalog={catalog} plan={plan} result={residueResult} setPlan={setPlan} /></div>{tab === 'splitters' ? <SplitterSchemes /> : tab === 'recipes' ? <Recipes catalog={catalog} plan={plan} setPlan={setPlan} store={worldStore} activeFactoryId={activeFactoryId} /> : tab === 'technologies' ? <Technologies catalog={catalog} plan={plan} setPlan={setPlan} /> : tab === 'profiles' ? <Profiles catalog={catalog} plan={plan} setPlan={openLegacyPlan} onSessionChange={sessionChanged} /> : null}{!isolated && <div hidden={tab !== 'worlds'}><Worlds key={worldStore.ownerId ?? 'guest'} catalog={catalog} plan={plan} setPlan={setPlan} store={worldStore} activeFactoryId={activeFactoryId} setActiveFactoryId={setActiveFactoryId} /></div>}<footer className="page-footer"><span>FICSIT PLANNER <b>·</b> {catalog.version} <b>·</b> неофициальный инструмент сообщества</span><details><summary><Info size={14} aria-hidden="true" />О данных</summary><p>Статус каталога: {catalog.provenance.verified ? 'проверен' : 'требуется полная сверка'}<br />Источник: {catalog.provenance.source}<br />Версия: {catalog.provenance.commit}<br />Импорт: {catalog.provenance.importedAt}</p>{catalog.provenance.notes.map(note => <p key={note}>{note}</p>)}</details></footer></main></div>{toast && <div className="toast" role="status">{toast}<button aria-label="Закрыть уведомление" onClick={() => setToast('')}><X size={16} /></button></div>}{resetPending && <div className="modal-backdrop" onKeyDown={e => { if (e.key === 'Escape') setResetPending(false); if (e.key === 'Tab') { const buttons = e.currentTarget.querySelectorAll<HTMLButtonElement>('button'); const first = buttons[0]; const last = buttons[buttons.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); } } }}><section role="dialog" aria-modal="true" aria-labelledby="reset-title" aria-describedby="reset-description" className="panel modal"><h2 id="reset-title">Начать с исходного плана?</h2><p id="reset-description">{isolated ? 'В этом заказе будут восстановлены исходные настройки.' : 'Текущий локальный черновик будет заменён. Сохранённые в аккаунте профили останутся.'}</p><div><button autoFocus className="secondary-button" onClick={() => setResetPending(false)}>Отмена</button><button className="primary-button" onClick={() => { openLegacyPlan(createDefaultPlan(catalog)); if (!isolated) { setDraftReady(true); setDraftIssue(''); } setResetPending(false); }}>Сбросить</button></div></section></div>}</div>;
}
