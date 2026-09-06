import type { Catalog, Plan, Result } from '../domain/types';
/** Recomputes conservation from catalog coefficients, independent of LP serialization. */
export function validateResult(catalog: Catalog, plan: Plan, result: Result) {
  const errors: string[] = [];
  const close = (actual: number, expected: number) => Number.isFinite(actual) && Math.abs(actual - expected) <= 1e-6 + Math.abs(expected) * 1e-8;
  const beltRate = catalog.belts.find(b => b.id === plan.settings.beltId)?.rate ?? 0;
  const pipeRate = catalog.pipes.find(p => p.id === plan.settings.pipeId)?.rate ?? 0;
  const exponent = Math.log2(2.5);
  const clock = plan.settings.clock / 100;
  let productionPower = 0; let extractionPower = 0; let installedPower = 0;
  const seenRecipes = new Set<string>(); const seenSources = new Set<string>();
  const balances = new Map(catalog.items.map(i => [i.id, 0]));
  const magnitude = new Map(catalog.items.map(i => [i.id, 0]));
  const bump = (id: string, rate: number) => {
    balances.set(id, (balances.get(id) ?? 0) + rate);
    magnitude.set(id, (magnitude.get(id) ?? 0) + Math.abs(rate));
  };
  for (const step of result.steps) {
    const recipe = catalog.recipes.find(r => r.id === step.recipeId);
    if (!recipe || !plan.settings.enabledRecipeIds.includes(step.recipeId) || !plan.settings.enabledBuildingIds.includes(recipe.buildingId)) { errors.push('Использован недоступный рецепт.'); continue; }
    if (seenRecipes.has(step.recipeId)) errors.push('Рецепт повторяется в результате.');
    seenRecipes.add(step.recipeId);
    if (!Number.isFinite(step.cycles) || step.cycles < -1e-7) errors.push('Некорректная загрузка рецепта.');
    const building = catalog.buildings.find(b => b.id === recipe.buildingId)!;
    const activeRate = 60 / recipe.seconds * clock;
    const power = (recipe.power ?? building.power) * clock ** exponent * step.cycles / activeRate;
    let capacity = activeRate;
    for (const ingredient of [...recipe.inputs, ...recipe.outputs]) capacity = Math.min(capacity, (catalog.items.find(i => i.id === ingredient.itemId)?.fluid ? pipeRate : beltRate) / ingredient.amount);
    const machines = step.cycles / capacity;
    const physical = Math.max(1, Math.ceil(machines - 1e-7));
    const peak = physical * (recipe.powerMax ?? building.powerMax ?? recipe.power ?? building.power) * clock ** exponent;
    if (!close(step.power, power) || !close(step.powerMax, peak)) errors.push('Неверная мощность этапа.');
    if (!close(step.machines, machines) || step.installedMachines !== physical) errors.push('Недостаточно машин для потока.');
    productionPower += power; installedPower += peak;
    for (const i of recipe.inputs) bump(i.itemId, -i.amount * step.cycles);
    for (const i of recipe.outputs) bump(i.itemId, i.amount * step.cycles);
  }
  for (const source of result.resources) {
    if (seenSources.has(source.sourceId)) errors.push('Источник повторяется в результате.');
    seenSources.add(source.sourceId);
    bump(source.itemId, source.rate);
    const original = plan.sources.find(s => s.id === source.sourceId);
    let limit: number | null = null; let sourcePower = 0;
    if (original) {
      if (original.itemId !== source.itemId) errors.push('Подменён ресурс источника.');
      limit = original.limit;
      if (original.kind === 'node') {
        const miner = catalog.miners.find(m => m.id === original.minerId);
        if (!miner || !miner.resourceIds.includes(original.itemId)) { errors.push('Недопустимое месторождение.'); continue; }
        const nominalRate = miner.rate * original.purity * original.clock / 100;
        const maximum = Math.min(nominalRate, catalog.items.find(i => i.id === original.itemId)?.fluid ? pipeRate : beltRate) * original.count;
        limit = limit === null ? maximum : Math.min(maximum, limit);
        const activePower = miner.power * (original.clock / 100) ** exponent;
        sourcePower = source.rate / nominalRate * activePower;
        if (source.rate > 1e-12) installedPower += original.count * activePower;
      }
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
  let sinkRate = 0;
  for (const p of result.surplus) {
    bump(p.itemId, -p.rate);
    const item = catalog.items.find(i => i.id === p.itemId);
    if (!plan.settings.allowSink || !plan.settings.enabledBuildingIds.includes('awesome-sink') || !item?.sinkable || item.fluid || !Number.isFinite(p.rate) || p.rate < 0) errors.push('Недопустимая утилизация.');
    sinkRate += p.rate;
  }
  const sinkPower = catalog.buildings.find(b => b.id === 'awesome-sink')?.power ?? 30;
  const sinks = Math.round(result.sinkPower / sinkPower);
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
    if (Math.abs(output - target.rate) > 1e-6 + target.rate * 1e-8) errors.push('Заказ не выполнен.');
  }
  if (plan.mode === 'maximize' && plan.policy === 'proportional') {
    const largest = plan.targets.reduce((a, b) => a.rate >= b.rate ? a : b);
    const output = result.products.find(p => p.itemId === largest.itemId)?.rate ?? 0;
    for (const target of plan.targets) if (!close(result.products.find(p => p.itemId === target.itemId)?.rate ?? 0, output * target.rate / largest.rate)) errors.push('Нарушена пропорция продуктов.');
  }
  if (plan.settings.powerLimit !== null && totalPower > plan.settings.powerLimit + 1e-6 + plan.settings.powerLimit * 1e-8) errors.push('Превышен лимит мощности.');
  return { maxBalanceError, errors };
}
