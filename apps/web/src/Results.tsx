import { useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, Boxes, Factory, Info, Layers, TriangleAlert } from 'lucide-react';
import type { Catalog, Plan, Result } from '../../../packages/domain/types';
import { hasSolution } from '../../../packages/domain/types';
import { residueCandidates } from '../../../packages/solver/residues';
import { residueHref } from './ResidueHelp';
import { buildConstruction, type ConstructionModel } from '../../../packages/domain/construction';
import { buildSchematic } from '../../../packages/domain/schematic';
import { constructionDependencies, nextBuildStep } from '../../../packages/domain/constructionProgress';
import { mapResourceLimits } from '../../../packages/domain/mapResources';
import { buildComplexity } from '../../../packages/domain/complexity';
import { parallelLines } from '../../../packages/domain/transport';
import { sourceLabel } from '../../../packages/domain/sourceLabel';
import { CatalogStatus, Construction, CopyNumber, type ConstructionView } from './Construction';
import { buildOrder, ResultBoard } from './ResultBoard';
import { useConstructionMarks } from './useConstructionMarks';
import { usedResources } from './resultResources';
import { BatchResult } from './Batch';
import { AlternatesRanking } from './AlternatesRanking';
import { PowerCoverage } from './PowerCoverage';
import { format, ItemIcon, unit } from './controls';
import { useT } from './i18n';
import { gameName } from './i18n/gameNames';

