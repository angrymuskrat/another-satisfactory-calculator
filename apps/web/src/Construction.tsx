import { useState } from 'react';
import type { Catalog } from '../../../packages/domain/types';
import type { ConstructionGroup, ConstructionModel } from '../../../packages/domain/construction';
import { orderDependencies } from '../../../packages/domain/dependencies';
import { format, ItemIcon, unit } from './controls';
import { useT } from './i18n';
import { gameName } from './i18n/gameNames';
import mechanics from '../../../packages/game-data/p2-mechanics.json' with { type: 'json' };
import { Schematic } from './Schematic';
import type { SchematicDestinations, SchematicMode } from '../../../packages/domain/schematic';
import { builtCount } from '../../../packages/domain/constructionProgress';
import { defaultScope, type ConstructionMarks } from './useConstructionMarks';

export type ConstructionView = 'instruction' | SchematicMode;

export function CopyNumber({ value, label, suffix = '' }: { value: number; label: string; suffix?: string }) {
  const t = useT();
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(String(value));
      setNotice({ text: t.construction.copied, error: false });
    } catch { setNotice({ text: t.construction.copyFailed, error: true }); }
  };
  return <span><button type="button" className="copy-value" title={t.construction.copyLabel(label)} aria-label={t.construction.copyLabel(label)} onClick={() => void copy()}>{value !== 0 && Math.abs(value) < 1e-6 ? value.toExponential(3) : format(value, 6)}{suffix && ` ${suffix}`}</button>{notice && <small role={notice.error ? 'alert' : 'status'}>{notice.text}{notice.error && <input aria-label={t.construction.manualCopyLabel(label)} readOnly value={String(value)} onFocus={e => e.currentTarget.select()} />}</small>}</span>;
}

