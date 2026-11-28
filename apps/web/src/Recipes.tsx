import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { Catalog, Plan, Recipe } from '../../../packages/domain/types';
import { RecipeSetup, type RecipeSetupProps } from './RecipeSetup';
import { buildRecipeProgress, compareRecipeProgress, type RecipeProgress } from '../../../packages/domain/recipeProgress';
import { format, ItemIcon } from './controls';
import { groupRecipes, matchesRecipe, recipeAvailability, recipeMetrics, type QuantityMode, type SearchScope } from './recipeCatalog';
import { AnalysisFeedback } from './AnalysisPanel';
import { useAnalysis } from './useAnalysis';
import { useT } from './i18n';
import { gameName, nameCollator } from './i18n/gameNames';

export function Recipes({ catalog, plan, setPlan, store, activeFactoryId }: RecipeSetupProps) {
  const t = useT();
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
  const clock = plan.settings.clock;
  const [comparisonIds, setComparisonIds] = useState<string[]>([]);
  const analysis = useAnalysis(catalog, plan);
  useEffect(() => setComparisonIds([]), [catalog, JSON.stringify(plan.world), JSON.stringify(plan.settings.enabledRecipeIds), JSON.stringify(plan.settings.enabledBuildingIds)]);
  const filtered = useMemo(() => catalog.recipes.filter(recipe => {
    const a = recipeAvailability(catalog, plan, recipe, t);
    return matchesRecipe(catalog, recipe, query, scope) && (!category || category === recipe.category)
      && (source === 'all' || progress.get(recipe.id)!.sources.some(s => s === source))
      && (!tree || progress.get(recipe.id)!.treeIds.includes(tree)) && (!hideClosed || a.opened)
      && (filter !== 'alternate' || recipe.alternate) && (filter !== 'enabled' || a.enabled)
      && (filter !== 'disabled' || !a.enabled) && (filter !== 'closed' || !a.opened)
      && (filter !== 'opened' || a.opened) && (filter !== 'available' || a.usable);
  }), [catalog, plan, query, category, filter, scope, source, tree, hideClosed, progress, t]);
  const groups = useMemo(() => {
    if (sort === 'category') return groupRecipes(filtered);
    const collator = nameCollator();
    const sorted = [...filtered].sort((a, b) => (sort === 'progress' ? compareRecipeProgress(progress.get(a.id)!, progress.get(b.id)!) : 0) || collator.compare(gameName('recipe', a.id, a.name), gameName('recipe', b.id, b.name)) || a.id.localeCompare(b.id));
    const sections = new Map<string, { category: string; products: { itemId: string; recipes: Recipe[] }[] }>();
    for (const recipe of sorted) {
      const p = progress.get(recipe.id)!;
      const key = sort === 'name' ? 'name' : p.groupKey;
      let group = sections.get(key);
      if (!group) { group = { category: sort === 'name' ? t.recipes.byNameGroup : `${p.section} · ${p.step}`, products: [{ itemId: key, recipes: [] }] }; sections.set(key, group); }
      group.products[0].recipes.push(recipe);
    }
    return [...sections.values()];
  }, [filtered, sort, progress, t]);
  const openedCount = catalog.recipes.filter(r => recipeAvailability(catalog, plan, r, t).opened).length;
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
      <div className="search-field"><Search size={18} /><input aria-label={t.recipes.searchLabel} placeholder={t.recipes.searchPlaceholder} value={query} onChange={e => setQuery(e.target.value)} /></div>
      <select aria-label={t.recipes.scopeLabel} value={scope} onChange={e => setScope(e.target.value as SearchScope)}><option value="all">{t.recipes.scope.all}</option><option value="produces">{t.recipes.scope.produces}</option><option value="uses">{t.recipes.scope.uses}</option></select>
      <select aria-label={t.recipes.categoryLabel} value={category} onChange={e => setCategory(e.target.value)}><option value="">{t.recipes.allCategories}</option>{catalog.categories.map(c => <option key={c} value={c}>{gameName('category', c, c)}</option>)}</select>
      <select aria-label={t.recipes.sourceLabel} value={source} onChange={e => { setSource(e.target.value); if (e.target.value !== 'mam') setTree(''); }}><option value="all">{t.recipes.source.all}</option><option value="hub">{t.recipes.source.hub}</option><option value="hard-drive">{t.recipes.source.hardDrive}</option><option value="mam">{t.recipes.source.mam}</option><option value="other">{t.recipes.source.other}</option></select>
      {source === 'mam' && <select aria-label={t.recipes.mamTreeLabel} value={tree} onChange={e => setTree(e.target.value)}><option value="">{t.recipes.allMamTrees}</option>{catalog.researchTrees?.filter(r => !r.seasonal).map(r => <option key={r.id} value={r.id}>{gameName('researchTree', r.id, r.name)}</option>)}</select>}
      <select aria-label={t.recipes.filterLabel} value={filter} onChange={e => setFilter(e.target.value)}><option value="all">{t.recipes.filter.all}</option><option value="alternate">{t.recipes.filter.alternate}</option><option value="enabled">{t.recipes.filter.enabled}</option><option value="disabled">{t.recipes.filter.disabled}</option><option value="opened">{t.recipes.filter.opened}</option><option value="closed">{t.recipes.filter.closed}</option><option value="available">{t.recipes.filter.available}</option></select>
      <select aria-label={t.recipes.sortLabel} value={sort} onChange={e => setSort(e.target.value)}><option value="progress">{t.recipes.sort.progress}</option><option value="name">{t.recipes.sort.name}</option><option value="category">{t.recipes.sort.category}</option></select>
      <select aria-label={t.recipes.modeLabel} value={mode} onChange={e => setMode(e.target.value as QuantityMode)}><option value="cycle">{t.recipes.mode.cycle}</option><option value="minute">{t.recipes.mode.minute}</option><option value="unit">{t.recipes.mode.unit}</option></select>
      <label className="setup-check"><input type="checkbox" checked={hideClosed} onChange={e => setHideClosed(e.target.checked)} />{t.recipes.hideClosed}</label>
    </div>
    <div className="catalog-notes">
      <p className="hint">{sort === 'progress' ? t.recipes.sortHint.progress : sort === 'category' ? t.recipes.sortHint.category : t.recipes.sortHint.name}</p>
      <p className="hint">{t.recipes.previewHint(format(clock))}</p>
      {plan.world && !plan.world.overclockUnlocked && clock > 100 && <p>{t.recipes.overclockClosed}</p>}
    </div>
    <div className="catalog-summary"><span role="status">{t.recipes.found(filtered.length, openedCount, enabledCount, catalog.recipes.length)}</span><div>
      <button className="text-button" onClick={() => toggle(filtered.map(r => r.id), true)}>{t.recipes.enableFound}</button>
      <button className="text-button muted" onClick={() => toggle(filtered.map(r => r.id), false)}>{t.recipes.disableFound}</button>
    </div></div>
    <div className="panel analysis-panel"><button className="primary-button" disabled={!comparisonIds.length || analysis.running} onClick={() => analysis.calculate({ kind: 'recipes', recipeIds: comparisonIds })}>{t.recipes.compareSelected(comparisonIds.length)}</button>
      <p>{t.recipes.compareHint}</p>
      <p>{t.recipes.compareClock(format(plan.settings.clock))}</p>
      <AnalysisFeedback analysis={analysis} catalog={catalog} plan={plan} />
    </div>
    {groups.map(group => {
      const all = group.products.flatMap(p => p.recipes);
      return <details className="panel recipe-group" key={sort + group.products[0].itemId + group.category} open><summary>{t.recipes.groupSummary(sort === 'category' ? gameName('category', group.category, group.category) : group.category, all.filter(r => recipeAvailability(catalog, plan, r, t).opened).length, all.filter(r => plan.settings.enabledRecipeIds.includes(r.id)).length, all.length)}</summary>
        {group.products.map(product => <section key={product.itemId}>
          {sort === 'category' && <h2>{(() => { const entry = catalog.items.find(i => i.id === product.itemId); return entry ? gameName('item', entry.id, entry.name) : product.itemId; })()}</h2>}
          <div className="recipe-grid">{product.recipes.map(recipe => <RecipeCard key={recipe.id} catalog={catalog} plan={plan} recipe={recipe} mode={mode} clock={clock}
            progress={progress.get(recipe.id)!} showProgress={sort !== 'progress'}
            toggle={on => toggle([recipe.id], on)} compare={() => analysis.calculate({ kind: 'recipes', recipeIds: [recipe.id] })} running={analysis.running}
            selected={comparisonIds.includes(recipe.id)} selectionFull={comparisonIds.length >= 12}
            select={on => setComparisonIds(on ? [...comparisonIds, recipe.id] : comparisonIds.filter(id => id !== recipe.id))} />)}</div>
        </section>)}
      </details>;
    })}
    {!filtered.length && <div className="panel empty-panel"><Search size={32} /><h3>{t.recipes.nothingFound}</h3><p>{t.recipes.nothingFoundHint}</p></div>}
  </div>;
}
function ManufacturingRecipeCard({ catalog, plan, recipe, mode, clock, toggle, compare, running, selected, selectionFull, select, progress, showProgress }: {
  progress: RecipeProgress; showProgress: boolean;
  catalog: Catalog; plan: Plan; recipe: Recipe; mode: QuantityMode; clock: number;
  toggle: (on: boolean) => void; compare: () => void; running: boolean; selected: boolean; selectionFull: boolean; select: (on: boolean) => void;
}) {
  const t = useT();
  const [outputId, setOutputId] = useState(recipe.outputs[0].itemId);
  const a = recipeAvailability(catalog, plan, recipe, t);
  const metrics = recipeMetrics(catalog, recipe, clock, mode, outputId);
  const item = (id: string) => catalog.items.find(i => i.id === id);
  const itemName = (id: string) => { const entry = item(id); return entry ? gameName('item', entry.id, entry.name) : undefined; };
  const buildingName = (() => { const entry = catalog.buildings.find(b => b.id === recipe.buildingId); return entry ? gameName('building', entry.id, entry.name) : undefined; })();
  const quantityUnit = (id: string) => (item(id)?.fluid ? t.recipes.unitFluid : t.recipes.unitSolid) + (mode === 'minute' ? t.recipes.perMinute : '');
  const comparable = a.opened && a.buildingOpened && a.buildingEnabled;
  const flow = (list: typeof metrics.inputs) => list.map(i => <span key={i.itemId}><ItemIcon item={item(i.itemId)} size={20} />{format(i.amount, 3)} {quantityUnit(i.itemId)} {itemName(i.itemId)}</span>);
  return <article className={'recipe-card' + (a.enabled ? ' enabled' : '') + (a.opened ? '' : ' closed')}>
    <div className="recipe-row">
      <ItemIcon item={item(recipe.outputs[0].itemId)} size={36} />
      <div className="recipe-title"><h3>{gameName('recipe', recipe.id, recipe.name)}</h3><small>{t.recipes.cardSubtitle(buildingName ?? '', format(recipe.seconds * 100 / clock), format(clock))}</small>
        {(recipe.alternate || !a.opened || selected) && <span className="recipe-tags">{recipe.alternate && <span className="alt">{t.recipes.tagAlternate}</span>}{!a.opened && <span className="unavailable">{t.recipes.tagClosed}</span>}{selected && <span>{t.recipes.tagCompared}</span>}</span>}</div>
      <div className="recipe-flow"><span className="sr-only">{t.recipes.flowIn}</span><span className="recipe-flow-side">{flow(metrics.inputs)}</span><span className="recipe-flow-arrow" aria-hidden="true">→</span><span className="sr-only">{t.recipes.flowOut}</span><span className="recipe-flow-side">{flow(metrics.outputs)}</span></div>
      <span className="recipe-power">{t.recipes.power(format(metrics.power, 3))}{metrics.estimated ? '*' : ''}</span>
      <label className="switch"><input type="checkbox" aria-label={t.recipes.enableRecipe(gameName('recipe', recipe.id, recipe.name))} checked={a.enabled} disabled={!a.opened && !a.enabled} onChange={e => toggle(e.target.checked)} /><span /></label>
    </div>
    <details className="recipe-more"><summary>{t.recipes.moreAndCompare}</summary>
      <div className="recipe-tags"><span>{gameName('category', recipe.category, recipe.category)}</span>{plan.world && <span>{a.opened ? t.recipes.openedInWorld : t.recipes.tagClosed}</span>}<span>{a.enabled ? t.recipes.enabledInPlan : t.recipes.disabledInPlan}</span></div>
      {showProgress && <p className="hint">{progress.section} · {progress.step}</p>}
      {progress.unlockIds.length > 1 && <details><summary>{t.recipes.allUnlockPaths}</summary><ul>{progress.unlockIds.map(id => { const unlock = catalog.unlocks?.find(u => u.id === id); return <li key={id}>{unlock ? gameName('schematic', unlock.id, unlock.name) : id}</li>; })}</ul></details>}
      {a.reasons.length > 0 && <ul className="muted">{a.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}
      {recipe.outputs.length > 1 && <label>{t.recipes.normalizeBy}<select aria-label={t.recipes.normalizeLabel(gameName('recipe', recipe.id, recipe.name))} value={outputId} onChange={e => setOutputId(e.target.value)}>{recipe.outputs.map(o => <option key={o.itemId} value={o.itemId}>{itemName(o.itemId) ?? o.itemId}</option>)}</select></label>}
      {mode === 'unit' && <p>{t.recipes.perUnitNote(item(outputId)?.fluid ? t.recipes.unitFluid : t.recipes.unitSolid, itemName(outputId) ?? '')}</p>}
      <p>{t.recipes.energyLine(format(metrics.power, 3), format(metrics.energyPerUnit, 4), item(outputId)?.fluid ? t.recipes.unitFluid : t.recipes.unitSolid, itemName(outputId) ?? '')}{metrics.estimated ? t.recipes.estimatedPower : ''}</p>
      <div className="recipe-actions"><button className="secondary-button" disabled={running || !comparable} onClick={compare} aria-label={t.recipes.compareForFactory(gameName('recipe', recipe.id, recipe.name))}>{a.enabled ? t.recipes.compareWithout : t.recipes.compareFor}</button>
      <label><input type="checkbox" aria-label={t.recipes.selectForJoint(gameName('recipe', recipe.id, recipe.name))} checked={selected} disabled={running || !comparable || (!selected && selectionFull)} onChange={e => select(e.target.checked)} /> {t.recipes.jointCompare}</label></div>
    </details>
  </article>;
}

function RecipeCard(props: Parameters<typeof ManufacturingRecipeCard>[0]) {
  const t = useT();
  const { recipe, catalog, plan, toggle } = props;
  if (!recipe.generation) return <ManufacturingRecipeCard {...props} />;
  const availability = recipeAvailability(catalog, plan, recipe, t);
  const recipeName = gameName('recipe', recipe.id, recipe.name);
  const flows = (list: typeof recipe.inputs) => list.map(i => { const entry = catalog.items.find(x => x.id === i.itemId); return `${entry ? gameName('item', entry.id, entry.name) : undefined}: ${format(i.amount, 4)}`; }).join(', ');
  return <article className="panel recipe-card"><h3>{recipeName}</h3>
    <label className="inline-check"><input type="checkbox" aria-label={t.recipes.enableRecipe(recipeName)} checked={availability.enabled} disabled={!availability.opened && !availability.enabled} onChange={e => toggle(e.target.checked)} />{t.recipes.allowGeneration}</label>
    <p>{t.recipes.generationOutput(format(recipe.generation.power))}</p>
    <p>{t.recipes.generationUse(flows(recipe.inputs))}</p>
    {!!recipe.outputs.length && <p>{t.recipes.generationWaste(flows(recipe.outputs))}</p>}
    <p className="hint">{t.recipes.generationHint}</p>
    {availability.reasons.map(reason => <p key={reason}>{reason}</p>)}
  </article>;
}
