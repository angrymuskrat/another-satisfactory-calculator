import type { Catalog, Unlock } from '../../../packages/domain/types';
import { researchChain, researchDescription, researchName } from '../../../packages/domain/research';

export function ResearchChainView({ catalog, roots, completed }: { catalog: Catalog; roots: string[]; completed: string[] }) {
  const chain = researchChain(catalog, roots, completed);
  return <details><summary>Связанные исследования · {chain.steps.length}</summary>
    <p className="hint">Это все известные ветви связей, а не обязательная покупка каждой схемы. «ИЛИ» означает достаточно одного варианта; отдельные условия схемы выполняются совместно.</p>
    <ol>{chain.steps.map(step => <li key={step.id}><strong>{step.name}</strong>{step.completed ? ' · отмечено завершение' : ' · не отмечено'}
      <ul>{step.conditions.map((condition, index) => <li key={index}>{condition}</li>)}</ul></li>)}</ol>
    {!!chain.cycles.length && <p className="hint">В связях есть цикл: {chain.cycles.map(id => researchName(catalog, id)).join(', ')}. Автоматическая последовательность не определена.</p>}
  </details>;
}
export function ResearchGuide({ catalog, completed, mark }: { catalog: Catalog; completed: string[]; mark: (unlock: Unlock) => void }) {
  if (!catalog.researchTrees?.length) return null;
  return <details className="research-guide"><summary>Граф исследований MAM и фазы HUB</summary>
    <p className="hint">Связи и названия взяты из assets установленной сборки. Родители узла соединены ИЛИ; условия показа и условия схемы проверяются отдельно. Подбор предметов, внешние события и достижение фаз не отслеживаются. Завершение отмечайте после исследования в игре; предки автоматически не отмечаются.</p>
    {catalog.researchTrees.map(tree => <details key={tree.id}><summary>{tree.name} · {tree.nodes.length} исследований{tree.seasonal ? ' · сезонная ветка' : ''}</summary>
      {tree.conditions.map((condition, i) => <p className="hint" key={i}>{condition}</p>)}
      {tree.nodes.map(node => {
        const unlock = catalog.unlocks?.find(u => u.id === node.schematicId);
        return <details key={node.schematicId}><summary>{node.name}{completed.includes(node.schematicId) ? ' · завершено' : ''}</summary>
          <ul>{researchDescription(catalog, node.schematicId, completed).map((condition, i) => <li key={i}>{condition}</li>)}</ul>
          <ResearchChainView catalog={catalog} roots={[node.schematicId]} completed={completed} />
          {unlock && !tree.seasonal ? <button className="secondary-button" disabled={completed.includes(unlock.id)} onClick={() => mark(unlock)}>Отметить завершённым: {node.name}</button>
            : <p className="hint">Справочная схема вне списка открытий расчётного каталога. Она не изменяет доступность рецептов.</p>}
        </details>;
      })}
    </details>)}
    <details><summary>Фазы проекта и уровни HUB</summary>
      <p className="hint">Верхняя граница уровня импортирована из каждой фазы. Список справочный: выбор уровня или просмотр фазы не отмечает её достижение.</p>
      <div className="table-scroll"><table><caption>Фазы проекта</caption><thead><tr><th scope="col">Фаза</th><th scope="col">Последний уровень HUB</th></tr></thead><tbody>{catalog.gamePhases?.map(phase => <tr key={phase.id}><th scope="row">{phase.name}</th><td>{phase.lastTier}</td></tr>)}</tbody></table></div>
    </details>
  </details>;
}
