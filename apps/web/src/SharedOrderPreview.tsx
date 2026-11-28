import { useEffect, useState } from 'react';
import { ArrowLeft, Settings2 } from 'lucide-react';
import { applyBatch } from '../../../packages/domain/batch';
import { sourceCapacity } from '../../../packages/domain/sourceCapacity';
import type { Catalog, Plan } from '../../../packages/domain/types';
import { ConstraintSummary } from './ConstraintSummary';
import { OrderCalculation } from './QuickOrder';
import { format, unit } from './controls';
import { gameName } from './i18n/gameNames';
import { useT } from './i18n';
import { readOrderLink } from './orderLink';
import './sharedOrderPreview.css';

interface Props {
  catalog: Catalog;
  hash: string;
  onAdvanced: (plan: Plan) => void;
  onClose: () => void;
}

export function SharedOrderPreview({ catalog, hash, onAdvanced, onClose }: Props) {
  const t = useT();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    readOrderLink(hash, catalog, t).then(next => {
      if (current) setPlan(next);
    }, cause => {
      if (current) setError(cause instanceof Error ? cause.message : t.sharedOrderPreview.openFailed);
    });
    return () => { current = false; };
  }, [hash, catalog, t]);
  const order = plan && applyBatch(plan);
  return <main className="shared-order-page">
    <button type="button" className="secondary-button" onClick={onClose}><ArrowLeft size={16} />{t.sharedOrderPreview.backToFactory}</button>
    <header><p>{t.sharedOrderPreview.eyebrow}</p><h1>{plan?.name ?? t.sharedOrderPreview.fallbackTitle}</h1></header>
    {error ? <p role="alert" className="alert error">{error}</p> : !plan || !order ? <p role="status">{t.sharedOrderPreview.opening}</p> : <>
      <section className="panel shared-order-settings">
        <div className="shared-order-title"><h2>{t.sharedOrderPreview.settingsTitle}</h2><button className="secondary-button" type="button" onClick={() => onAdvanced(plan)}><Settings2 size={16} />{t.sharedOrderPreview.advancedSettings}</button></div>
        <ul>{order.targets.map(target => {
          const item = catalog.items.find(i => i.id === target.itemId);
          return <li key={target.itemId}>{item && gameName('item', item.id, item.name)} · {order.mode === 'target' ? `${format(target.rate, 6)} ${unit(item)}` : t.sharedOrderPreview.maxOutput}</li>;
        })}</ul>
        <p>{plan.settings.resourcePolicy === 'listed-only' ? t.sharedOrderPreview.listedOnly : t.sharedOrderPreview.unlistedUnlimited}</p>
        {!!(plan.sources.length || Object.keys(plan.settings.inputLimits ?? {}).length) && <details><summary>{t.sharedOrderPreview.rawLimits}</summary><ul>
          {plan.sources.map(source => {
            const item = catalog.items.find(i => i.id === source.itemId);
            const { limit } = sourceCapacity(catalog, plan, source);
            return <li key={source.id}>{item && gameName('item', item.id, item.name)}{source.name ? ` (${source.name})` : ''} · {limit === null ? t.sharedOrderPreview.noLimit : `${format(limit, 6)} ${unit(item)}`}</li>;
          })}
          {Object.entries(plan.settings.inputLimits ?? {}).map(([id, limit]) => {
            const item = catalog.items.find(i => i.id === id);
            return <li key={`cap-${id}`}>{item && gameName('item', item.id, item.name)} · {limit === null ? t.sharedOrderPreview.noTotalLimit : t.sharedOrderPreview.totalUpTo(format(limit, 6), unit(item))}</li>;
          })}
        </ul></details>}
        <ConstraintSummary catalog={catalog} plan={plan} />
        <small>{t.sharedOrderPreview.catalogVersion(plan.catalogVersion)}</small>
      </section>
      <OrderCalculation catalog={catalog} plan={plan} />
    </>}
  </main>;
}
