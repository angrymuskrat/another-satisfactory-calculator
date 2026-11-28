import type { Catalog, Plan, Source } from '../../../packages/domain/types';
import { NumberField } from './controls';
import { useT } from './i18n';
import { gameName } from './i18n/gameNames';

interface Props {
  catalog: Catalog;
  plan: Plan;
  source: Source;
  update: (patch: Partial<Source>) => void;
}

export function SharedSourceControl({ catalog, plan, source, update }: Props) {
  const t = useT();
  if (!plan.world) return null;
  const nodes = plan.world.resourceNodes ?? [];
  const selected = nodes.find(node => node.id === source.sharedNodeId);
  return <div className="full-width">
    <label><span className="field-label">{t.sharedResources.nodeLabel}</span>
      <select aria-label={t.sharedResources.nodeSelectOf(source.id)} value={source.sharedNodeId ?? ''} onChange={event => {
        const node = nodes.find(candidate => candidate.id === event.target.value);
        if (!node) { update({ sharedNodeId: undefined }); return; }
        update({ sharedNodeId: node.id, itemId: node.itemId, kind: 'flow', well: undefined, limit: Math.min(source.limit ?? node.limit, node.limit) });
      }}>
        <option value="">{t.sharedResources.notAllocated}</option>
        {nodes.map(node => { const item = catalog.items.find(candidate => candidate.id === node.itemId); return <option key={node.id} value={node.id}>{t.sharedResources.nodeOption(node.name, item ? gameName('item', item.id, item.name) : node.itemId, node.limit)}</option>; })}
      </select>
    </label>
    {selected && <><label><span className="field-label">{t.sharedResources.quotaLabel}</span>
      <NumberField label={t.sharedResources.quotaOf(source.id)} value={source.limit ?? selected.limit} max={selected.limit} onChange={limit => update({ limit })} />
    </label><p className="hint">{t.sharedResources.nodeLimitHint(selected.limit)}</p></>}
    {!nodes.length && <p className="hint">{t.sharedResources.noNodes}</p>}
  </div>;
}
