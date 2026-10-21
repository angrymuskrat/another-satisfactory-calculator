# Этап 3: простота и логистика — план реализации

> **Для агентов-исполнителей:** обязательный навык — superpowers:subagent-driven-development
> (рекомендуется) или superpowers:executing-plans. Шаги отмечаются чекбоксами (`- [ ]`).

**Цель:** KPI «разных рецептов» и «промежуточных предметов», четвёртый вариант
«Проще построить» (`simple`), число лент/труб на всех входах и выходах фабрики.

**Архитектура:** чистые функции KPI и числа линий — в `packages/domain`;
новая цель `recipesFirst` — в `packages/solver/solve.ts` перед машинами и
энергией, со связью бинарных переменных через бюджет машин; варианты —
`packages/solver/variants.ts`; UI — `apps/web/src`.

**Стек:** TypeScript, zod 4, HiGHS (MIP), React 19, Vitest, Playwright, pnpm, Node.js 24.

**Спецификация:** [2026-10-05-stage3-simplicity-logistics.md](2026-10-05-stage3-simplicity-logistics.md).
Исполнитель читает спецификацию и `AGENTS.md` целиком.

## Глобальные ограничения

- Общение, документация и тексты UI — на русском; идентификаторы — на английском.
- Node.js 24+. Команды: `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm test:ui`.
  В worktree нет `node_modules`: перед первой задачей выполнить `pnpm install`
  (postinstall генерирует HiGHS adapter; generated vendor не коммитить).
- `variantOptions.simplerExtraPercent`: целое 0–1000, по умолчанию 10.
- Бюджет `simple`: `B = minimum + ceil(minimum · extraPercent / 100)`.
- Связь рецепта: `Σ countVariable(конфигурации рецепта) − B · used ≤ 0`; никакого произвольного big-M.
- `recipesFirst` взаимоисключающее с `resourcesFirst` и `smoothPowerExtraMachines`.
- Доли общего срока вариантов: 0,25 / 0,5 / 0,75 / 1,0; общий срок 25 с не меняется.
- `parallelLines(rate, capacity) = rate > 0 ? max(1, ceil(rate/capacity − min(1e-7, rate/capacity·1e-8))) : 0`.
- Sink не является выходом границы. Ядро не зависит от UI. Результат не называть
  оптимальным без статуса решателя. Generated каталог не править.

## Фокус проверки

1. Принятый вариант «Проще построить» сохраняет `recipesFirst` в плане; следующий
   расчёт из такого плана обязан дать четыре допустимых варианта, а не ошибку zod
   из-за сочетания флагов (тест — задача 4).
2. Существующие закреплённые линии: их рецепт засчитывается использованным, расчёт
   не становится невыполнимым (тест — задача 3).
3. `extraPercent = 0`: бюджет равен минимуму, вариант не превышает минимум машин и
   остаётся допустимым (тест — задача 3).
4. Нулевой минимум машин (вся продукция из внешних потоков — заказ 0): бюджет 0,
   нет деления и бинарных переменных без потока; без ошибок (тест — задача 3).
5. Отгрузки и источники с нулевым фактическим расходом не показывают «0 лент»
   (тест — задача 6, Playwright проверяет только ненулевые; ноль — Vitest `parallelLines`).

---

### Задача 1: доменные функции KPI и числа линий

**Файлы:**
- Создать: `packages/domain/complexity.ts`
- Создать: `packages/domain/transport.ts`
- Тест: `tests/complexity.test.ts`

**Интерфейсы:**
- Производит:
  - `buildComplexity(plan: Pick<Plan, 'targets'>, result: Pick<Result, 'steps'>): BuildComplexity`,
    `interface BuildComplexity { distinctRecipes: number; intermediateItems: number }`;
  - `simplerMachineAllowance(minimum: number, percent: number): number`;
  - `parallelLines(rate: number, capacity: number): number`.

- [ ] **Шаг 1: падающий тест**

```ts
// tests/complexity.test.ts
import { describe, expect, it } from 'vitest';
import { buildComplexity, simplerMachineAllowance } from '../packages/domain/complexity';
import { parallelLines } from '../packages/domain/transport';
import type { StepResult } from '../packages/domain/types';

const step = (recipeId: string, inputs: [string, number][], outputs: [string, number][], cycles = 1): StepResult => ({
  recipeId, cycles, machines: 1, installedMachines: 1, power: 4, powerMax: 4,
  inputs: inputs.map(([itemId, rate]) => ({ itemId, rate })), outputs: outputs.map(([itemId, rate]) => ({ itemId, rate })),
});

describe('buildComplexity', () => {
  it('считает уникальные рецепты и внутренние предметы цепочки', () => {
    const steps = [
      step('iron-ingot', [['iron-ore', 30]], [['iron-ingot', 30]]),
      step('iron-ingot', [['iron-ore', 30]], [['iron-ingot', 30]]),
      step('iron-plate', [['iron-ingot', 60]], [['iron-plate', 40]]),
    ];
    expect(buildComplexity({ targets: [{ itemId: 'iron-plate', rate: 40, weight: 1, scale: 1 }] }, { steps }))
      .toEqual({ distinctRecipes: 2, intermediateItems: 1 });
  });
  it('учитывает цикл и побочный продукт, исключает целевой продукт и простаивающие линии', () => {
    const steps = [
      step('a', [['ore', 10], ['water', 5]], [['x', 10], ['by', 2]]),
      step('b', [['x', 10], ['by', 2]], [['target', 5], ['water', 5]]),
      step('c', [['target', 1]], [['other', 1]]),
      step('idle', [['ore', 0]], [['y', 0]], 0),
    ];
    // x, by, water — внутренние; target выпускается и частично потребляется, но это цель.
    expect(buildComplexity({ targets: [{ itemId: 'target', rate: 4, weight: 1, scale: 1 }] }, { steps }))
      .toEqual({ distinctRecipes: 3, intermediateItems: 3 });
  });
});

describe('simplerMachineAllowance', () => {
  it.each([[0, 10, 0], [2, 10, 1], [10, 10, 1], [20, 10, 2], [3, 0, 0], [5, 1000, 50]])('минимум %i, %i%% → +%i', (minimum, percent, extra) => {
    expect(simplerMachineAllowance(minimum, percent)).toBe(extra);
  });
});

describe('parallelLines', () => {
  it.each([[0, 60, 0], [1e-9, 60, 1], [60, 60, 1], [60 * (1 + 1e-10), 60, 1], [61, 60, 2], [600, 300, 2]])('%f при %f → %i', (rate, capacity, lines) => {
    expect(parallelLines(rate, capacity)).toBe(lines);
  });
});
```

