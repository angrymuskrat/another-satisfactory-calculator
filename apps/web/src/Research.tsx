import type { Catalog, Unlock } from '../../../packages/domain/types';
import { researchChain, researchDescription, researchName } from '../../../packages/domain/research';
import { useT } from './i18n';
import { gameName } from './i18n/gameNames';

export function ResearchChainView({ catalog, roots, completed }: { catalog: Catalog; roots: string[]; completed: string[] }) {
  const t = useT();
  const chain = researchChain(catalog, roots, completed);
  return <details><summary>{t.research.chainSummary(chain.steps.length)}</summary>
    <p className="hint">{t.research.chainHint}</p>
    <ol>{chain.steps.map(step => <li key={step.id}><strong>{gameName('schematic', step.id, step.name)}</strong>{step.completed ? t.research.stepDone : t.research.stepPending}
      <ul>{step.conditions.map((condition, index) => <li key={index}>{condition}</li>)}</ul></li>)}</ol>
    {!!chain.cycles.length && <p className="hint">{t.research.cycle(chain.cycles.map(id => gameName('schematic', id, researchName(catalog, id))).join(', '))}</p>}
  </details>;
}
export function ResearchGuide({ catalog, completed, mark }: { catalog: Catalog; completed: string[]; mark: (unlock: Unlock) => void }) {
  const t = useT();
  if (!catalog.researchTrees?.length) return null;
  return <details className="research-guide"><summary>{t.research.guideSummary}</summary>
    <p className="hint">{t.research.guideHint}</p>
    {catalog.researchTrees.map(tree => <details key={tree.id}><summary>{t.research.treeSummary(gameName('researchTree', tree.id, tree.name), tree.nodes.length, !!tree.seasonal)}</summary>
      {tree.conditions.map((condition, i) => <p className="hint" key={i}>{condition}</p>)}
      {tree.nodes.map(node => {
        const unlock = catalog.unlocks?.find(u => u.id === node.schematicId);
        const nodeName = gameName('schematic', node.schematicId, node.name);
        return <details key={node.schematicId}><summary>{nodeName}{completed.includes(node.schematicId) ? t.research.nodeDone : ''}</summary>
          <ul>{researchDescription(catalog, node.schematicId, completed).map((condition, i) => <li key={i}>{condition}</li>)}</ul>
          <ResearchChainView catalog={catalog} roots={[node.schematicId]} completed={completed} />
          {unlock && !tree.seasonal ? <button className="secondary-button" disabled={completed.includes(unlock.id)} onClick={() => mark(unlock)}>{t.research.markDone(nodeName)}</button>
            : <p className="hint">{t.research.referenceScheme}</p>}
        </details>;
      })}
    </details>)}
    <details><summary>{t.research.phasesSummary}</summary>
      <p className="hint">{t.research.phasesHint}</p>
      <div className="table-scroll"><table><caption>{t.research.phasesCaption}</caption><thead><tr><th scope="col">{t.research.phaseHeader}</th><th scope="col">{t.research.lastTierHeader}</th></tr></thead><tbody>{catalog.gamePhases?.map(phase => <tr key={phase.id}><th scope="row">{gameName('gamePhase', phase.id, phase.name)}</th><td>{phase.lastTier}</td></tr>)}</tbody></table></div>
    </details>
  </details>;
}