export function Construction({ catalog, model, destinations, scope = defaultScope, residueItemIds, marks, view, onView, nextId, focus, onFocused }: {
  catalog: Catalog; model: ConstructionModel; destinations: SchematicDestinations; scope?: string; residueItemIds?: readonly string[];
  marks: ConstructionMarks; view: ConstructionView; onView: (view: ConstructionView) => void;
  nextId?: string; focus?: string | null; onFocused?: () => void;
}) {
  const t = useT();
  const saved = { ranges: marks.built, error: marks.error }, mark = marks.mark;
  const item = (id: string) => catalog.items.find(i => i.id === id);
  const name = (id: string) => gameName('item', id, item(id)?.name ?? id);
  const groups = orderDependencies(model.production.map(g => ({ recipeId: g.id, inputs: g.averageInputs, outputs: g.averageOutputs })));
  const renderGroup = (group: ConstructionGroup, index: string) => {
    const parts = [{ id: group.id, first: 0, count: group.count }];
    const done = builtCount(saved.ranges, parts);
    const machine = group.kind === 'extraction' ? catalog.miners.find(b => b.id === group.buildingId) : catalog.buildings.find(b => b.id === group.buildingId);
    return <details className="production-step" key={group.id} open>
      <summary><span className="step-title"><span className="step-number">{index}</span><ItemIcon item={item(group.averageOutputs[0]?.itemId ?? group.averageInputs[0]?.itemId ?? '')} size={32} /><span><strong>{group.name}</strong><small>{machine ? gameName(group.kind === 'extraction' ? 'miner' : 'building', machine.id, machine.name) : undefined}</small></span></span><span>{group.count}</span><span>{format(group.averagePower)}</span></summary>
      <div className="step-details">{group.generatedPower !== undefined && <p>{t.construction.generatedPower(format(group.generatedPower))}</p>}
        <div className="full-width"><p>{t.construction.machinesAndClock(<CopyNumber value={group.count} label={t.construction.machineCountLabel(group.name)} />, <CopyNumber value={group.clock} label={t.construction.clockLabel(group.name)} suffix="%" />)}</p>
          <p>{t.construction.existingLine(group.existing ?? 0, group.count - (group.existing ?? 0), group.somersloops ?? 0)}</p><p>{t.construction.dutyLine(<CopyNumber value={group.activeDuty * 100} label={t.construction.dutyLabel(group.name)} suffix="%" />)}</p>
          {group.kind === 'sink' && <p className="hint">{t.construction.sinkHint}</p>}
          <label><input type="checkbox" aria-label={t.construction.builtLabel(group.name)} checked={done === group.count} ref={el => { if (el) el.indeterminate = done > 0 && done < group.count; }} onChange={e => mark(parts, e.target.checked ? group.count : 0)} /> {t.construction.builtLine(group.name, done, group.count)}</label>
        </div>
        {([['inputs', group.activeInputs, group.averageInputs], ['outputs', group.activeOutputs, group.averageOutputs]] as const).map(([direction, active, average]) => { const title = direction === 'inputs' ? t.construction.input : t.construction.output; return <div key={direction}><h4>{title}</h4>{!active.length && <p className="hint">{group.kind === 'sink' && direction === 'outputs' ? t.construction.sinkNoOutputs : t.construction.noFlows}</p>}{active.map((flow, index) => <div key={flow.itemId}><strong>{name(flow.itemId)}</strong><p>{t.construction.oneMachine(<CopyNumber value={flow.rate} label={t.construction.oneMachineLabel(group.name, title, name(flow.itemId))} suffix={unit(item(flow.itemId))} />)}</p><p>{t.construction.groupAverage(<CopyNumber value={average[index].rate} label={t.construction.groupAverageLabel(group.name, title, name(flow.itemId))} suffix={unit(item(flow.itemId))} />)}</p></div>)}</div>; })}
        <div className="full-width"><p>{t.construction.activePower(<CopyNumber value={group.activePower} label={t.construction.activePowerLabel(group.name)} suffix={t.construction.megawatt} />)}</p><p>{t.construction.averageAndPeak(<CopyNumber value={group.averagePower} label={t.construction.averagePowerLabel(group.name)} suffix={t.construction.megawatt} />, <CopyNumber value={group.peakPower} label={t.construction.peakPowerLabel(group.name)} suffix={t.construction.megawatt} />)}</p>{group.powerEstimated && <p className="hint">{t.construction.powerEstimated}</p>}</div>
      </div>
    </details>;
  };
  return <div className="construction-panel">
    <div className="construction-views segmented" role="group" aria-label={t.construction.viewLabel}>{([['instruction', t.construction.viewInstruction], ['types', t.construction.viewSchematic]] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={view === value} onClick={() => onView(value)}>{label}</button>)}</div>
    {view !== 'instruction' && saved.error && <p role="alert">{saved.error}</p>}
    {view !== 'instruction' ? <Schematic key={view} catalog={catalog} model={model} destinations={destinations} mode={view} scope={scope} built={saved.ranges} mark={mark} residueItemIds={residueItemIds} nextId={nextId} focus={focus} onFocused={onFocused} /> : <>
    <section className="panel"><h3>{t.construction.instructionTitle}</h3><p>{t.construction.instructionIntro}</p><p className="hint">{t.construction.activeRatesHint}</p><p className="hint">{t.construction.marksHint}</p>{saved.error && <p role="alert">{saved.error}</p>}</section>
    <section className="panel production-panel"><div className="section-heading"><h3>{t.construction.stagesTitle}</h3><span className="count-badge">{model.production.length}</span></div>
      <p className="hint">{t.construction.suppliersHint}</p>
      <div className="production-table"><div className="production-header"><span>{t.construction.recipeBuilding}</span><span>{t.construction.machines}</span><span>{t.construction.averageMegawatts}</span></div>{groups.map((group, index) => <div key={group.recipeIds.join('|')}>
        {group.cyclic && <div className="alert warning"><div><h4>{t.construction.cycleTitle(index + 1)}</h4><p>{t.construction.cycleBody}</p>{group.internalFlows.map(flow => <p key={flow.itemId}>{t.construction.internalFlow(name(flow.itemId), format(flow.produced, 6), format(flow.consumed, 6), unit(item(flow.itemId)))}</p>)}<p>{t.construction.cycleNote}</p></div></div>}
        {group.recipeIds.map((id, member) => renderGroup(model.production.find(g => g.id === id)!, group.cyclic ? `${index + 1}.${member + 1}` : String(index + 1)))}
      </div>)}</div>{!groups.length && <p className="hint">{t.construction.noBuildings}</p>}
    </section>
    {!!model.extraction.length && <section className="panel production-panel"><h3>{t.construction.extractorsTitle}</h3><div className="production-table"><div className="production-header"><span>{t.construction.extractorHeader}</span><span>{t.construction.machines}</span><span>{t.construction.averageMegawatts}</span></div>{model.extraction.map((g, i) => renderGroup(g, String(i + 1)))}</div></section>}
    {!!model.sinks.length && <section className="panel production-panel"><h3>{t.construction.sinksTitle}</h3><div className="production-table"><div className="production-header"><span>{t.construction.sinkHeader}</span><span>{t.construction.machines}</span><span>{t.construction.averageMegawatts}</span></div>{model.sinks.map((g, i) => renderGroup(g, String(i + 1)))}</div><p className="hint">{t.construction.sinksHint}</p></section>}
    <section className="panel"><h3>{t.construction.materialsTitle}</h3><p>{t.construction.materialsSummary(model.addedMaterials.totalMachines, model.materials.totalMachines, model.materials.knownMachines)}</p>
      <div className="table-scroll"><table><caption className="sr-only">{t.construction.materialsTitle}</caption><thead><tr><th scope="col">{t.construction.colMaterial}</th><th scope="col">{t.construction.colNew}</th><th scope="col">{t.construction.colTotal}</th></tr></thead><tbody>{model.materials.items.map(i => {
        const itemName = name(i.itemId), suffix = item(i.itemId)?.fluid ? t.construction.fluidUnit : t.construction.solidUnit;
        const added = model.addedMaterials.items.find(a => a.itemId === i.itemId)?.amount ?? 0;
        return <tr key={i.itemId}><th scope="row">{itemName}</th><td><CopyNumber value={added} label={t.construction.newMaterialLabel(itemName)} suffix={suffix} /></td><td><CopyNumber value={i.amount} label={t.construction.materialLabel(itemName)} suffix={suffix} /></td></tr>;
      })}</tbody></table></div>
      {model.materials.complete ? <p className="hint">{t.construction.allCounted}</p> : <p className="hint">{t.construction.incompleteList}</p>}{model.materials.unknown.map(b => <p key={b.buildingId}>{t.construction.unknownCost(b.name, b.count)}</p>)}<p className="hint">{t.construction.notIncluded}</p></section>
    </>}
  </div>;
}