- [ ] **Шаг 2: убедиться, что тест падает**

Run: `pnpm test -- tests/complexity.test.ts`
Expected: FAIL — модули `complexity`/`transport` не найдены.

- [ ] **Шаг 3: реализация**

```ts
// packages/domain/complexity.ts
import type { Plan, Result } from './types';

export interface BuildComplexity { distinctRecipes: number; intermediateItems: number }

/** KPI простоты строительства по работающим этапам результата; добыча и Sink не входят. */
export function buildComplexity(plan: Pick<Plan, 'targets'>, result: Pick<Result, 'steps'>): BuildComplexity {
  const active = result.steps.filter(step => step.cycles > 0);
  const targets = new Set(plan.targets.map(target => target.itemId));
  const produced = new Set(active.flatMap(step => step.outputs.filter(flow => flow.rate > 0).map(flow => flow.itemId)));
  const consumed = new Set(active.flatMap(step => step.inputs.filter(flow => flow.rate > 0).map(flow => flow.itemId)));
  return {
    distinctRecipes: new Set(active.map(step => step.recipeId)).size,
    intermediateItems: [...produced].filter(id => consumed.has(id) && !targets.has(id)).length,
  };
}

/** Допустимое добавление машин варианта «Проще построить»; при percent > 0 и minimum > 0 — хотя бы одна. */
export const simplerMachineAllowance = (minimum: number, percent: number) => Math.ceil(minimum * percent / 100);
```

```ts
// packages/domain/transport.ts
/** Число параллельных лент/труб для среднего потока; относительный допуск не создаёт лишнюю линию из-за округления. */
export const parallelLines = (rate: number, capacity: number) =>
  rate > 0 ? Math.max(1, Math.ceil(rate / capacity - Math.min(1e-7, rate / capacity * 1e-8))) : 0;
```

- [ ] **Шаг 4: тест проходит**

Run: `pnpm test -- tests/complexity.test.ts`
Expected: PASS.

- [ ] **Шаг 5: коммит**

```bash
git add packages/domain/complexity.ts packages/domain/transport.ts tests/complexity.test.ts
git commit -m "Add build complexity KPIs and parallel line helper"
```

---

### Задача 2: контракт настроек `recipesFirst` и `simplerExtraPercent`

**Файлы:**
- Изменить: `packages/domain/types.ts:103-105` (`Settings`), `types.ts:172` (`ProductionVariant.id`)
- Изменить: `packages/domain/validation.ts:36-38` и `superRefine` плана
- Тест: `tests/validation.test.ts` (добавить `describe`)

**Интерфейсы:**
- Производит:
  - `Settings.variantOptions?: { outputLoss: number; extraMachines: number; simplerExtraPercent?: number }`;
  - `Settings.recipesFirst?: { extraPercent: number }`;
  - `ProductionVariant['id'] = 'maximum' | 'economy' | 'resources' | 'simple'`.

- [ ] **Шаг 1: падающий тест** (в конец `tests/validation.test.ts`; если в файле нет
  импортов `createDefaultPlan`/каталога — добавить по образцу `tests/variants.test.ts:1-12`)

```ts
describe('настройки варианта «Проще построить»', () => {
  it('принимает процент и флаг решателя, отклоняет сочетание флагов', () => {
    const plan = createDefaultPlan(catalog);
    plan.settings.variantOptions = { outputLoss: 10, extraMachines: 0, simplerExtraPercent: 25 };
    plan.settings.recipesFirst = { extraPercent: 25 };
    expect(() => parsePlan(plan)).not.toThrow();
    expect(() => parsePlan({ ...plan, settings: { ...plan.settings, resourcesFirst: true } })).toThrow();
    expect(() => parsePlan({ ...plan, settings: { ...plan.settings, smoothPowerExtraMachines: 0 } })).toThrow();
    expect(() => parsePlan({ ...plan, settings: { ...plan.settings, recipesFirst: { extraPercent: 1001 } } })).toThrow();
    expect(() => parsePlan({ ...plan, settings: { ...plan.settings, recipesFirst: { extraPercent: 1.5 } } })).toThrow();
    expect(() => parsePlan({ ...plan, settings: { ...plan.settings, variantOptions: { outputLoss: 10, extraMachines: 0, simplerExtraPercent: -1 } } })).toThrow();
  });
  it('старый план без новых полей остаётся валидным', () => {
    const plan = createDefaultPlan(catalog);
    plan.settings.variantOptions = { outputLoss: 10, extraMachines: 0 };
    expect(parsePlan(plan).settings.recipesFirst).toBeUndefined();
  });
});
```

- [ ] **Шаг 2: тест падает**

Run: `pnpm test -- tests/validation.test.ts`
Expected: FAIL (strictObject отклоняет неизвестные ключи / нет ошибки сочетания).

- [ ] **Шаг 3: реализация**

`packages/domain/types.ts`:

```ts
  variantOptions?: { outputLoss: number; extraMachines: number; simplerExtraPercent?: number };
  smoothPowerExtraMachines?: number;
  resourcesFirst?: boolean;
  /** Флаг копии плана варианта «Проще построить»: минимум разных рецептов в бюджете минимум + extraPercent%. */
  recipesFirst?: { extraPercent: number };
```

