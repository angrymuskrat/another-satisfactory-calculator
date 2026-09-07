import type { Catalog, Plan, Source } from '../../../packages/domain/types';
import { NumberField } from './controls';

interface Props {
  catalog: Catalog;
  plan: Plan;
  source: Source;
  update: (patch: Partial<Source>) => void;
}

export function SharedSourceControl({ catalog, plan, source, update }: Props) {
  if (!plan.world) return null;
  const nodes = plan.world.resourceNodes ?? [];
  const selected = nodes.find(node => node.id === source.sharedNodeId);
  return <div className="full-width">
    <label><span className="field-label">Общий конечный узел мира</span>
      <select aria-label={`Общий узел источника ${source.id}`} value={source.sharedNodeId ?? ''} onChange={event => {
        const node = nodes.find(candidate => candidate.id === event.target.value);
        if (!node) { update({ sharedNodeId: undefined }); return; }
        update({ sharedNodeId: node.id, itemId: node.itemId, kind: 'flow', well: undefined, limit: Math.min(source.limit ?? node.limit, node.limit) });
      }}>
        <option value="">Не распределён из мира</option>
        {nodes.map(node => <option key={node.id} value={node.id}>{node.name} · {catalog.items.find(item => item.id === node.itemId)?.name ?? node.itemId} · {node.limit}/мин</option>)}
      </select>
    </label>
    {selected && <><label><span className="field-label">Квота этой фабрики, в минуту</span>
      <NumberField label={`Квота общего узла ${source.id}`} value={source.limit ?? selected.limit} max={selected.limit} onChange={limit => update({ limit })} />
    </label><p className="hint">Лимит узла: {selected.limit}/мин. При сохранении рабочего пространства проверяется сумма квот всех фабрик этого мира. Энергия доставки задаётся отдельно как известная величина или остаётся неизвестной.</p></>}
    {!nodes.length && <p className="hint">В связанном мире пока нет общих конечных узлов.</p>}
  </div>;
}
