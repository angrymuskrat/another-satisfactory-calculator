import { useId } from 'react';
import type { BeltRoutingSettings as RoutingSettings, Plan } from '../../../packages/domain/types';
import { useT } from './i18n';

export function BeltRoutingSettings({ plan, setPlan }: { plan: Plan; setPlan: (plan: Plan) => void }) {
  const t = useT();
  const id = useId();
  const routing: RoutingSettings = plan.settings.beltRouting ?? { enabled: false, maxDepth: 4 };
  const update = (patch: Partial<RoutingSettings>) => setPlan({ ...plan, settings: { ...plan.settings, beltRouting: { ...routing, ...patch } } });
  return <section className="panel" aria-labelledby={`${id}-title`}>
    <h2 id={`${id}-title`}>{t.beltRoutingSettings.title}</h2>
    <div className="advanced-grid">
      <label className="inline-check"><input type="checkbox" checked={routing.enabled} onChange={event => update({ enabled: event.target.checked })} />{t.beltRoutingSettings.enable}</label>
      <label><span className="field-label">{t.beltRoutingSettings.maxDepth}</span><select value={routing.maxDepth} disabled={!routing.enabled} aria-describedby={`${id}-depth`} onChange={event => update({ maxDepth: Number(event.target.value) as RoutingSettings['maxDepth'] })}>
        {[1, 2, 3, 4].map(depth => <option key={depth} value={depth}>{depth}</option>)}
      </select></label>
    </div>
    <p className="hint" id={`${id}-depth`}>{t.beltRoutingSettings.depthHint}</p>
    <p className="hint">{routing.enabled ? t.beltRoutingSettings.onHint : t.beltRoutingSettings.offHint}</p>
  </section>;
}