```ts
export interface ProductionVariant { id: 'maximum' | 'economy' | 'resources' | 'simple'; label: string; plan: Plan; result: Result; sameAs?: ProductionVariant['id'] }
```

`packages/domain/validation.ts` (settings):

```ts
    variantOptions: z.strictObject({ outputLoss: z.number().finite().min(0).max(99), extraMachines: z.number().int().min(0).max(1000), simplerExtraPercent: z.number().int().min(0).max(1000).optional() }).optional(),
    smoothPowerExtraMachines: z.number().int().min(0).max(1000).optional(),
    resourcesFirst: z.boolean().optional(),
    recipesFirst: z.strictObject({ extraPercent: z.number().int().min(0).max(1000) }).optional(),
```

В `superRefine((plan, context) => { … })` добавить:

```ts
  if (plan.settings.recipesFirst && (plan.settings.resourcesFirst || plan.settings.smoothPowerExtraMachines !== undefined)) {
    context.addIssue({ code: 'custom', path: ['settings', 'recipesFirst'], message: 'Минимум рецептов нельзя сочетать с другим порядком затрат варианта.' });
  }
```

- [ ] **Шаг 4: тесты проходят; typecheck**

Run: `pnpm test -- tests/validation.test.ts` → PASS. `pnpm typecheck` → без ошибок
(новый id ещё не используется; если `ProductionVariants.tsx` требует исчерпывающей
ветки — исправляется в задаче 5, сейчас тернарный оператор компилируется).

- [ ] **Шаг 5: коммит**

```bash
git add packages/domain/types.ts packages/domain/validation.ts tests/validation.test.ts
git commit -m "Add recipesFirst and simplerExtraPercent settings contract"
```

---

### Задача 3: цель `recipesFirst` в решателе, валидаторе и анализе

**Файлы:**
- Изменить: `packages/solver/solve.ts:111-161` (бюджет, новая цель, порядок затрат, тай-брейк), `solve.ts:237` (`modelNotes`)
- Изменить: `packages/solver/validate.ts:156-164` (бюджет машин)
- Изменить: `packages/solver/analysis.ts` (`Summary`, `Comparison`, `summarizeResult`, `compare`, `costOrder`)
- Тест: создать `tests/simpler-build.test.ts`

**Интерфейсы:**
- Потребляет: `simplerMachineAllowance`, `buildComplexity` (задача 1); `Settings.recipesFirst` (задача 2).
- Производит: `Result.machineBudget` для `recipesFirst`; `Summary.distinctRecipes: number`;
  `Comparison.distinctRecipes: Delta`.

- [ ] **Шаг 1: падающий тест**

Контрольная фикстура: путь через промежуточную деталь — 2 машины и 2 рецепта;
прямой медленный рецепт — 3 машины и 1 рецепт. Минимум машин 2; при 10% бюджет
`2 + ceil(0,2) = 3` допускает прямой рецепт.