export function CatalogStatus({ catalog }: { catalog: Catalog }) {
  const t = useT();
  const sections = [
    { name: t.construction.sectionRecipes, pattern: /количеств|длительност|рецепт/i },
    { name: t.construction.sectionPower, pattern: /мощност|средн|крив|энерги/i },
    { name: t.construction.sectionLocalization, pattern: /названи|локализ|ru\.json|RU\/EN/i },
    { name: t.construction.sectionGrouping, pattern: /групп|категор|mCategory|MenuPriority/i },
  ];
  return <details className="panel"><summary>{t.construction.statusTitle}</summary><p>{t.construction.statusSource(catalog.provenance.source)}</p><p>{t.construction.statusCatalog(catalog.version, catalog.provenance.commit, catalog.provenance.importedAt)}</p><p>{t.construction.statusFlag(catalog.provenance.verified)}</p>{sections.map(section => {
    const notes = catalog.provenance.notes.filter(note => section.pattern.test(note));
    return <section key={section.name}><h4>{section.name}</h4>{notes.length ? notes.map(note => <p key={note}>{note}</p>) : <p>{t.construction.noSectionNotes}</p>}</section>;
  })}<p>{t.construction.statusCosts(catalog.buildings.filter(b => 'buildCost' in b && Array.isArray(b.buildCost)).length, catalog.buildings.length, catalog.miners.filter(b => 'buildCost' in b && Array.isArray(b.buildCost)).length, catalog.miners.length)}</p>{catalog.version === mechanics.provenance.catalogVersion && <p>{t.construction.statusCompensator}</p>}</details>;
}