export { usedResources };
function Section({ title, count, className = '', open, children, sectionRef }: { title: string; count?: number; className?: string; open?: boolean; children: ReactNode; sectionRef?: React.Ref<HTMLDetailsElement> }) {
  return <details className={`result-section ${className}`} open={open} ref={sectionRef}><summary><h3>{title}</h3>{count !== undefined && <span className="count-badge">{count}</span>}</summary><div className="result-section-body">{children}</div></details>;
}
function ResultBody({ catalog, plan, result, model, scope, residueItemIds, children }: { catalog: Catalog; plan: Plan; result: Result; model: ConstructionModel; scope?: string; residueItemIds: readonly string[]; children: ReactNode }) {
  const text = useT().results;
  const marks = useConstructionMarks(model, scope);
  const [view, setView] = useState<ConstructionView>('instruction');
  const [focus, setFocus] = useState<string | null>(null);
  const build = useRef<HTMLDetailsElement>(null);
  // A new object on every render would restart the schematic layout worker.
  const destinationsKey = JSON.stringify([result.products, result.exports, plan.exports]);
  const destinations = useMemo(() => ({ products: result.products, exports: result.exports?.map(e => ({ ...e, name: plan.exports?.find(x => x.itemId === e.itemId)?.name })) }), [destinationsKey]);
  const graph = useMemo(() => {
    try { return buildSchematic(catalog, model, destinations, 'configurations'); }
    catch { return null; }
  }, [catalog, model, destinations]);
  const order = useMemo(() => buildOrder(model, graph), [model, graph]);
  const progress = useMemo(() => graph && constructionDependencies(graph), [graph]);
  const step = progress && nextBuildStep(order, progress, marks.built);
  const show = (id: string) => {
    if (build.current) build.current.open = true;
    setView('types'); setFocus(id);
    build.current?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };
  return <>
    <ResultBoard catalog={catalog} plan={plan} result={result} model={model} order={order} built={marks.built} progress={progress} step={step} onMark={marks.markParts} onShow={show} />
    <div className="result-sections">
      <Section title={text.build} open sectionRef={build}>
        <Construction residueItemIds={residueItemIds} scope={scope} catalog={catalog} model={model} destinations={destinations} marks={marks} view={view} onView={setView}
          nextId={step?.kind === 'ready' ? step.id : undefined} focus={focus} onFocused={() => setFocus(null)} />
      </Section>
      {children}
    </div>
  </>;
}
export function ModelNotes({ notes }: { notes: string[] }) {
  const text = useT().results;
  return <details className="panel model-notes"><summary>{text.aboutModel}</summary><ul>{notes.map(note => <li key={note}>{note}</li>)}</ul></details>;
}
export function Results({ catalog, plan, result, stale, running, error, onEnableRecipe, constructionScope }: { constructionScope?: string; catalog: Catalog; plan: Plan; result: Result | null; stale: boolean; running: boolean; error: string | null; onEnableRecipe?: (recipeId: string) => void }) {
  const text = useT().results;
  const item = (id: string) => catalog.items.find(i => i.id === id);
  const itemName = (id: string) => gameName('item', id, item(id)?.name ?? id);
  const resourceNotes = [text.noteStationary, text.noteMegawatts, text.noteImport];
  const calculated = useMemo(() => {
    if (!hasSolution(result) || stale) return { model: null, error: '' };
    try { return { model: buildConstruction(catalog, plan, result), error: '' }; }
    catch (e) { return { model: null, error: e instanceof Error ? e.message : text.checkFailed }; }
  }, [catalog, plan, result, stale, text]);
  const model = calculated.model;
  const residueItemIds = useMemo(() => model ? residueCandidates(catalog, plan, result) : [], [catalog, plan, result, model]);
  const residueLink = (id: string) => residueItemIds.includes(id) && <a href={residueHref(id)}>{text.pickProcessing}</a>;
  const mapLimits = useMemo(() => mapResourceLimits(catalog), [catalog]);
  const empty = !plan.batch?.items.every(i => i.stock >= i.required) && hasSolution(result) && !result.products.some(p => p.rate > 0);
  const settings = plan.settings;
  const peakLimit = settings.peakPowerLimit ?? null, reserve = settings.powerReserve ?? 0;
  const margin = model && peakLimit !== null ? peakLimit - reserve - model.peakPower : null;
  const shownResources = result ? usedResources(plan, result.resources) : [];
  const lines = (id: string, rate: number) => {
    const fluid = item(id)?.fluid;
    const capacity = (fluid ? model?.transport.pipe : model?.transport.belt)?.rate;
    if (!capacity) return null;
    const count = parallelLines(rate, capacity);
    return text.lineCount(count, !!fluid);
  };
  const exportName = (id: string) => plan.exports?.find(x => x.itemId === id)?.name?.trim();
  const complexity = result && hasSolution(result) ? buildComplexity(plan, result) : null;
  return <div className="results-column">
    <p className="sr-only" role="status">{running ? text.balancing : error ? '' : result ? stale ? text.settingsChanged : empty ? text.zeroOutput : text.statusLabels[result.status] : text.notCalculated}</p>
    {result && <div className="results-heading"><span className={'status-badge ' + (stale ? 'stale' : result.status)}><span />{stale ? text.recalcNeeded : empty ? text.zeroOutput : text.statusLabels[result.status]}</span></div>}
    {error && <div role="alert" className="alert error"><TriangleAlert size={18} />{error}</div>}
    {running && <div className="alert"><span className="spinner" />{text.balancing}</div>}
    {!result ? <div className="empty-result"><div className="factory-illustration"><span className="orbit one" /><span className="orbit two" /><Factory size={72} strokeWidth={1.2} /><span className="factory-dot" /></div><h3>{text.emptyTitle}</h3><p>{text.emptyBody()}</p><div className="empty-steps"><span><Boxes size={16} />{text.stepResources}</span><ArrowRight size={14} /><span><Factory size={16} />{text.stepProduction}</span><ArrowRight size={14} /><span><Layers size={16} />{text.stepProducts}</span></div></div>
      : <div className={stale ? 'result-content stale-content' : 'result-content'}>
        {!stale && !!result.warnings.length && <div className="alert warning"><Info size={18} /><div>{result.warnings.map(w => <p key={w}>{w}</p>)}</div></div>}
        {stale ? <section className="panel"><h3>{text.staleTitle}</h3><p>{text.staleBody}</p></section>
          : !hasSolution(result) ? <div className="panel result-problem"><TriangleAlert size={32} /><h3>{text.statusLabels[result.status]}</h3><p>{result.message}</p>{result.status === 'infeasible' && <p className="hint">{text.infeasibleHint}</p>}{result.status === 'unbounded' && <p className="hint">{text.unboundedHint}</p>}</div>
            : empty ? <section className="panel result-problem"><Factory size={32} /><h3>{result.status === 'approximate' ? text.emptyApproxTitle : text.emptyNoPathTitle}</h3><p>{result.status === 'approximate' ? text.emptyApproxBody : text.emptyNoPathBody}</p><p>{text.emptyCheck}</p></section>
              : calculated.error ? <section className="panel" role="alert"><h3>{text.recheckFailed}</h3><p>{calculated.error}</p></section>
: model && <ResultBody key={JSON.stringify([constructionScope, model.fingerprint])} catalog={catalog} plan={plan} result={result} model={model} scope={constructionScope} residueItemIds={residueItemIds}>
                  <Section title={text.summary} className="result-summary"><dl><div><dt>{text.productionMachines}</dt><dd>{model.production.reduce((sum, group) => sum + group.count, 0)}<small>{text.buildings}</small></dd></div><div><dt>{text.distinctRecipes}</dt><dd>{complexity?.distinctRecipes ?? 0}</dd></div><div><dt>{text.intermediateItems}</dt><dd>{complexity?.intermediateItems ?? 0}<small>{text.insideFactory}</small></dd></div></dl></Section>
                  <Section title={text.products} className="output-panel">{result.products.map(product => <div className="output-row" key={product.itemId}><ItemIcon item={item(product.itemId)} size={42} /><div><strong>{itemName(product.itemId)}</strong><small>{lines(product.itemId, product.rate) && text.parallel(lines(product.itemId, product.rate)!) + ' · '}{text.averageFlow}</small></div><CopyNumber value={product.rate} label={text.outputLabel(itemName(product.itemId))} suffix={unit(item(product.itemId))} /></div>)}</Section>
                  {!!result.exports?.length && <Section title={text.exports} className="output-panel">{result.exports.map(e => <div className="output-row" key={e.itemId}><ItemIcon item={item(e.itemId)} size={42} /><div><strong>{itemName(e.itemId)}</strong><small>{[lines(e.itemId, e.rate) && text.parallel(lines(e.itemId, e.rate)!), exportName(e.itemId)].filter(Boolean).join(' · ')}</small>{residueLink(e.itemId)}</div><CopyNumber value={e.rate} label={text.exportLabel(itemName(e.itemId))} suffix={unit(item(e.itemId))} /></div>)}</Section>}
                  <Section title={text.sourceLoad} count={shownResources.length}>{shownResources.map(source => {
                    const configured = plan.sources.find(s => s.id === source.sourceId);
                    return <div className="utilization" key={source.sourceId}><div><span><ItemIcon item={item(source.itemId)} size={24} />{sourceLabel(catalog, plan, source.sourceId, source.itemId)}</span><strong>{format(source.rate, 6)} <small>/ {source.limit === null ? '∞' : format(source.limit)} {unit(item(source.itemId))}</small></strong></div><small>{configured?.kind === 'node' ? text.nodeSource(gameName('miner', configured.minerId, catalog.miners.find(m => m.id === configured.minerId)?.name ?? configured.minerId), format(configured.clock), configured.count) : configured?.kind === 'well' ? text.wellSource(format(configured.clock), format(source.power)) : configured?.importPower != null ? text.importKnown(format(source.power)) : text.importUnknown}{mapLimits[source.itemId] != null && source.rate > 0 && text.mapReserve(format(source.rate / mapLimits[source.itemId]! * 100, 3))}{source.rate > 0 && lines(source.itemId, source.rate) && text.acrossBorder(lines(source.itemId, source.rate)!)}</small><div className="progress-track"><span className={source.limit !== null && source.limit > 0 && source.rate / source.limit > .98 ? 'full' : ''} style={{ width: source.limit === null ? '20%' : Math.min(100, source.limit > 0 ? source.rate / source.limit * 100 : 0) + '%' }} /></div></div>;
                  })}{!shownResources.length && <p className="hint">{text.noExternal}</p>}{!!shownResources.length && <p className="hint">{text.linesHint}</p>}{shownResources.length < result.resources.length && <p className="hint">{text.hiddenResources}</p>}</Section>
                  <Section title={text.energy} className="energy-panel"><dl>
                    {result.generation && <><div><dt>{text.generation}</dt><dd>{text.mw(format(result.generation.power))}</dd></div><div><dt>{text.localAveragePeak}</dt><dd>{text.mwPair(format(result.generation.localPower), format(result.generation.localPeak))}</dd></div><div><dt>{text.generationReserve}</dt><dd>{text.mw(format(result.generation.reserve))}</dd></div><div><dt>{text.knownImportPower}</dt><dd>{text.mw(format(result.generation.importPower))}</dd></div></>}<div><dt>{text.productionAverage}</dt><dd>{text.mw(format(model.productionPower))}</dd></div><div><dt>{text.extractionAverage}</dt><dd>{text.mw(format(model.extractionPower))}</dd></div>{model.sinkPower > 0 && <div><dt>{text.sinkAverage}</dt><dd>{text.mw(format(model.sinkPower))}</dd></div>}
                    <div><dt>{text.idlePower}</dt><dd>{text.mw(format(model.productionIdlePower))}</dd></div>
                    {plan.settings.powerLimit !== null && <><div><dt>{text.averageBudget}</dt><dd>{text.mw(format(plan.settings.powerLimit))}</dd></div><div><dt>{text.budgetRemainder}</dt><dd>{text.mw(format(plan.settings.powerLimit - model.averagePower))}</dd></div></>}
                    <div className="total"><dt>{text.conservativePeak}</dt><dd>{text.mw(format(model.peakPower))}</dd></div>
                    {peakLimit !== null && <div><dt>{text.gridMaxLoad}</dt><dd>{text.mw(format(peakLimit))}</dd></div>}{reserve > 0 && <div><dt>{text.userReserve}</dt><dd>{text.mw(format(reserve))}</dd></div>}
                    {margin !== null && <div className="total"><dt>{text.gridMargin}</dt><dd>{text.mw(format(margin))}</dd></div>}
                  </dl>{margin !== null && <p className={margin < -1e-6 ? 'alert error' : 'hint'} role={margin < -1e-6 ? 'alert' : undefined}>{text.marginLine(format(peakLimit!), format(reserve), format(model.peakPower), format(margin), margin < -1e-6)}</p>}
                    {model.externalSources.map(source => <p key={source.sourceId}>{text.externalSource(source.power === null, source.name, format(source.rate, 6), unit(item(source.itemId)), source.power === null ? null : format(source.power))}</p>)}
                    <PowerCoverage catalog={catalog} average={model.averagePower} peak={model.peakPower} reserve={reserve} />
                  </Section>
                  <AlternatesRanking catalog={catalog} plan={plan} result={result} onEnable={onEnableRecipe} />
                </ResultBody>}
        {!stale && result.status === 'infeasible' && result.feasibleAlternative && <section className="panel feasible-alternative" aria-labelledby="alternative-title"><div className="section-heading"><div><h3 id="alternative-title">{text.reachableOutput}</h3></div><span className="status-badge stale">{text.orderShare(format(result.feasibleAlternative.fraction * 100, 8))}</span></div><p className="hint">{text.alternativeHint}</p>{result.feasibleAlternative.products.map(product => <div className="output-row" key={product.itemId}><ItemIcon item={item(product.itemId)} size={36} /><div><strong>{itemName(product.itemId)}</strong></div><strong className="output-rate">{format(product.rate, 6)}<small>{unit(item(product.itemId))}</small></strong></div>)}<div className="simple-row"><span>{text.alternativePower}</span><strong>{text.mw(format(result.feasibleAlternative.power))}</strong></div>{!!result.feasibleAlternative.bottlenecks.length && <div className="alternative-bottlenecks"><h4>{text.bottlenecks}</h4><ul>{result.feasibleAlternative.bottlenecks.map((bottleneck, index) => <li key={index}>{bottleneck}</li>)}</ul></div>}</section>}
        {!stale && hasSolution(result) && <ModelNotes notes={[...resourceNotes, ...result.modelNotes ?? []]} />}
        <details className="diagnostics"><summary>{text.diagnostics(stale)}</summary><p>{text.solverStatus(text.statusLabels[result.status])}</p><p>{result.message}</p><p>{text.maxBalanceError(result.maxBalanceError.toExponential(3))}</p>{result.diagnostics.map((d, i) => <p key={i}>{d}</p>)}</details>
      </div>}
    {!stale && hasSolution(result) && <><BatchResult catalog={catalog} plan={plan} result={result} />{!!(plan.somersloopBudget || result.somersloops) && <section className="panel"><p>{text.somersloops(result.somersloops ?? 0, plan.somersloopBudget ?? 0)}</p></section>}</>}<CatalogStatus catalog={catalog} />
  </div>;
}