```ts
// tests/simpler-build.test.ts
import { beforeAll, describe, expect, it } from 'vitest';
import { createHighs } from '../packages/solver/highs';
import { solve } from '../packages/solver/solve';
import { validateResult } from '../packages/solver/validate';
import { analyze } from '../packages/solver/analysis';
import { createDefaultPlan } from '../packages/domain/defaults';
import { buildComplexity } from '../packages/domain/complexity';
import type { Catalog, Plan } from '../packages/domain/types';

let highs: Awaited<ReturnType<typeof createHighs>>;
beforeAll(async () => { highs = await createHighs(); });

/** Две быстрые стадии через деталь (2 машины) против одной медленной (3 машины). */
export function simpleFixture() {
  const fixture: Catalog = {
    version: 'simpler', provenance: { source: 'fixture', commit: '', importedAt: '', verified: true, notes: [] },
    items: ['ore', 'part', 'plate'].map(id => ({ id, name: id, nameEn: id, category: 'Детали', raw: id === 'ore', fluid: false, sinkable: true })),
    buildings: [{ id: 'constructor', name: 'Конструктор', nameEn: 'Constructor', power: 4 }],
    recipes: [
      { id: 'make-part', name: 'Деталь', nameEn: 'Part', category: 'Детали', buildingId: 'constructor', seconds: 1, alternate: false, inputs: [{ itemId: 'ore', amount: 1 }], outputs: [{ itemId: 'part', amount: 1 }] },
      { id: 'assemble', name: 'Сборка', nameEn: 'Assemble', category: 'Детали', buildingId: 'constructor', seconds: 1, alternate: false, inputs: [{ itemId: 'part', amount: 1 }], outputs: [{ itemId: 'plate', amount: 1 }] },
      { id: 'direct', name: 'Прямая', nameEn: 'Direct', category: 'Детали', buildingId: 'constructor', seconds: 6, alternate: false, inputs: [{ itemId: 'ore', amount: 1 }], outputs: [{ itemId: 'plate', amount: 1 }] },
    ],
    miners: [{ id: 'mk1', name: 'Mk1', rate: 60, power: 5, resourceIds: ['ore'] }],
    belts: [{ id: 'belt1', name: 'Лента', rate: 600 }], pipes: [{ id: 'pipe1', name: 'Труба', rate: 300 }], categories: ['Детали'],
  };
  const plan: Plan = createDefaultPlan(fixture);
  plan.mode = 'target';
  plan.targets = [{ itemId: 'plate', rate: 30, weight: 1, scale: 1 }];
  plan.sources = [{ id: 'ore', itemId: 'ore', kind: 'flow', limit: 600, count: 1, purity: 1, minerId: 'mk1', clock: 100 }];
  plan.settings.objective = 'smooth-power';
  plan.settings.clock = 100;
  return { fixture, plan };
}

describe('цель recipesFirst', () => {
  it('компактный план использует две стадии, «проще» — один рецепт в бюджете +10%', () => {
    const { fixture, plan } = simpleFixture();
    const compact = solve(fixture, plan, highs);
    expect(compact.status, compact.message).toBe('approximate');
    expect(buildComplexity(plan, compact)).toEqual({ distinctRecipes: 2, intermediateItems: 1 });
    plan.settings.recipesFirst = { extraPercent: 10 };
    const simple = solve(fixture, plan, highs);
    expect(simple.status, simple.message).toBe('approximate');
    expect(simple.products[0].rate).toBeCloseTo(30, 6);
    expect(simple.steps.map(s => s.recipeId)).toEqual(['direct']);
    expect(buildComplexity(plan, simple)).toEqual({ distinctRecipes: 1, intermediateItems: 0 });
    expect(simple.machineBudget).toEqual({ minimum: 2, limit: 3, used: 3 });
    expect(simple.modelNotes!.join(' ')).toContain('минимизируется число разных рецептов');
    expect(validateResult(fixture, plan, simple).errors).toEqual([]);
  });
  it('при 0% не превышает минимум машин и остаётся допустимым', () => {
    const { fixture, plan } = simpleFixture();
    plan.settings.recipesFirst = { extraPercent: 0 };
    const result = solve(fixture, plan, highs);
    expect(result.status, result.message).toBe('approximate');
    expect(result.machineBudget).toEqual({ minimum: 2, limit: 2, used: 2 });
    expect(buildComplexity(plan, result).distinctRecipes).toBe(2);
    expect(validateResult(fixture, plan, result).errors).toEqual([]);
  });
  it('засчитывает рецепт закреплённой линии и не становится невыполнимым', () => {
    const { fixture, plan } = simpleFixture();
    plan.lines = [{ id: 'old', name: 'Цех', recipeId: 'make-part', count: 1, clock: 100, somersloops: 0, duty: 1, locked: true }];
    plan.expansion = 'add';
    plan.settings.recipesFirst = { extraPercent: 10 };
    const result = solve(fixture, plan, highs);
    expect(['approximate', 'optimal']).toContain(result.status);
    expect(result.steps.some(s => s.recipeId === 'make-part')).toBe(true);
    expect(validateResult(fixture, plan, result).errors).toEqual([]);
  });
  it('нулевой заказ даёт нулевой бюджет без ошибок', () => {
    const { fixture, plan } = simpleFixture();
    plan.targets[0].rate = 0;
    plan.settings.recipesFirst = { extraPercent: 10 };
    const result = solve(fixture, plan, highs);
    expect(['approximate', 'optimal']).toContain(result.status);
    expect(result.machineBudget).toEqual({ minimum: 0, limit: 0, used: 0 });
  });
  it('валидатор отклоняет подменённый бюджет', () => {
    const { fixture, plan } = simpleFixture();
    plan.settings.recipesFirst = { extraPercent: 10 };
    const result = solve(fixture, plan, highs);
    expect(validateResult(fixture, plan, { ...result, machineBudget: { minimum: 2, limit: 4, used: 3 } }).errors)
      .toContain('Нарушен бюджет физических машин.');
  });
  it('сводка анализа содержит число разных рецептов', () => {
    const { fixture, plan } = simpleFixture();
    plan.settings.recipesFirst = { extraPercent: 10 };
    const report = analyze(fixture, plan, highs, { kind: 'alternates' });
    expect(report.baselineSummary?.distinctRecipes).toBe(1);
  });
});
```

- [ ] **Шаг 2: тест падает**

Run: `pnpm test -- tests/simpler-build.test.ts`
Expected: FAIL — `steps` равно `['make-part','assemble']`, `machineBudget` отсутствует.

- [ ] **Шаг 3a: решатель** — `packages/solver/solve.ts`

Импорт: `import { simplerMachineAllowance } from '../domain/complexity';`

Заменить блок бюджета машин (строки 111-117) на:

```ts
    let machineBudget: Result['machineBudget'];
    const recipesFirst = plan.settings.objective === 'smooth-power' ? plan.settings.recipesFirst : undefined;
    if (plan.settings.objective === 'smooth-power' && (plan.settings.smoothPowerExtraMachines !== undefined || recipesFirst)) {
      const minimum = Math.round(optimize(built.machineCount));
      const limit = minimum + (recipesFirst ? simplerMachineAllowance(minimum, recipesFirst.extraPercent) : plan.settings.smoothPowerExtraMachines!);
      model.constrain(built.machineCount, '<=', limit);
      machineBudget = { minimum, limit, used: 0 };
    }
    if (recipesFirst && machineBudget) {
      // Each recipe uses at most the whole finite machine budget, which proves the
      // activation bound; no arbitrary big-M restricts the solution space.
      const recipes = new Map<string, { counts: Expression; flows: string[] }>();
      for (const r of built.recipeVariables) {
        if (!r.countVariable) continue;
        const entry = recipes.get(r.recipe.id) ?? { counts: new Map(), flows: [] };
        entry.counts.set(r.countVariable, 1);
        entry.flows.push(r.variable, r.countVariable);
        recipes.set(r.recipe.id, entry);
      }
      const recipeCount: Expression = new Map();
      const selections: { used: string; flows: string[] }[] = [];
      for (const { counts, flows } of recipes.values()) {
        const used = model.variable(1, true);
        model.constrain(new Map([...counts, [used, -machineBudget.limit]]), '<=', 0);
        recipeCount.set(used, 1);
        selections.push({ used, flows });
        integerFlows.set(used, flows);
      }
      if (selections.length) {
        optimize(recipeCount);
        for (const { used, flows } of selections) {
          const selected = Math.round(values[used] ?? 0);
          model.constrain(new Map([[used, 1]]), '=', selected);
          if (selected === 0) {
            model.variables.get(used)!.upper = 0;
            for (const flow of flows) model.variables.get(flow)!.upper = 0;
          }
        }
      }
    }
    const costGoals = recipesFirst ? [built.machineCount, built.power, normalize(built.resources)]
      : machineBudget ? [built.power, normalize(built.resources), built.machineCount]
```

(остальные ветки `costGoals` без изменений). Финальный блок тай-брейка
(строка 132, начинается с `{` и комментария `// Discrete tie-breaking…`)
заменить заголовком `if (!recipesFirst) {` — число рецептов уже зафиксировано.

