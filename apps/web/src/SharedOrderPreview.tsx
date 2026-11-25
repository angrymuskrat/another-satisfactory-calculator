import { useEffect, useState } from 'react';
import { ArrowLeft, Settings2 } from 'lucide-react';
import { applyBatch } from '../../../packages/domain/batch';
import { sourceCapacity } from '../../../packages/domain/sourceCapacity';
import type { Catalog, Plan } from '../../../packages/domain/types';
import { ConstraintSummary } from './ConstraintSummary';
import { OrderCalculation } from './QuickOrder';
import { format, unit } from './controls';
import { readOrderLink } from './orderLink';
import './sharedOrderPreview.css';

interface Props {
  catalog: Catalog;
  hash: string;
  onAdvanced: (plan: Plan) => void;
  onClose: () => void;
}

export function SharedOrderPreview({ catalog, hash, onAdvanced, onClose }: Props) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    readOrderLink(hash, catalog).then(next => {
      if (current) setPlan(next);
    }, cause => {
      if (current) setError(cause instanceof Error ? cause.message : 'Не удалось открыть заказ.');
    });
    return () => { current = false; };
  }, [hash, catalog]);
  const order = plan && applyBatch(plan);
  return <main className="shared-order-page">
    <button type="button" className="secondary-button" onClick={onClose}><ArrowLeft size={16} />Вернуться к своей фабрике</button>
    <header><p>Заказ по ссылке</p><h1>{plan?.name ?? 'Просмотр заказа'}</h1></header>
    {error ? <p role="alert" className="alert error">{error}</p> : !plan || !order ? <p role="status">Открываем заказ…</p> : <>
      <section className="panel shared-order-settings">
        <div className="shared-order-title"><h2>Параметры заказа</h2><button className="secondary-button" type="button" onClick={() => onAdvanced(plan)}><Settings2 size={16} />Расширенные настройки</button></div>
        <ul>{order.targets.map(target => {
          const item = catalog.items.find(i => i.id === target.itemId);
          return <li key={target.itemId}>{item?.name} · {order.mode === 'target' ? `${format(target.rate, 6)} ${unit(item)}` : 'максимальный выпуск'}</li>;
        })}</ul>
        <p>{plan.settings.resourcePolicy === 'listed-only' ? 'Доступны только заданные источники.' : 'Неуказанное первичное сырьё доступно без ограничения.'}</p>
        {!!(plan.sources.length || Object.keys(plan.settings.inputLimits ?? {}).length) && <details><summary>Лимиты сырья</summary><ul>
          {plan.sources.map(source => {
            const item = catalog.items.find(i => i.id === source.itemId);
            const { limit } = sourceCapacity(catalog, plan, source);
            return <li key={source.id}>{item?.name}{source.name ? ` (${source.name})` : ''} · {limit === null ? 'без лимита' : `${format(limit, 6)} ${unit(item)}`}</li>;
          })}
          {Object.entries(plan.settings.inputLimits ?? {}).map(([id, limit]) => {
            const item = catalog.items.find(i => i.id === id);
            return <li key={`cap-${id}`}>{item?.name} · {limit === null ? 'без суммарного лимита' : `суммарно до ${format(limit, 6)} ${unit(item)}`}</li>;
          })}
        </ul></details>}
        <ConstraintSummary catalog={catalog} plan={plan} />
        <small>Версия каталога · {plan.catalogVersion}</small>
      </section>
      <OrderCalculation catalog={catalog} plan={plan} />
    </>}
  </main>;
}
