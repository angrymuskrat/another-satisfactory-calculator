import type { Plan } from '../../../packages/domain/types';
import { NumberField } from './controls';
import { useT } from './i18n';

export function VariantSettings({ plan, setPlan }: { plan: Plan; setPlan: (plan: Plan) => void }) {
  const t = useT();
  const options = plan.settings.variantOptions ?? { outputLoss: 10, extraMachines: 0 };
  const update = (patch: Partial<typeof options>) => setPlan({ ...plan, settings: { ...plan.settings, variantOptions: { ...options, ...patch } } });
  return <section className="panel variant-settings" aria-labelledby="variant-settings-title">
    <h2 id="variant-settings-title">{t.variantSettings.title}</h2>
    <p>{t.variantSettings.intro}</p>
    <div className="advanced-grid">
      <label><span className="field-label">{t.variantSettings.outputLoss}</span><NumberField label={t.variantSettings.outputLoss} value={options.outputLoss} max={99} suffix="%" disabled={plan.mode !== 'maximize' || !!plan.batch} onChange={outputLoss => update({ outputLoss })} /></label>
      <label><span className="field-label">{t.variantSettings.extraSaving}</span><NumberField label={t.variantSettings.extraSaving} value={options.extraMachines} max={1000} step={1} onChange={extraMachines => update({ extraMachines })} /></label>
      <label><span className="field-label">{t.variantSettings.extraSimple}</span><NumberField label={t.variantSettings.extraSimple} value={options.simplerExtraPercent ?? 10} max={1000} step={1} suffix="%" onChange={simplerExtraPercent => update({ simplerExtraPercent })} /></label>
    </div>
    <p className="hint">{plan.mode === 'maximize' && !plan.batch ? t.variantSettings.lossHint : t.variantSettings.fixedHint} {t.variantSettings.budgetHint}</p>
  </section>;
}