В `modelNotes` (строка 237) первую часть шаблона smooth-power заменить на:

```ts
${recipesFirst && machineBudget ? `После выпуска найден минимум ${machineBudget.minimum} физических машин; в бюджете до ${machineBudget.limit} машин минимизируется число разных рецептов, затем машины и энергия. Вне бюджета более простой план не исключён.` : machineBudget ? `После выпуска найден минимум ${machineBudget.minimum} физических машин; энергия минимизируется в бюджете до ${machineBudget.limit} машин.` : plan.settings.resourcesFirst ? 'После выпуска минимизируется взвешенное сырьё, затем число машин и энергия.' : 'После выпуска минимизируется число машин, затем энергия.'}
```

- [ ] **Шаг 3b: валидатор** — `packages/solver/validate.ts:156-164` заменить на:

```ts
  const recipesFirst = plan.settings.objective === 'smooth-power' ? plan.settings.recipesFirst : undefined;
  if (plan.settings.objective === 'smooth-power' && (plan.settings.smoothPowerExtraMachines !== undefined || recipesFirst)) {
    const budget = result.machineBudget;
    const used = [...counts.values()].reduce((sum, value) => sum + value, wellSatellites);
    // Минимум получен отдельной целью решателя; здесь независимо проверяются
    // физическое количество и соблюдение объявленного конечного бюджета.
    const allowance = budget && recipesFirst ? simplerMachineAllowance(budget.minimum, recipesFirst.extraPercent) : plan.settings.smoothPowerExtraMachines;
    if (!budget || ![budget.minimum, budget.limit, budget.used].every(value => Number.isInteger(value) && value >= 0)
      || budget.limit !== budget.minimum + allowance!
      || budget.used !== used || used > budget.limit || used < budget.minimum) errors.push('Нарушен бюджет физических машин.');
  }
```

с импортом `import { simplerMachineAllowance } from '../domain/complexity';`.

- [ ] **Шаг 3c: анализ** — `packages/solver/analysis.ts`

```ts
export interface Summary {
  power: number; installedPower: number; productionIdlePower: number; resourceCost: number; distinctRecipes: number;
  physical: { production: number; extraction: number; sinks: number; total: number };
}
export interface Comparison {
  power: Delta; installedPower: Delta; productionIdlePower: Delta; resourceCost: Delta; distinctRecipes: Delta;
  …
```

В `summarizeResult` в возвращаемый объект добавить
`distinctRecipes: buildComplexity(plan, result).distinctRecipes,`
(импорт `buildComplexity` из `../domain/complexity`); в `compare` —
`distinctRecipes: delta(a.distinctRecipes, b.distinctRecipes),`. В `costOrder`:

```ts
  if (plan.settings.objective === 'smooth-power') {
    if (plan.settings.recipesFirst) return [comparison.distinctRecipes, machines, power, resourceCost];
    if (plan.settings.resourcesFirst) return [resourceCost, machines, power];
```

Проверить `grep -rn "Summary\b\|summarizeResult" tests apps/web/src` — тесты с
`toEqual` на полный `Summary` дополнить полем `distinctRecipes`.

- [ ] **Шаг 4: тесты проходят**

Run: `pnpm test -- tests/simpler-build.test.ts tests/variants.test.ts tests/analysis.test.ts tests/solver.test.ts`
Expected: PASS (прежние варианты не изменились: без `recipesFirst` порядок прежний).

- [ ] **Шаг 5: коммит**

```bash
git add packages/solver tests/simpler-build.test.ts tests/analysis.test.ts
git commit -m "Add recipesFirst objective bounded by machine budget"
```

---

### Задача 4: четвёртый вариант «Проще построить»

**Файлы:**
- Изменить: `packages/solver/variants.ts`
- Изменить: `tests/variants.test.ts` (ожидания трёх вариантов → четырёх)
- Тест: `tests/simpler-build.test.ts` (добавить `describe`)

**Интерфейсы:**
- Потребляет: `Settings.recipesFirst`, `variantOptions.simplerExtraPercent`, `simpleFixture()` (задача 3).
- Производит: `ProductionVariants.variants` из четырёх элементов в порядке
  `maximum, economy, resources, simple`; `simple.plan.settings.recipesFirst = { extraPercent }`.

- [ ] **Шаг 1: падающие тесты** — добавить в `tests/simpler-build.test.ts`:

```ts
import { solveVariants } from '../packages/solver/variants';

describe('вариант «Проще построить»', () => {
  it('четвёртая карточка уменьшает число рецептов и сохраняет заказ', () => {
    const { fixture, plan } = simpleFixture();
    const report = solveVariants(fixture, plan, highs);
    expect(report.variants.map(v => v.id)).toEqual(['maximum', 'economy', 'resources', 'simple']);
    const simple = report.variants[3];
    expect(simple.label).toBe('Проще построить');
    expect(simple.plan.settings.recipesFirst).toEqual({ extraPercent: 10 });
    expect(simple.plan.settings.outputSlack).toBe(0);
    expect(simple.result.steps.map(s => s.recipeId)).toEqual(['direct']);
    expect(simple.sameAs).toBeUndefined();
    expect(report.equivalent).toBe(false);
    expect(validateResult(fixture, simple.plan, simple.result).errors).toEqual([]);
  });
  it('берёт процент из настроек и потерю выпуска как у экономичных вариантов', () => {
    const { fixture, plan } = simpleFixture();
    plan.mode = 'maximize'; plan.sources[0].limit = 30;
    plan.settings.variantOptions = { outputLoss: 20, extraMachines: 0, simplerExtraPercent: 0 };
    const simple = solveVariants(fixture, plan, highs).variants[3];
    expect(simple.plan.settings.recipesFirst).toEqual({ extraPercent: 0 });
    expect(simple.plan.settings.outputSlack).toBe(20);
  });
  it('план с принятым recipesFirst снова даёт четыре допустимых варианта', () => {
    const { fixture, plan } = simpleFixture();
    const accepted = solveVariants(fixture, plan, highs).variants[3].plan;
    const next = solveVariants(fixture, accepted, highs);
    for (const variant of next.variants) {
      expect(variant.result.status, variant.result.message).toBe('approximate');
      expect(validateResult(fixture, variant.plan, variant.result).errors).toEqual([]);
    }
    expect(next.variants[0].plan.settings.recipesFirst).toBeUndefined();
    expect(next.variants[1].plan.settings.recipesFirst).toBeUndefined();
    expect(next.variants[2].plan.settings.recipesFirst).toBeUndefined();
  });
});
```

