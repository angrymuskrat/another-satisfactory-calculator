import type { Plan } from '../../../packages/domain/types';
import { NumberField } from './controls';

export function VariantSettings({ plan, setPlan }: { plan: Plan; setPlan: (plan: Plan) => void }) {
  const options = plan.settings.variantOptions ?? { outputLoss: 10, extraMachines: 0 };
  const update = (patch: Partial<typeof options>) => setPlan({ ...plan, settings: { ...plan.settings, variantOptions: { ...options, ...patch } } });
  return <section className="panel variant-settings" aria-labelledby="variant-settings-title">
    <h2 id="variant-settings-title">Подбор вариантов</h2>
    <p>После расчёта выберите один из вариантов: максимальный выпуск, экономию энергии, экономию редкого сырья или более простую постройку. Все варианты подбирают рабочие частоты.</p>
    <div className="advanced-grid">
      <label><span className="field-label">Потеря выпуска для экономичных вариантов</span><NumberField label="Потеря выпуска для экономичных вариантов" value={options.outputLoss} max={99} suffix="%" disabled={plan.mode !== 'maximize' || !!plan.batch} onChange={outputLoss => update({ outputLoss })} /></label>
      <label><span className="field-label">Дополнительные машины для экономии</span><NumberField label="Дополнительные машины для экономии" value={options.extraMachines} max={1000} step={1} onChange={extraMachines => update({ extraMachines })} /></label>
      <label><span className="field-label">Дополнительные машины для простоты</span><NumberField label="Дополнительные машины для простоты" value={options.simplerExtraPercent ?? 10} max={1000} step={1} suffix="%" onChange={simplerExtraPercent => update({ simplerExtraPercent })} /></label>
    </div>
    <p className="hint">{plan.mode === 'maximize' && !plan.batch ? 'Потеря применяется ко всем вариантам, кроме максимального. Минимумы продуктов остаются обязательными. При взвешенном выпуске процент относится к общей взвешенной цели, не к каждому продукту; при приоритетах — к каждой последовательной цели.' : 'Заданный выпуск и остаток партии сохраняются полностью во всех вариантах.'} Бюджет машин — минимум для соответствующего выпуска плюс разрешённые дополнительные машины, включая добычу и утилизацию. Для простоты бюджет — минимум машин плюс заданный процент (округление вверх); внутри него сначала уменьшается число разных рецептов. Больше медленных машин может уменьшить потребление энергии.</p>
  </section>;
}
