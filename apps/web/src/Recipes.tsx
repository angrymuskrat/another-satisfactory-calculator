import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { Catalog, Plan, Recipe } from '../../../packages/domain/types';
import { RecipeSetup, type RecipeSetupProps } from './RecipeSetup';
import { buildRecipeProgress, compareRecipeProgress, type RecipeProgress } from '../../../packages/domain/recipeProgress';
import { format, ItemIcon, NumberField } from './controls';
import { groupRecipes, matchesRecipe, recipeAvailability, recipeMetrics, type QuantityMode, type SearchScope } from './recipeCatalog';
import { AnalysisFeedback } from './AnalysisPanel';
import { useAnalysis } from './useAnalysis';

export function Recipes({ catalog, plan, setPlan, store, activeFactoryId }: RecipeSetupProps) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [filter, setFilter] = useState('all');
  const [source, setSource] = useState('all');
  const [tree, setTree] = useState('');
  const [sort, setSort] = useState('progress');
  const [hideClosed, setHideClosed] = useState(false);
  const progress = useMemo(() => buildRecipeProgress(catalog), [catalog]);
  const [scope, setScope] = useState<SearchScope>('all');
  const [mode, setMode] = useState<QuantityMode>('cycle');
  const [clock, setClock] = useState(plan.settings.clock);
  const [comparisonIds, setComparisonIds] = useState<string[]>([]);
  const analysis = useAnalysis(catalog, plan);
  useEffect(() => setClock(plan.settings.clock), [plan.settings.clock]);
  useEffect(() => setComparisonIds([]), [catalog, JSON.stringify(plan.world), JSON.stringify(plan.settings.enabledRecipeIds), JSON.stringify(plan.settings.enabledBuildingIds)]);
  const filtered = useMemo(() => catalog.recipes.filter(recipe => {
    const a = recipeAvailability(catalog, plan, recipe);
    return matchesRecipe(catalog, recipe, query, scope) && (!category || category === recipe.category)
      && (source === 'all' || progress.get(recipe.id)!.sources.some(s => s === source))
      && (!tree || progress.get(recipe.id)!.treeIds.includes(tree)) && (!hideClosed || a.opened)
      && (filter !== 'alternate' || recipe.alternate) && (filter !== 'enabled' || a.enabled)
      && (filter !== 'disabled' || !a.enabled) && (filter !== 'closed' || !a.opened)
      && (filter !== 'opened' || a.opened) && (filter !== 'available' || a.usable);
  }), [catalog, plan, query, category, filter, scope, source, tree, hideClosed, progress]);
  const groups = useMemo(() => {
    if (sort === 'category') return groupRecipes(filtered);
    const sorted = [...filtered].sort((a, b) => (sort === 'progress' ? compareRecipeProgress(progress.get(a.id)!, progress.get(b.id)!) : 0) || a.name.localeCompare(b.name, 'ru') || a.id.localeCompare(b.id));
    const sections = new Map<string, { category: string; products: { itemId: string; recipes: Recipe[] }[] }>();
    for (const recipe of sorted) {
      const p = progress.get(recipe.id)!;
      const key = sort === 'name' ? 'name' : p.groupKey;
      let group = sections.get(key);
      if (!group) { group = { category: sort === 'name' ? 'Рецепты по названию' : `${p.section} · ${p.step}`, products: [{ itemId: key, recipes: [] }] }; sections.set(key, group); }
      group.products[0].recipes.push(recipe);
    }
    return [...sections.values()];
  }, [filtered, sort, progress]);
  const openedCount = catalog.recipes.filter(r => recipeAvailability(catalog, plan, r).opened).length;
  const enabledCount = catalog.recipes.filter(r => plan.settings.enabledRecipeIds.includes(r.id)).length;
  const toggle = (ids: string[], on: boolean) => {
    const enabled = new Set(plan.settings.enabledRecipeIds);
    for (const id of ids) {
      if (!on) enabled.delete(id);
      else if (!plan.world || plan.world.unlockedRecipeIds.includes(id)) enabled.add(id);
    }
    setPlan({ ...plan, settings: { ...plan.settings, enabledRecipeIds: [...enabled] } });
  };
  return <div className="catalog-view">
    <RecipeSetup catalog={catalog} plan={plan} setPlan={setPlan} store={store} activeFactoryId={activeFactoryId} />
    <div className="panel catalog-toolbar">
      <div className="search-field"><Search size={18} /><input aria-label="Поиск рецептов" placeholder="Название рецепта или предмета…" value={query} onChange={e => setQuery(e.target.value)} /></div>
      <select aria-label="Область поиска рецептов" value={scope} onChange={e => setScope(e.target.value as SearchScope)}><option value="all">Везде</option><option value="produces">Производит</option><option value="uses">Использует</option></select>
      <select aria-label="Категория рецептов" value={category} onChange={e => setCategory(e.target.value)}><option value="">Все категории</option>{catalog.categories.map(c => <option key={c}>{c}</option>)}</select>
      <select aria-label="Источник открытия рецептов" value={source} onChange={e => { setSource(e.target.value); if (e.target.value !== 'mam') setTree(''); }}><option value="all">Все источники открытия</option><option value="hub">HUB</option><option value="hard-drive">Из жёстких дисков</option><option value="mam">MAM: все исследования</option><option value="other">Другие открытия</option></select>
      {source === 'mam' && <select aria-label="Направление MAM" value={tree} onChange={e => setTree(e.target.value)}><option value="">Все направления MAM</option>{catalog.researchTrees?.filter(t => !t.seasonal).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select>}
      <select aria-label="Фильтр рецептов" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">Все состояния</option><option value="alternate">Все альтернативные</option><option value="enabled">Разрешены в плане</option><option value="disabled">Выключены в плане</option><option value="opened">Открыты в мире</option><option value="closed">Закрыты в мире</option><option value="available">Доступны для расчёта</option></select>
      <select aria-label="Сортировка рецептов" value={sort} onChange={e => setSort(e.target.value)}><option value="progress">По прогрессу: ранние сначала</option><option value="name">По названию</option><option value="category">По категориям</option></select>
      <label className="setup-check"><input type="checkbox" checked={hideClosed} onChange={e => setHideClosed(e.target.checked)} />Скрыть закрытые</label>
    </div>
    <div className="panel">
      <p>{sort === 'progress' ? 'Сначала ранние уровни и этапы HUB. MAM сгруппирован независимо по веткам; диски упорядочены по известным требованиям. Равнозначные открытия — по русскому названию. Неизвестное место в прогрессе показано отдельно.' : sort === 'category' ? 'Названия и состав категорий взяты из игровых файлов. При равном или неизвестном приоритете используется русский алфавит. Альтернативы показаны рядом с основным продуктом.' : 'Рецепты упорядочены по русскому названию.'}</p>
      <label>Количество <select aria-label="Единицы карточек рецептов" value={mode} onChange={e => setMode(e.target.value as QuantityMode)}><option value="cycle">За цикл</option><option value="minute">В минуту</option><option value="unit">На единицу выхода</option></select></label>{' '}
      <NumberField label="Частота предпросмотра рецептов" value={clock} onChange={setClock} min={1} max={250} suffix="%" />
      <p className="muted">Частота предпросмотра не меняет план. Показатели относятся к одной непрерывно работающей машине. Ограничения транспорта учитываются при сравнении всей фабрики.</p>
      {plan.world && !plan.world.overclockUnlocked && clock > 100 && <p>Разгон не открыт в мире; это только справочный предпросмотр.</p>}
    </div>
    <div className="catalog-summary"><span role="status">Найдено {filtered.length} · открыто {openedCount} · разрешено в плане {enabledCount} из {catalog.recipes.length}</span><div>
      <button className="text-button" onClick={() => toggle(filtered.map(r => r.id), true)}>Включить найденные открытые</button>
      <button className="text-button muted" onClick={() => toggle(filtered.map(r => r.id), false)}>Выключить найденные</button>
    </div></div>
    <div className="panel analysis-panel"><button className="primary-button" disabled={!comparisonIds.length || analysis.running} onClick={() => analysis.calculate({ kind: 'recipes', recipeIds: comparisonIds })}>Сравнить выбранные рецепты ({comparisonIds.length})</button>
      <p>До 12 рецептов: отдельное изменение каждого и совместный вариант. Разрешённый рецепт выключается в копии, выключенный — разрешается. Весь производственный план пересчитывается.</p>
      <p>Сравнение использует частоту производства из плана: {format(plan.settings.clock)}%.</p>
      <AnalysisFeedback analysis={analysis} catalog={catalog} />
    </div>
    {groups.map(group => {
      const all = group.products.flatMap(p => p.recipes);
      return <details className="panel recipe-group" key={sort + group.products[0].itemId + group.category} open><summary>{group.category} · открыто {all.filter(r => recipeAvailability(catalog, plan, r).opened).length} · разрешено {all.filter(r => plan.settings.enabledRecipeIds.includes(r.id)).length} из {all.length}</summary>
        {group.products.map(product => <section key={product.itemId}>
          {sort === 'category' && <h2>{catalog.items.find(i => i.id === product.itemId)?.name ?? product.itemId}</h2>}
          <div className="recipe-grid">{product.recipes.map(recipe => <RecipeCard key={recipe.id} catalog={catalog} plan={plan} recipe={recipe} mode={mode} clock={clock}
            progress={progress.get(recipe.id)!}
            toggle={on => toggle([recipe.id], on)} compare={() => analysis.calculate({ kind: 'recipes', recipeIds: [recipe.id] })} running={analysis.running}
            selected={comparisonIds.includes(recipe.id)} selectionFull={comparisonIds.length >= 12}
            select={on => setComparisonIds(on ? [...comparisonIds, recipe.id] : comparisonIds.filter(id => id !== recipe.id))} />)}</div>
        </section>)}
      </details>;
    })}
    {!filtered.length && <div className="panel empty-panel"><Search size={32} /><h3>Ничего не найдено</h3><p>Попробуйте другое название, область поиска или снимите фильтры.</p></div>}
  </div>;
}
function RecipeCard({ catalog, plan, recipe, mode, clock, toggle, compare, running, selected, selectionFull, select, progress }: {
  progress: RecipeProgress;
  catalog: Catalog; plan: Plan; recipe: Recipe; mode: QuantityMode; clock: number;
  toggle: (on: boolean) => void; compare: () => void; running: boolean; selected: boolean; selectionFull: boolean; select: (on: boolean) => void;
}) {
  const [outputId, setOutputId] = useState(recipe.outputs[0].itemId);
  const a = recipeAvailability(catalog, plan, recipe);
  const metrics = recipeMetrics(catalog, recipe, clock, mode, outputId);
  const item = (id: string) => catalog.items.find(i => i.id === id);
  const quantityUnit = (id: string) => (item(id)?.fluid ? 'м³' : 'шт') + (mode === 'minute' ? '/мин' : '');
  const suffix = mode === 'cycle' ? 'ЗА ЦИКЛ' : mode === 'minute' ? 'В МИНУТУ' : 'НА ЕДИНИЦУ ВЫХОДА';
  const comparable = a.opened && a.buildingOpened && a.buildingEnabled;
  return <article className={'panel recipe-card ' + (a.enabled ? 'enabled' : '')}>
    <div className="recipe-title"><ItemIcon item={item(recipe.outputs[0].itemId)} size={42} /><div><h3>{recipe.name}</h3><small>{catalog.buildings.find(b => b.id === recipe.buildingId)?.name} · {format(recipe.seconds * 100 / clock)} с при {format(clock)}%</small></div>
      <label className="switch"><input type="checkbox" aria-label={'Включить рецепт ' + recipe.name} checked={a.enabled} disabled={!a.opened && !a.enabled} onChange={e => toggle(e.target.checked)} /><span /></label>
    </div>
    <div className="recipe-tags"><span>{recipe.category}</span>{recipe.alternate && <span className="alt">Альтернативный</span>}<span>{a.opened ? plan.world ? 'Открыт в мире' : 'Без ограничений мира' : 'Закрыт в мире'}</span><span>{a.enabled ? 'Разрешён в плане' : 'Выключен в плане'}</span></div>
    <p className="hint">{progress.section} · {progress.step}</p>
    {progress.unlockIds.length > 1 && <details><summary>Все пути открытия</summary><ul>{progress.unlockIds.map(id => <li key={id}>{catalog.unlocks?.find(u => u.id === id)?.name ?? id}</li>)}</ul></details>}
    {a.reasons.length > 0 && <ul className="muted">{a.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}
    {recipe.outputs.length > 1 && <label>Нормировать по выходу <select aria-label={'Выход для нормирования: ' + recipe.name} value={outputId} onChange={e => setOutputId(e.target.value)}>{recipe.outputs.map(o => <option key={o.itemId} value={o.itemId}>{item(o.itemId)?.name ?? o.itemId}</option>)}</select></label>}
    {mode === 'unit' && <p>На 1 {item(outputId)?.fluid ? 'м³' : 'шт'}: {item(outputId)?.name}. Остальные выходы сохраняются.</p>}
    <div className="recipe-equation"><div><small>ВХОД {suffix}</small>{metrics.inputs.map(i => <span key={i.itemId}><ItemIcon item={item(i.itemId)} size={22} />{format(i.amount, 3)} {quantityUnit(i.itemId)} {item(i.itemId)?.name}</span>)}</div><div><small>ВЫХОД {suffix}</small>{metrics.outputs.map(i => <span key={i.itemId}><ItemIcon item={item(i.itemId)} size={22} />{format(i.amount, 3)} {quantityUnit(i.itemId)} {item(i.itemId)?.name}</span>)}</div></div>
    <p>{format(metrics.power, 3)} МВт · {format(metrics.energyPerUnit, 4)} МВт·мин/{item(outputId)?.fluid ? 'м³' : 'шт'} {item(outputId)?.name}{metrics.estimated ? ' (оценочная мощность)' : ''}</p>
    <small>Энергия этой машины; на выбранный выход отнесена целиком, без вычета побочных продуктов. Полная цепочка — в сравнении.</small>
    <button className="secondary-button" disabled={running || !comparable} onClick={compare} aria-label={'Сравнить для моей фабрики: ' + recipe.name}>{a.enabled ? 'Сравнить без рецепта' : 'Сравнить для моей фабрики'}</button>
    <label><input type="checkbox" aria-label={'Выбрать для совместного сравнения: ' + recipe.name} checked={selected} disabled={running || !comparable || (!selected && selectionFull)} onChange={e => select(e.target.checked)} /> Для совместного сравнения</label>
  </article>;
}