В `tests/variants.test.ts`:
- `expect(variants.map(v => v.id)).toEqual(['maximum', 'economy', 'resources'])` → добавить `'simple'`;
- `expect(result.variants).toHaveLength(3)` → `4`; `sameAs` → `[undefined, 'maximum', 'maximum', 'maximum']`;
- тайм-аут/ошибки: массивы статусов из трёх элементов → четыре.

- [ ] **Шаг 2: тесты падают**

Run: `pnpm test -- tests/simpler-build.test.ts tests/variants.test.ts`
Expected: FAIL — вариантов три.

- [ ] **Шаг 3: реализация** — `packages/solver/variants.ts`

```ts
  const resources = structuredClone(input);
  const simple = structuredClone(input);
  const variants: ProductionVariant[] = [
    …три прежних…,
    { id: 'simple', label: 'Проще построить', plan: simple, result: emptyResult('timeout', 'Время расчёта истекло.') },
  ];
```

В блоке настроек: у `maximum`, `economy`, `resources` добавить `delete X.settings.recipesFirst;`, затем:

```ts
  simple.settings.objective = 'smooth-power';
  simple.settings.outputSlack = economy.settings.outputSlack;
  simple.settings.recipesFirst = { extraPercent: input.settings.variantOptions?.simplerExtraPercent ?? 10 };
  delete simple.settings.smoothPowerExtraMachines;
  delete simple.settings.resourcesFirst;
```

Доли срока:

```ts
  variants[0].result = solve(catalog, maximum, highs, start + span * 0.25);
  variants[1].result = solve(catalog, economy, highs, start + span * 0.5);
  variants[2].result = solve(catalog, resources, highs, start + span * 0.75);
  variants[3].result = solve(catalog, simple, highs, deadline);
```

Комментарий над долями обновить: «Варианты решаются по очереди; неиспользованное
время предыдущих переходит следующим; ошибка одного варианта не стирает остальные.»

- [ ] **Шаг 4: тесты проходят**

Run: `pnpm test -- tests/simpler-build.test.ts tests/variants.test.ts tests/scarcity-alternates.test.ts`
Expected: PASS.

- [ ] **Шаг 5: коммит**

```bash
git add packages/solver/variants.ts tests/variants.test.ts tests/simpler-build.test.ts
git commit -m "Add simpler-build production variant"
```

---

### Задача 5: карточка и настройка варианта в интерфейсе

**Файлы:**
- Изменить: `apps/web/src/ProductionVariants.tsx:36-45`
- Изменить: `apps/web/src/VariantSettings.tsx`
- Тест: `tests/ui/variants.spec.ts` (новый `test`)

**Интерфейсы:**
- Потребляет: `buildComplexity` (задача 1), вариант `simple` (задача 4).

- [ ] **Шаг 1: падающий Playwright-тест** — в конец `tests/ui/variants.spec.ts`:

```ts
test('карточка «Проще построить» показывает число рецептов и настраивается с клавиатуры', async ({ page }) => {
  await page.addInitScript(value => localStorage.setItem('ficsit-plan-v1', JSON.stringify(value)), plan);
  await page.goto('/');
  // NumberField рендерит input type="text" с aria-label.
  const field = page.getByRole('textbox', { name: 'Дополнительные машины для простоты' });
  await field.focus();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('20');
  await page.keyboard.press('Tab');
  await page.getByRole('button', { name: 'Рассчитать', exact: true }).click();
  const simple = page.getByRole('article', { name: 'Проще построить', exact: true });
  const merged = page.getByText('«Проще построить» совпадает');
  await expect(simple.or(merged)).toBeVisible({ timeout: 30000 });
  if (await simple.isVisible()) {
    await expect(simple).toContainText('Разных рецептов');
    await expect(simple).toContainText('+ 20%');
  }
  await expect(page.getByRole('article', { name: 'Максимальный выпуск', exact: true })).toContainText('Разных рецептов');
});
```

- [ ] **Шаг 2: тест падает**

Run: `pnpm test:ui -- tests/ui/variants.spec.ts -g "Проще построить"` (dev-сервер запускает конфиг Playwright или `pnpm dev` в отдельном терминале — см. README).
Expected: FAIL — поля нет.

- [ ] **Шаг 3: реализация**

`ProductionVariants.tsx` — импорт `import { buildComplexity } from '../../../packages/domain/complexity';`.
Подсказка карточки (строка 36) — вынести в функцию:

```tsx
const hint = (variant: ProductionVariant, plan: Plan) => {
  const loss = plan.mode === 'maximize' && !plan.batch ? `Допустимая потеря выпуска: ${format(variant.plan.settings.outputSlack)}%.` : 'Заказ сохраняется полностью.';
  if (variant.id === 'maximum') return 'Компактная фабрика с полным доступным выпуском или заданным заказом.';
  if (variant.id === 'economy') return `Экономия в пределах компактной фабрики + ${variant.plan.settings.smoothPowerExtraMachines ?? 0} машин. ${loss}`;
  if (variant.id === 'simple') return `Сначала минимум разных рецептов в пределах компактной фабрики + ${variant.plan.settings.recipesFirst?.extraPercent ?? 10}%, затем машины и энергия. ${loss}`;
  return `Сначала минимум взвешенного сырья, затем машины и энергия. ${loss}`;
};
```

