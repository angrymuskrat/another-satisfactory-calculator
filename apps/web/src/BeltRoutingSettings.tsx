import { useId } from 'react';
import type { BeltRoutingSettings as RoutingSettings, Plan } from '../../../packages/domain/types';

export function BeltRoutingSettings({ plan, setPlan }: { plan: Plan; setPlan: (plan: Plan) => void }) {
  const id = useId();
  const routing: RoutingSettings = plan.settings.beltRouting ?? { enabled: false, maxDepth: 4 };
  const update = (patch: Partial<RoutingSettings>) => setPlan({ ...plan, settings: { ...plan.settings, beltRouting: { ...routing, ...patch } } });
  return <section className="panel" aria-labelledby={`${id}-title`}>
    <h2 id={`${id}-title`}>Распределение конвейеров</h2>
    <div className="advanced-grid">
      <label className="inline-check"><input type="checkbox" checked={routing.enabled} onChange={event => update({ enabled: event.target.checked })} />Учитывать схемы разделителей и соединителей</label>
      <label><span className="field-label">Максимальная глубина</span><select value={routing.maxDepth} disabled={!routing.enabled} aria-describedby={`${id}-depth`} onChange={event => update({ maxDepth: Number(event.target.value) as RoutingSettings['maxDepth'] })}>
        {[1, 2, 3, 4].map(depth => <option key={depth} value={depth}>{depth}</option>)}
      </select></label>
    </div>
    <p className="hint" id={`${id}-depth`}>Число разделителей и соединителей на самом длинном пути. Обычные ленты глубину не увеличивают.</p>
    <p className="hint">{routing.enabled ? 'Разделители делят поток поровну на два или три выхода, соединители складывают потоки. Ограничение относится к предметам на конвейерах; жидкости и газы рассчитываются отдельно.' : 'Учёт выключен: расчёт допускает произвольные доли потоков. Запомненная глубина не влияет на результат.'}</p>
  </section>;
}
