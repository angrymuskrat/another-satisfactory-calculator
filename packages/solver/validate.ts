import type { Catalog, Plan, Result } from '../domain/types';
import { effectivePlan } from '../domain/availability';
import { productionConfigurations, wellConfiguration } from '../domain/production';
import { applyBatch } from '../domain/batch';
/** Recomputes conservation from catalog coefficients, independent of LP serialization. */
export function validateResult(catalog: Catalog, plan: Plan, result: Result) {
  const errors: string[] = [];
  try { plan = effectivePlan(catalog, applyBatch(plan)); } catch (error) { return { maxBalanceError: Infinity, errors: [error instanceof Error ? error.message : 'Недоступные технологии мира.'] }; }
  const counts = new Map<string, number>();
  const count = (id: string, amount: number) => counts.set(id, (counts.get(id) ?? 0) + amount);
  const close = (actual: number, expected: number) => Number.isFinite(actual) && Math.abs(actual - expected) <= 1e-6 + Math.abs(expected) * 1e-8;
  const beltRate = catalog.belts.find(b => b.id === plan.settings.beltId)?.rate ?? 0;
  const pipeRate = catalog.pipes.find(p => p.id === plan.settings.pipeId)?.rate ?? 0;
  const exponent = Math.log2(2.5);
  let configurations: ReturnType<typeof productionConfigurations>;
  try { configurations = productionConfigurations(catalog, plan); } catch (error) { return { maxBalanceError: Infinity, errors: [String(error)] }; }
  let somersloops = 0;
  let productionPower = 0; let extractionPower = 0; let installedPower = 0;
  const seenRecipes = new Set<string>(); const seenSources = new Set<string>();
  const balances = new Map(catalog.items.map(i => [i.id, 0]));
  const magnitude = new Map(catalog.items.map(i => [i.id, 0]));
  const bump = (id: string, rate: number) => {
    balances.set(id, (balances.get(id) ?? 0) + rate);
    magnitude.set(id, (magnitude.get(id) ?? 0) + Math.abs(rate));
  };
  for (const step of result.steps) {
    const configuration = configurations.find(c => c.id === (step.configurationId ?? step.recipeId) && c.recipe.id === step.recipeId);
    if (!configuration) { errors.push('Недопустимая конфигурация производства.'); continue; }
    const clock = configuration.clock / 100, boost = configuration.boost;
    const recipe = catalog.recipes.find(r => r.id === step.recipeId);
    if (!recipe || !plan.settings.enabledRecipeIds.includes(step.recipeId) || !plan.settings.enabledBuildingIds.includes(recipe.buildingId)) { errors.push('Использован недоступный рецепт.'); continue; }
    if (seenRecipes.has(configuration.id)) errors.push('Конфигурация повторяется в результате.');
    seenRecipes.add(configuration.id);
    if (!Number.isFinite(step.cycles) || step.cycles < -1e-7) errors.push('Некорректная загрузка рецепта.');
    const building = catalog.buildings.find(b => b.id === recipe.buildingId)!;
    const activeRate = 60 / recipe.seconds * clock;
    const power = (recipe.power ?? building.power) * clock ** exponent * boost ** 2 * step.cycles / activeRate;
    let capacity = activeRate;
    for (const ingredient of [...recipe.inputs, ...recipe.outputs.map(i => ({ ...i, amount: i.amount * boost }))]) capacity = Math.min(capacity, (catalog.items.find(i => i.id === ingredient.itemId)?.fluid ? pipeRate : beltRate) / ingredient.amount);
    const machines = step.cycles / capacity;
    const physical = configuration.existing || Math.max(1, Math.ceil(machines - 1e-7));
    if (machines > physical + 1e-7) errors.push('Превышена мощность существующей линии.');
    if (configuration.duty !== null && !close(step.cycles, configuration.existing * activeRate * configuration.duty)) errors.push('Изменена закреплённая линия.');
    somersloops += physical * configuration.somersloops;
    count(recipe.buildingId, physical);
    const peak = physical * (recipe.powerMax ?? building.powerMax ?? recipe.power ?? building.power) * clock ** exponent * boost ** 2;
    if (!close(step.power, power) || !close(step.powerMax, peak)) errors.push('Неверная мощность этапа.');
    if (!close(step.machines, machines) || step.installedMachines !== physical) errors.push('Недостаточно машин для потока.');
    productionPower += power; installedPower += peak;
    for (const i of recipe.inputs) bump(i.itemId, -i.amount * step.cycles);
    for (const i of recipe.outputs) bump(i.itemId, i.amount * boost * step.cycles);
    for (const [shown, expected] of [[step.inputs, recipe.inputs], [step.outputs, recipe.outputs.map(i => ({ ...i, amount: i.amount * boost }))]] as const) {
      if (shown.length !== expected.length || shown.some((f, i) => f.itemId !== expected[i]?.itemId || !close(f.rate, expected[i].amount * step.cycles))) errors.push('Подменены потоки этапа.');
    }
  }
  if (configurations.some(c => c.existing > 0 && !seenRecipes.has(c.id))) errors.push('Пропущена существующая линия.');
  if (somersloops > (plan.somersloopBudget ?? 0) || (result.somersloops ?? 0) !== somersloops) errors.push('Нарушен бюджет усилителей.');
  for (const source of result.resources) {
    if (seenSources.has(source.sourceId)) errors.push('Источник повторяется в результате.');
    seenSources.add(source.sourceId);
    bump(source.itemId, source.rate);
    const original = plan.sources.find(s => s.id === source.sourceId);
    let limit: number | null = null; let sourcePower = 0;
    if (original) {
      if (original.itemId !== source.itemId) errors.push('Подменён ресурс источника.');
      limit = original.limit;
      if (original.kind === 'flow') { sourcePower = source.rate * (original.importPower ?? 0); installedPower += sourcePower; }
      if (original.kind === 'well') {
        try {
          const well = wellConfiguration(catalog, plan, original);
          limit = limit === null ? well.capacity : Math.min(limit, well.capacity);
          const physical = source.rate > 1e-12 ? 1 : 0;
          if (source.installedMachines !== physical) errors.push('Неверное число компенсаторов скважины.');
          sourcePower = physical * well.power; installedPower += sourcePower; count('resource-well-pressurizer', physical);
        } catch { errors.push('Недопустимая скважина.'); }
      }
      if (original.kind === 'node') {
        const miner = catalog.miners.find(m => m.id === original.minerId);
        if (!miner || !miner.resourceIds.includes(original.itemId)) { errors.push('Недопустимое месторождение.'); continue; }
        const nominalRate = miner.rate * original.purity * original.clock / 100;
        const maximum = Math.min(nominalRate, catalog.items.find(i => i.id === original.itemId)?.fluid ? pipeRate : beltRate) * original.count;
        limit = limit === null ? maximum : Math.min(maximum, limit);
        const activePower = miner.power * (original.clock / 100) ** exponent;
        sourcePower = source.rate / nominalRate * activePower;
        const physical = source.rate > 1e-12 ? Math.max(1, Math.ceil(source.rate / (maximum / original.count) - 1e-7)) : 0;
        if (source.installedMachines !== undefined && source.installedMachines !== physical) errors.push('Неверное количество добытчиков.');
        count(original.minerId, physical); installedPower += physical * activePower;
      }
      if (limit === null && (original.reserve ?? 0) > 0) errors.push('Резерв требует конечного источника.');
      if (limit !== null) limit = Math.max(0, limit - (original.reserve ?? 0));
    } else if (plan.settings.resourcePolicy !== 'unlimited-unlisted' || plan.sources.some(s => s.itemId === source.itemId)
      || !catalog.items.find(i => i.id === source.itemId)?.raw || source.sourceId !== `implicit:${source.itemId}`) errors.push('Не разрешён внешний источник.');
    if (source.limit === null ? limit !== null : limit === null || !close(source.limit, limit)) errors.push('Неверный лимит в результате.');
    if (!Number.isFinite(source.rate) || source.rate < -1e-6 || (limit !== null && source.rate > limit + 1e-6 + limit * 1e-8)) errors.push('Превышен ресурсный лимит.');
    if (!close(source.power, sourcePower)) errors.push('Неверная мощность добычи.');
    extractionPower += sourcePower;
  }
  const productIds = new Set<string>();
  for (const p of result.products) {
    if (productIds.has(p.itemId) || !plan.targets.some(t => t.itemId === p.itemId) || !Number.isFinite(p.rate) || p.rate < -1e-7) errors.push('Некорректная отгрузка.');
    productIds.add(p.itemId); bump(p.itemId, -p.rate);
  }
  if (productIds.size !== plan.targets.length) errors.push('В результате отсутствует продукт.');
  const exportIds = new Set<string>();
  for (const flow of result.exports ?? []) {
    const allowed = plan.exports?.find(e => e.itemId === flow.itemId);
    if (exportIds.has(flow.itemId) || !allowed || !Number.isFinite(flow.rate) || flow.rate < 0 || flow.rate > allowed.limit + 1e-7) errors.push('Недопустимая отгрузка побочного продукта.');
    exportIds.add(flow.itemId); bump(flow.itemId, -flow.rate);
  }
  let sinkRate = 0;
  for (const p of result.surplus) {
    bump(p.itemId, -p.rate);
    const item = catalog.items.find(i => i.id === p.itemId);
    if (!plan.settings.allowSink || !plan.settings.enabledBuildingIds.includes('awesome-sink') || !item?.sinkable || item.fluid || !Number.isFinite(p.rate) || p.rate < 0) errors.push('Недопустимая утилизация.');
    sinkRate += p.rate;
  }
  const sinkPower = catalog.buildings.find(b => b.id === 'awesome-sink')?.power ?? 30;
  const sinks = Math.round(result.sinkPower / sinkPower);
  count('awesome-sink', sinks);
  if (sinkRate > 0 && sinks === 0) errors.push('Поток утилизации требует физического утилизатора.');
  if (sinks < 0 || !close(result.sinkPower, sinks * sinkPower) || sinkRate > sinks * beltRate + 1e-5) errors.push('Недостаточно утилизаторов.');
  const totalPower = productionPower + extractionPower + sinks * sinkPower;
  if (!close(result.productionPower, productionPower) || !close(result.extractionPower, extractionPower) || !close(result.power, totalPower)
    || !close(result.installedPower, installedPower + sinks * sinkPower)) errors.push('Неверная итоговая мощность.');
  let maxBalanceError = 0;
  for (const [id, value] of balances) {
    maxBalanceError = Math.max(maxBalanceError, Math.abs(value));
    if (!Number.isFinite(value) || Math.abs(value) > 1e-6 + (magnitude.get(id) ?? 0) * 1e-8) errors.push(`Нарушен баланс ${id}.`);
  }
  if (plan.mode === 'target') for (const target of plan.targets) {
    const output = result.products.find(p => p.itemId === target.itemId)?.rate ?? 0;
    if (Math.abs(output - target.rate) > Math.min(1e-6 + target.rate * 1e-8, target.rate * 1e-6)) errors.push('Заказ не выполнен.');
  }
  for (const target of plan.targets) {
    const output = result.products.find(p => p.itemId === target.itemId)?.rate ?? 0;
    const minimum = target.minRate ?? 0;
    if (output < minimum - Math.min(1e-6 + minimum * 1e-8, minimum * 1e-6)) errors.push('Не выполнен минимум продукта.');
    if (target.maxRate === 0 && output > 0) errors.push('Запрещён выпуск продукта.');
    if (target.maxRate != null && output > target.maxRate + 1e-6 + target.maxRate * 1e-8) errors.push('Превышен максимум продукта.');
  }
  if (plan.mode === 'maximize' && plan.policy === 'proportional') {
    const largest = plan.targets.reduce((a, b) => a.rate >= b.rate ? a : b);
    const output = result.products.find(p => p.itemId === largest.itemId)?.rate ?? 0;
    for (const target of plan.targets) if (!close(result.products.find(p => p.itemId === target.itemId)?.rate ?? 0, output * target.rate / largest.rate)) errors.push('Нарушена пропорция продуктов.');
  }
  if (plan.settings.powerLimit !== null && totalPower > plan.settings.powerLimit + 1e-6 + plan.settings.powerLimit * 1e-8) errors.push('Превышен лимит мощности.');
  const peakLimit = plan.settings.peakPowerLimit;
  if (peakLimit != null && installedPower + sinks * sinkPower + (plan.settings.powerReserve ?? 0) > peakLimit + 1e-6 + peakLimit * 1e-8) errors.push('Превышен лимит максимальной нагрузки с резервом.');
  for (const [id, limit] of Object.entries(plan.settings.buildingLimits ?? {})) if ((counts.get(id) ?? 0) > limit) errors.push(`Превышен лимит зданий ${id}.`);
  return { maxBalanceError, errors };
}