(`ProductionVariant` импортировать из `../../../packages/domain/types`), в JSX:
`<p className="hint">{hint(variant, plan)}</p>`. После строки «Машины производства» добавить:

```tsx
<div><dt>Разных рецептов</dt><dd>{buildComplexity(variant.plan, result).distinctRecipes}{variant.id !== 'maximum' && baseline && hasSolution(baseline.result) && <small>{buildComplexity(variant.plan, result).distinctRecipes - buildComplexity(baseline.plan, baseline.result).distinctRecipes >= 0 ? '+' : '−'}{Math.abs(buildComplexity(variant.plan, result).distinctRecipes - buildComplexity(baseline.plan, baseline.result).distinctRecipes)} к максимальному варианту</small>}</dd></div>
```

(вычислить `const recipes = buildComplexity(variant.plan, result).distinctRecipes` и
`baseRecipes` один раз рядом с `machines`, чтобы не повторять вызовы).

`VariantSettings.tsx`:

```tsx
    <p>После расчёта выберите один из вариантов: максимальный выпуск, экономию энергии, экономию редкого сырья или более простую постройку. Все варианты подбирают рабочие частоты.</p>
    …
      <label><span className="field-label">Дополнительные машины для простоты</span><NumberField label="Дополнительные машины для простоты" value={options.simplerExtraPercent ?? 10} max={1000} step={1} suffix="%" onChange={simplerExtraPercent => update({ simplerExtraPercent })} /></label>
```

В подсказке: «…в обоих вариантах» → «…во всех вариантах»; добавить предложение:
«Для простоты бюджет — минимум машин плюс заданный процент (округление вверх);
внутри него сначала уменьшается число разных рецептов.»

- [ ] **Шаг 4: тесты проходят**

Run: `pnpm typecheck` → PASS; `pnpm test:ui -- tests/ui/variants.spec.ts tests/ui/scarcity-alternates.spec.ts` → PASS.

- [ ] **Шаг 5: коммит**

```bash
git add apps/web/src/ProductionVariants.tsx apps/web/src/VariantSettings.tsx tests/ui/variants.spec.ts
git commit -m "Show simpler-build variant card and settings"
```

---

### Задача 6: KPI результата и граница фабрики

**Файлы:**
- Изменить: `apps/web/src/Results.tsx:37-45` (`lines`), `:58` (KPI), `:60-64` (источники), `:85` (отгрузки)
- Изменить: `packages/domain/schematic.ts:172` (групповое `parallel`)
- Изменить: `apps/web/src/styles.css` (`.kpi-grid` в базовом правиле)
- Тест: `tests/ui/planner.spec.ts` (новый `test`), `tests/schematic.test.ts` (прогон без изменений)

**Интерфейсы:**
- Потребляет: `buildComplexity`, `parallelLines` (задача 1).

- [ ] **Шаг 1: падающий Playwright-тест** — в `tests/ui/planner.spec.ts` по образцу
  существующих тестов файла (тот же способ засева плана в `localStorage`):

```ts
test('результат показывает KPI простоты и линии на входах', async ({ page }) => {
  const seeded = createDefaultPlan(catalog);
  seeded.mode = 'target';
  seeded.targets = [{ itemId: 'iron-plate', rate: 40, weight: 1, scale: 1 }];
  seeded.sources = [{ id: 'iron', itemId: 'iron-ore', kind: 'flow', limit: 600, count: 1, purity: 1, minerId: 'miner-mk1', clock: 100 }];
  seeded.settings.enabledRecipeIds = ['iron-ingot', 'iron-plate'];
  seeded.settings.beltId = 'belt1';
  await page.addInitScript(value => localStorage.setItem('ficsit-plan-v1', JSON.stringify(value)), seeded);
  await page.goto('/');
  await page.getByRole('button', { name: 'Рассчитать', exact: true }).click();
  await chooseMaximum(page);
  await expect(page.locator('.kpi').filter({ hasText: 'Разных рецептов' })).toContainText('2');
  await expect(page.locator('.kpi').filter({ hasText: 'Промежуточных предметов' })).toContainText('1');
  // 60 руды/мин при ленте Mk1 (60/мин) — ровно одна лента.
  await expect(page.locator('.utilization').filter({ hasText: 'Железная руда' })).toContainText('1 лента');
});

test('отгрузка побочного продукта показана панелью с числом труб', async ({ page }) => {
  // Пластик: 30 нефти → 20 пластика + 10 м³ остатка/мин (oil-refinery, 6 с); Sink выключен,
  // остаток обязан уйти в отгрузку. 10 м³/мин при трубе ур. 1 (300) — одна труба.
  const seeded = createDefaultPlan(catalog);
  seeded.mode = 'target';
  seeded.targets = [{ itemId: 'plastic', rate: 20, weight: 1, scale: 1 }];
  seeded.sources = [{ id: 'oil', itemId: 'crude-oil', kind: 'flow', limit: 300, count: 1, purity: 1, minerId: 'oil-pump', clock: 100 }];
  seeded.settings.enabledRecipeIds = ['plastic'];
  seeded.settings.allowSink = false;
  seeded.settings.pipeId = 'pipe1';
  seeded.exports = [{ itemId: 'heavy-oil-residue', limit: 100, name: 'Соседняя фабрика' }];
  await page.addInitScript(value => localStorage.setItem('ficsit-plan-v1', JSON.stringify(value)), seeded);
  await page.goto('/');
  await page.getByRole('button', { name: 'Рассчитать', exact: true }).click();
  await chooseMaximum(page);
  const exportsPanel = page.getByRole('region', { name: 'Отгрузки' });
  await expect(exportsPanel).toContainText('1 труба');
  await expect(exportsPanel).toContainText('Соседняя фабрика');
  await expect(page.getByText(/^Отгрузка:/)).toHaveCount(0);
});
```

