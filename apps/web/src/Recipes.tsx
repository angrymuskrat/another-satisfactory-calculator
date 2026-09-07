import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { Catalog, Plan, Recipe } from '../../../packages/domain/types';
import type { PlanProps } from './Planner';
import { format, ItemIcon, NumberField } from './controls';
import { groupRecipes, matchesRecipe, recipeAvailability, recipeMetrics, type QuantityMode, type SearchScope } from './recipeCatalog';
import { AnalysisFeedback } from './AnalysisPanel';
import { useAnalysis } from './useAnalysis';

export function Recipes({ catalog, plan, setPlan }: PlanProps) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [filter, setFilter] = useState('all');
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
      && (filter !== 'alternate' || recipe.alternate) && (filter !== 'enabled' || a.enabled)
      && (filter !== 'opened' || a.opened) && (filter !== 'available' || a.usable);
  }), [catalog, plan, query, category, filter, scope]);
  const groups = groupRecipes(filtered);
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
    <div className="panel catalog-toolbar">
      <div className="search-field"><Search size={18} /><input aria-label="Поиск рецептов" placeholder="Название рецепта или предмета…" value={query} onChange={e => setQuery(e.target.value)} /></div>
      <select aria-label="Область поиска рецептов" value={scope} onChange={e => setScope(e.target.value as SearchScope)}><option value="all">Везде</option><option value="produces">Производит</option><option value="uses">Использует</option></select>
      <select aria-label="Категория рецептов" value={category} onChange={e => setCategory(e.target.value)}><option value="">Все категории</option>{catalog.categories.map(c => <option key={c}>{c}</option>)}</select>
      <select aria-label="Фильтр рецептов" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">Все рецепты</option><option value="alternate">Альтернативные</option><option value="enabled">Разрешены в плане</option><option value="opened">Открыты в мире</option><option value="available">Доступны для расчёта</option></select>
    </div>
    <div className="panel">
      <p>{catalog.categorySource === 'game-assets' ? 'Названия и состав категорий взяты из игровых файлов и русской локализации. Где приоритет категории не задан, применяется русский алфавит; полное совпадение порядка меню не подтверждено.' : 'Категории составлены вручную; точное соответствие меню игры не подтверждено.'} Альтернативы показаны рядом с основным продуктом.</p>
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
      const all = catalog.recipes.filter(r => r.category === group.category);
      return <details className="panel" key={group.category} open><summary>{group.category} · открыто {all.filter(r => recipeAvailability(catalog, plan, r).opened).length} · разрешено {all.filter(r => plan.settings.enabledRecipeIds.includes(r.id)).length} из {all.length}</summary>
        {group.products.map(product => <section key={product.itemId} aria-label={catalog.items.find(i => i.id === product.itemId)?.name ?? product.itemId}>
          <h2>{catalog.items.find(i => i.id === product.itemId)?.name ?? product.itemId}</h2>
          <div className="recipe-grid">{product.recipes.map(recipe => <RecipeCard key={recipe.id} catalog={catalog} plan={plan} recipe={recipe} mode={mode} clock={clock}
            toggle={on => toggle([recipe.id], on)} compare={() => analysis.calculate({ kind: 'recipes', recipeIds: [recipe.id] })} running={analysis.running}
            selected={comparisonIds.includes(recipe.id)} selectionFull={comparisonIds.length >= 12}
            select={on => setComparisonIds(on ? [...comparisonIds, recipe.id] : comparisonIds.filter(id => id !== recipe.id))} />)}</div>
        </section>)}
      </details>;
    })}
    {!filtered.length && <div className="panel empty-panel"><Search size={32} /><h3>Ничего не найдено</h3><p>Попробуйте другое название, область поиска или снимите фильтры.</p></div>}
  </div>;
}
function RecipeCard({ catalog, plan, recipe, mode, clock, toggle, compare, running, selected, selectionFull, select }: {
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
