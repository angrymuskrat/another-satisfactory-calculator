import type { Catalog, Plan, Recipe, Source } from '../domain/types';
import { add, Model, type Expression } from './model';
const EXPONENT = Math.log2(2.5);
export interface RecipeVariable { recipe: Recipe; variable: string; countVariable: string | null; capacity: number; cyclesAtClock: number; power: number; powerMax: number; powerPerCycle: number }
export interface SourceVariable { source: Source; variable: string; countVariable: string | null; capacity: number; limit: number | null; powerPerUnit: number; installedPower: number }

export function buildModel(catalog: Catalog, plan: Plan) {
  const model = new Model();
  const power: Expression = new Map(); const resources: Expression = new Map(); const activity: Expression = new Map();
  const peakPower: Expression = new Map(); const machineCount: Expression = new Map();
  const countsByBuilding = new Map<string, Expression>();
  const needsCounts = plan.settings.objective === 'buildings' || plan.settings.peakPowerLimit != null || Object.keys(plan.settings.buildingLimits ?? {}).length > 0;
  const countFor = (id: string, upper: number | null = null) => {
    const variable = model.variable(upper, true);
    add(machineCount, variable, 1);
    const counts = countsByBuilding.get(id) ?? new Map(); add(counts, variable, 1); countsByBuilding.set(id, counts);
    return variable;
  };
  const balance = new Map(catalog.items.map(i => [i.id, new Map<string, number>()]));
  const items = new Map(catalog.items.map(i => [i.id, i]));
  const buildings = new Map(catalog.buildings.map(b => [b.id, b]));
  const belt = catalog.belts.find(b => b.id === plan.settings.beltId);
  const pipe = catalog.pipes.find(p => p.id === plan.settings.pipeId);
  if (!belt || !pipe) throw new Error('Выбранный транспорт отсутствует в каталоге.');
  const check = (id: string) => { if (!items.has(id)) throw new Error(`Предмет ${id} отсутствует в каталоге.`); };
  plan.targets.forEach(t => check(t.itemId)); plan.sources.forEach(s => check(s.itemId));
  if (plan.catalogVersion !== catalog.version) throw new Error('Версия плана отличается от каталога. Импортируйте настройки с проверкой совместимости.');
  const knownRecipes = new Set(catalog.recipes.map(r => r.id));
  if (plan.settings.enabledRecipeIds.some(id => !knownRecipes.has(id)) || plan.settings.enabledBuildingIds.some(id => !buildings.has(id))) throw new Error('Сохранённые рецепты или здания отсутствуют в каталоге. Обновите конфигурацию.');
  const enabledRecipes = new Set(plan.settings.enabledRecipeIds);
  const enabledBuildings = new Set(plan.settings.enabledBuildingIds);
  const clock = plan.settings.clock / 100;
  const recipeVariables: RecipeVariable[] = [];
  for (const recipe of catalog.recipes) {
    if (!enabledRecipes.has(recipe.id) || !enabledBuildings.has(recipe.buildingId)) continue;
    const building = buildings.get(recipe.buildingId);
    if (!building || recipe.seconds <= 0 || recipe.outputs.length === 0) throw new Error(`Некорректный рецепт ${recipe.id}.`);
    const cyclesAtClock = 60 / recipe.seconds * clock;
    const machinePower = (recipe.power ?? building.power) * clock ** EXPONENT;
    const machineMax = (recipe.powerMax ?? building.powerMax ?? recipe.power ?? building.power) * clock ** EXPONENT;
    if (!Number.isFinite(machinePower) || machinePower < 0) throw new Error(`Неизвестная мощность рецепта ${recipe.id}.`);
    let capacity = cyclesAtClock;
    const variable = model.variable();
    for (const [sign, ingredients] of [[-1, recipe.inputs], [1, recipe.outputs]] as const) {
      for (const ingredient of ingredients) {
        const item = items.get(ingredient.itemId);
        if (!item || !(ingredient.amount > 0) || !Number.isFinite(ingredient.amount)) throw new Error(`Некорректный состав рецепта ${recipe.id}.`);
        add(balance.get(item.id)!, variable, sign * ingredient.amount);
        capacity = Math.min(capacity, (item.fluid ? pipe.rate : belt.rate) / ingredient.amount);
      }
    }
    const powerPerCycle = machinePower / cyclesAtClock;
    const countVariable = needsCounts ? countFor(recipe.buildingId) : null;
    if (countVariable) {
      model.constrain(new Map([[variable, 1 / capacity], [countVariable, -1]]), '<=', 0);
      add(peakPower, countVariable, machineMax);
    }
    add(power, variable, powerPerCycle); add(activity, variable, 1);
    recipeVariables.push({ recipe, variable, countVariable, capacity, cyclesAtClock, power: machinePower, powerMax: machineMax, powerPerCycle });
  }
  const allSources = [...plan.sources];
  if (plan.settings.resourcePolicy === 'unlimited-unlisted') {
    const listed = new Set(allSources.map(s => s.itemId));
    for (const item of catalog.items.filter(i => i.raw && !listed.has(i.id))) {
      allSources.push({ id: `implicit:${item.id}`, itemId: item.id, kind: 'flow', limit: null, count: 1, purity: 1, minerId: '', clock: 100 });
    }
  }
  const sourceVariables: SourceVariable[] = allSources.map(source => {
    let limit = source.limit; let powerPerUnit = 0; let installedPower = 0; let perMachineCapacity = 0;
    if (source.kind === 'node') {
      const miner = catalog.miners.find(m => m.id === source.minerId);
      if (!miner || !miner.resourceIds.includes(source.itemId)) throw new Error('Выбранный добытчик не добывает ресурс этого месторождения.');
      if (miner.id === 'water-extractor' && source.purity !== 1) throw new Error('Для водозабора чистота всегда равна 1.');
      const c = source.clock / 100;
      const rate = miner.rate * source.purity * c;
      const perNodePower = miner.power * c ** EXPONENT;
      perMachineCapacity = Math.min(rate, items.get(source.itemId)!.fluid ? pipe.rate : belt.rate);
      const capacity = perMachineCapacity * source.count;
      limit = source.limit === null ? capacity : Math.min(capacity, source.limit);
      powerPerUnit = perNodePower / rate;
      installedPower = perNodePower;
    }
    const variable = model.variable(limit);
    const countVariable = needsCounts && source.kind === 'node' ? countFor(source.minerId, source.count) : null;
    if (countVariable) {
      model.constrain(new Map([[variable, 1 / perMachineCapacity], [countVariable, -1]]), '<=', 0);
      add(peakPower, countVariable, installedPower);
    }
    add(balance.get(source.itemId)!, variable, 1);
    add(power, variable, powerPerUnit); add(resources, variable, plan.settings.resourceWeights[source.itemId] ?? 1);
    return { source, variable, countVariable, capacity: perMachineCapacity, limit, powerPerUnit, installedPower };
  });
  const targets = plan.targets.map(t => {
    const variable = model.variable(t.maxRate ?? null); add(balance.get(t.itemId)!, variable, -1);
    if ((t.minRate ?? 0) > 0) model.constrain(new Map([[variable, 1]]), '>=', t.minRate!);
    if (plan.mode === 'target') model.constrain(new Map([[variable, 1]]), '=', t.rate);
    return { target: t, variable };
  });
  let ratio: string | null = null;
  if (plan.mode === 'maximize' && plan.policy === 'proportional') {
    ratio = model.variable();
    const scale = Math.max(...plan.targets.map(t => t.rate));
    if (Math.min(...plan.targets.map(t => t.rate)) / scale < 1e-8) throw new Error('Пропорции отличаются более чем в 100 миллионов раз. Уменьшите диапазон для устойчивого расчёта.');
    for (const { target, variable } of targets) model.constrain(new Map([[variable, 1], [ratio, -target.rate / scale]]), '=', 0);
  }
  const disposal: { itemId: string; variable: string }[] = [];
  let sinkCount: string | null = null;
  const sink = buildings.get('awesome-sink');
  if (plan.settings.allowSink && enabledBuildings.has('awesome-sink') && sink) {
    sinkCount = model.variable(null, true); add(power, sinkCount, sink.power);
    add(peakPower, sinkCount, sink.power); add(machineCount, sinkCount, 1);
    countsByBuilding.set('awesome-sink', new Map([[sinkCount, 1]]));
    const throughput = new Map([[sinkCount, -belt.rate]]);
    for (const item of catalog.items.filter(i => i.sinkable && !i.fluid)) {
      const variable = model.variable(); add(balance.get(item.id)!, variable, -1); add(throughput, variable, 1);
      disposal.push({ itemId: item.id, variable });
    }
    model.constrain(throughput, '<=', 0);
  }
  for (const expression of balance.values()) model.constrain(expression, '=', 0);
  if (plan.settings.powerLimit !== null) model.constrain(power, '<=', plan.settings.powerLimit);
  if (plan.settings.peakPowerLimit != null) model.constrain(peakPower, '<=', plan.settings.peakPowerLimit - (plan.settings.powerReserve ?? 0));
  for (const [id, limit] of Object.entries(plan.settings.buildingLimits ?? {})) {
    if (!buildings.has(id) && !catalog.miners.some(m => m.id === id)) throw new Error('Тип здания для лимита отсутствует в каталоге.');
    model.constrain(countsByBuilding.get(id) ?? new Map(), '<=', limit);
  }
  return { model, power, peakPower, machineCount, needsCounts, resources, activity, recipeVariables, sourceVariables, targets, ratio, disposal, sinkCount, sinkPower: sink?.power ?? 30 };
}