Импорт `chooseMaximum` из `./chooseVariant`, `createDefaultPlan`/`catalog` — как
в `variants.spec.ts:1-7` (если в `planner.spec.ts` их ещё нет). Каталог проверен:
`belt1` = 60/мин, `pipe1` = 300 м³/мин, рецепт `plastic` и жидкость `heavy-oil-residue` существуют.
`oil-pump` — единственный добытчик нефти в каталоге.

- [ ] **Шаг 2: тест падает**

Run: `pnpm test:ui -- tests/ui/planner.spec.ts -g "KPI простоты|отгрузка побочного"`
Expected: FAIL — плиток и панели «Отгрузки» нет.

- [ ] **Шаг 3: реализация** — `Results.tsx`

Импорты: `buildComplexity` из `../../../packages/domain/complexity`, `parallelLines` из `../../../packages/domain/transport`.

```tsx
  const lines = (id: string, rate: number) => {
    const fluid = item(id)?.fluid;
    const capacity = (fluid ? model?.transport.pipe : model?.transport.belt)?.rate;
    if (!capacity) return '—';
    const count = parallelLines(rate, capacity);
    const plural = new Intl.PluralRules('ru').select(count);
    const names = fluid ? { one: 'труба', few: 'трубы', many: 'труб', other: 'трубы' } : { one: 'лента', few: 'ленты', many: 'лент', other: 'ленты' };
    return count + ' ' + (names[plural as keyof typeof names] ?? names.other);
  };
  const complexity = result && hasSolution(result) ? buildComplexity(plan, result) : null;
```

В `kpi-grid` после плитки «Машины производства»:

```tsx
<div className="kpi"><span><Boxes size={16} />Разных рецептов</span><strong>{complexity?.distinctRecipes ?? 0}<small>рецептов</small></strong></div><div className="kpi"><span><Layers size={16} />Промежуточных предметов</span><strong>{complexity?.intermediateItems ?? 0}<small>внутри фабрики</small></strong></div>
```

В строке источника, в `<small>` после доли запаса карты:
`{source.rate > 0 && ` · ${lines(source.itemId, source.rate)} через границу`}`.
Под списком источников добавить подсказку:
`<p className="hint">Число линий — для суммарного потока через границу фабрики; предел выхода каждого добытчика модель проверяет отдельно.</p>`.

После панели «Готовая продукция»:

```tsx
{!!result.exports?.length && <section className="panel output-panel" aria-labelledby="exports-title"><div className="section-heading"><h3 id="exports-title">Отгрузки</h3></div>{result.exports.map(e => <div className="output-row" key={e.itemId}><ItemIcon item={item(e.itemId)} size={42} /><div><strong>{item(e.itemId)?.name ?? e.itemId}</strong><small>{lines(e.itemId, e.rate)} параллельно · {plan.exports?.find(x => x.itemId === e.itemId)?.name}</small></div><CopyNumber value={e.rate} label={'Отгрузка: ' + (item(e.itemId)?.name ?? e.itemId)} suffix={unit(item(e.itemId))} /></div>)}</section>}
```

В нижней секции (строка 85) удалить `{result.exports?.map(e => <p …>Отгрузка: …</p>)}`;
строка Somersloops остаётся.

`schematic.ts:172`: `parallel: parallelLines(rate, capacity)` с импортом из `./transport`
(режим отдельных машин с `Math.ceil(rate / capacity)` для раскладки линий не трогать).

`styles.css`: в базовом правиле `.kpi-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}`
заменить `repeat(3,1fr)` на `repeat(auto-fit,minmax(150px,1fr))`; медиаправила не трогать.

- [ ] **Шаг 4: тесты проходят**

Run: `pnpm test -- tests/schematic.test.ts tests/construction.test.ts` → PASS;
`pnpm test:ui -- tests/ui/planner.spec.ts tests/ui/construction.spec.ts tests/ui/planner-layout.spec.ts tests/ui/accessibility.spec.ts` → PASS.
Проверить мобильную ширину 390 px: нет горизонтальной прокрутки (существующая проверка
в `variants.spec.ts` и `planner-layout.spec.ts`).

- [ ] **Шаг 5: коммит**

```bash
git add apps/web/src/Results.tsx apps/web/src/styles.css packages/domain/schematic.ts tests/ui/planner.spec.ts
git commit -m "Show simplicity KPIs and boundary lines for inputs and exports"
```

---

### Задача 7: документация и полный прогон

**Файлы:**
- Изменить: `docs/plans/2026-10-03-mid-game-roadmap.md` (этап 3 — `[x]` с короткими пометками)
- Изменить: `docs/STATUS.md` (раздел этапа 3: сделано, проверки, ограничения, следующий шаг — этап 4)
- Изменить: `AGENTS.md` (инвариант вариантов: четыре снимка; правило `recipesFirst`)

- [ ] **Шаг 1: AGENTS.md** — в пункте «Подбор вариантов сохраняет три независимых снимка»
  заменить «три» на «четыре» и дописать после описания экономии редкого сырья:
  «и «Проще построить» (settings.recipesFirst: после выпуска минимум физических
  машин, бюджет минимум + ceil(минимум·simplerExtraPercent/100), по умолчанию 10%;
  внутри бюджета минимум разных рецептов → машины → энергия → сырьё, та же потеря
  выпуска). recipesFirst не сочетается с resourcesFirst и бюджетом экономии;
  связь рецепта ограничена бюджетом машин, без произвольного big-M.»

- [ ] **Шаг 2: roadmap и STATUS** — отметить три пункта этапа 3; в STATUS указать
  фактически запущенные проверки и их результат, что не запускалось.

- [ ] **Шаг 3: полный прогон**

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm test:ui
git diff --check
```

Expected: всё PASS. Любой сбой — разобрать (superpowers:systematic-debugging), не
ослаблять проверки.

- [ ] **Шаг 4: коммит**

```bash
git add AGENTS.md docs/STATUS.md docs/plans/2026-10-03-mid-game-roadmap.md
git commit -m "Document stage 3: simplicity KPIs, simpler-build variant, boundary lines"
```
