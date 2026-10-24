# Этап 4: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (согласовано: реализация в этой сессии через TDD). Шаги отмечаются `- [ ]`.

**Goal:** справка «Чем покрыть» (угольные и топливные генераторы) и карточки вариантов по мере готовности с выбором основного до конца расчёта.

**Architecture:** данные генераторов импортируются из закреплённых Docs в отдельный
`power-generators.json`; чистая доменная функция считает генераторы и расход; блок
в разделе «Энергия». `solveVariants` сообщает прогресс через callback, worker
пересылает частичные отчёты, `useSolver` держит `pending` и не останавливает
worker после выбора снимка этого же запроса.

**Tech Stack:** TypeScript, React 19, Vite worker, HiGHS (wasm), Vitest, Playwright.

**Spec:** [2026-10-22-stage4-power-responsiveness.md](2026-10-22-stage4-power-responsiveness.md)

## Global Constraints

- Коммиты не делать (CLAUDE.local.md, раздел 1); шаг «Commit» заменён на «изменения не коммитятся».
- Генераторы: только `Build_GeneratorCoal_C` (`coal-generator`) и `Build_GeneratorFuel_C` (`fuel-generator`).
- Жидкости: `energy = mEnergyValue × 1000` МДж/м³; вода угольного: `perMJ = mSupplementalToPowerRatio / 1000` м³/МДж.
- Генераторов: `ceil(P / G − 1e-9)`, при `P ≤ 0` — 0. Расход: `P · 60 / energy`; вода: `P · 60 · perMJ`.
- Пик справки: `model.peakPower + powerReserve`; подпись «Пик + резерв» при резерве > 0, иначе «Пик».
- Доли срока вариантов 0,25 / 0,5 / 0,75 / 1,0 и порядок вариантов не меняются; тип `ProductionVariants` не меняется.
- Сообщение worker: `{ report, pending, done }`.
- Не править `catalog.json` вручную; идентификаторы — английские, тексты — русские.
- Плотность комментариев — как в окружающем коде (почти нет).

## Review Focus

1. Выбор основного варианта во время расчёта, затем правка плана — worker останавливается, карточки не принимаются (тест в Task 5).
2. Основной вариант невыполним, остальные ещё считаются — экран не должен объявлять «Подбор завершён без доступного варианта» до `done` (тест в Task 5, unit-проверка `failure` через UI-сценарий с невыполнимым заказом).
3. Отмена или 30-секундный таймер при частичном отчёте — решённые карточки остаются выбираемыми, нерешённые показывают «Не рассчитан» (Task 5).
4. Выбранный вариант при фоновом расчёте — в его «Результатах» нет спиннера и ошибки фона (Task 5).
5. Средняя мощность ровно кратна мощности генератора и численный шум (`150.0000001`) — не лишний генератор (Task 2).

---

### Task 1: импорт данных генераторов

**Files:**
- Create: `scripts/import-power-generators.mjs`
- Create (generated): `packages/game-data/power-generators.json`
- Modify: `scripts/import-game-data.mjs:172` (вызов после p2-mechanics)
- Modify: `packages/game-data/README.md` (раздел о новом файле)
- Test: `tests/power-coverage.test.ts`

**Interfaces:**
- Produces: JSON
  `{ provenance: { catalogVersion, source, sha256, ruSource, ruSha256, importedAt, verification }, generators: [{ id, className, name, nameEn, power, fuels: [{ itemId, energy }], supplemental: { itemId, perMJ } | null }] }`.

- [ ] **Step 1: падающий тест данных**

```ts
import { describe, expect, it } from 'vitest';
import generators from '../packages/game-data/power-generators.json';
import gameCatalog from '../packages/game-data/catalog.json';

describe('данные генераторов', () => {
  it('совпадают с цифрами игры и версией каталога', () => {
    expect(generators.provenance.catalogVersion).toBe(gameCatalog.version);
    const coal = generators.generators.find(g => g.id === 'coal-generator')!;
    const fuel = generators.generators.find(g => g.id === 'fuel-generator')!;
    expect(coal).toMatchObject({ name: 'Угольный генератор', power: 75, supplemental: { itemId: 'water', perMJ: 0.01 } });
    expect(coal.fuels).toEqual([{ itemId: 'coal', energy: 300 }, { itemId: 'compacted-coal', energy: 630 }, { itemId: 'petroleum-coke', energy: 180 }]);
    expect(fuel).toMatchObject({ name: 'Топливный генератор', power: 250, supplemental: null });
    expect(fuel.fuels).toEqual([{ itemId: 'fuel', energy: 750 }, { itemId: 'turbofuel', energy: 2000 }, { itemId: 'liquid-biofuel', energy: 750 }, { itemId: 'rocket-fuel', energy: 3600 }, { itemId: 'ionized-fuel', energy: 5000 }]);
    // Контроль с игрой: 15 угля и 45 м³ воды, 20 м³ топлива в минуту.
    expect(coal.power * 60 / 300).toBe(15);
    expect(coal.power * 60 * coal.supplemental!.perMJ).toBeCloseTo(45, 9);
    expect(fuel.power * 60 / 750).toBe(20);
  });
});
```

- [ ] **Step 2:** `pnpm vitest run tests/power-coverage.test.ts` — FAIL (нет файла).

- [ ] **Step 3: скрипт импорта**

```js
// Производное закреплённых игровых Docs. См. THIRD_PARTY_NOTICES.md.
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
const root = new URL('../', import.meta.url);
const pinned = JSON.parse(readFileSync(new URL('packages/game-data/source/provenance.json', root), 'utf8'));
const docs = name => {
  const raw = readFileSync(new URL(`packages/game-data/source/${name}`, root));
  const sha256 = createHash('sha256').update(raw).digest('hex');
  if (sha256 !== pinned.sha256[name]) throw new Error(`Изменились исходные ${name}.`);
  return { sha256, classes: JSON.parse(gunzipSync(raw).toString('utf16le').replace(/^﻿/, '')).flatMap(g => g.Classes.map(c => ({ ...c, nativeClass: g.NativeClass }))) };
};
const en = docs('Docs-en-US.json.gz'), ru = docs('Docs-ru.json.gz');
const catalog = JSON.parse(readFileSync(new URL('packages/game-data/catalog.json', root), 'utf8'));
const report = JSON.parse(readFileSync(new URL('packages/game-data/audit-report.json', root), 'utf8'));
const itemIds = new Map(Object.entries(report.itemClasses).map(([id, cls]) => [cls, id]));
const item = className => {
  const id = itemIds.get(className), entry = catalog.items.find(i => i.id === id), doc = en.classes.find(c => c.ClassName === className);
  if (!entry || !doc) throw new Error(`Не сопоставлен предмет: ${className}`);
  if (entry.fluid !== (doc.mForm !== 'RF_SOLID')) throw new Error(`Не совпадает форма предмета: ${className}`);
  return { entry, doc };
};
const generators = Object.entries({ 'coal-generator': 'Build_GeneratorCoal_C', 'fuel-generator': 'Build_GeneratorFuel_C' }).map(([id, className]) => {
  const c = en.classes.find(c => c.ClassName === className), name = ru.classes.find(c => c.ClassName === className)?.mDisplayName;
  if (!c || !c.nativeClass.endsWith(".FGBuildableGeneratorFuel'") || !name) throw new Error(`Не найден генератор: ${className}`);
  const power = Number(c.mPowerProduction);
  if (!(power > 0)) throw new Error(`Некорректная мощность: ${className}`);
  const fuels = c.mFuel.map(f => {
    const { entry, doc } = item(f.mFuelClass), energy = Number(doc.mEnergyValue) * (entry.fluid ? 1000 : 1);
    if (!(energy > 0)) throw new Error(`Некорректная энергия топлива: ${f.mFuelClass}`);
    return { itemId: entry.id, energy };
  });
  let supplemental = null;
  if (c.mRequiresSupplementalResource === 'True') {
    const classes = [...new Set(c.mFuel.map(f => f.mSupplementalResourceClass))];
    if (classes.length !== 1) throw new Error(`Разные вспомогательные ресурсы: ${className}`);
    const perMJ = Number(c.mSupplementalToPowerRatio) / 1000;
    if (!(perMJ > 0)) throw new Error(`Некорректный расход вспомогательного ресурса: ${className}`);
    supplemental = { itemId: item(classes[0]).entry.id, perMJ };
  }
  return { id, className, name, nameEn: c.mDisplayName, power, fuels, supplemental };
});
const data = { provenance: { catalogVersion: catalog.version, source: 'source/Docs-en-US.json.gz', sha256: en.sha256, ruSource: 'source/Docs-ru.json.gz', ruSha256: ru.sha256, importedAt: '2026-10-22',
  verification: 'Генераторы и энергоёмкость топлива из закреплённых Docs. Жидкости: mEnergyValue на 1/1000 м³. Сверено с игрой: угольный 15 угля и 45 м³ воды, топливный 20 м³ топлива в минуту.' }, generators };
writeFileSync(new URL('packages/game-data/power-generators.json', root), JSON.stringify(data, null, 2) + '\n');
```

`import-game-data.mjs` после строки 172: `await import('./import-power-generators.mjs');`

- [ ] **Step 4:** `node scripts/import-power-generators.mjs`, затем тест — PASS. Проверить `perMJ`: `10 / 1000` в JS даёт `0.01` точно.
- [ ] **Step 5:** README `packages/game-data`: раздел «Дополнение этапа 4» — файл, команда, источник, что считается. Изменения не коммитятся.

### Task 2: `powerCoverage`

**Files:**
- Create: `packages/domain/powerCoverage.ts`
- Test: `tests/power-coverage.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface CoverageRate { itemId: string; average: number; peak: number }
  export interface GeneratorCoverage { id: string; name: string; power: number; average: number; peak: number; fuels: CoverageRate[]; supplemental: CoverageRate | null }
  export function powerCoverage(catalog: Pick<Catalog, 'version'>, average: number, peak: number): GeneratorCoverage[] | null
  ```
  `average`/`peak` у генератора — число генераторов; у `fuels`/`supplemental` — расход в единицах каталога в минуту.

- [ ] **Step 1: падающие тесты**

```ts
import { powerCoverage } from '../packages/domain/powerCoverage';
const version = { version: gameCatalog.version };
describe('powerCoverage', () => {
  it('300 МВт средней мощности — 4 угольных, 60 угля и 180 м³ воды', () => {
    const coal = powerCoverage(version, 300, 400)!.find(g => g.id === 'coal-generator')!;
    expect(coal.average).toBe(4);
    expect(coal.peak).toBe(6);
    expect(coal.fuels.find(f => f.itemId === 'coal')).toEqual({ itemId: 'coal', average: 60, peak: 80 });
    expect(coal.supplemental!.average).toBeCloseTo(180, 9);
  });
  it('кратная мощность и численный шум не добавляют генератор', () => {
    const fuel = powerCoverage(version, 250, 250.0000001)!.find(g => g.id === 'fuel-generator')!;
    expect([fuel.average, fuel.peak]).toEqual([1, 1]);
    expect(fuel.fuels.find(f => f.itemId === 'fuel')!.average).toBe(20);
    expect(powerCoverage(version, 75, 75)!.find(g => g.id === 'coal-generator')!.average).toBe(1);
  });
  it('нулевая мощность — ноль генераторов и расхода', () => {
    const coal = powerCoverage(version, 0, 0)!.find(g => g.id === 'coal-generator')!;
    expect([coal.average, coal.peak, coal.fuels[0].average]).toEqual([0, 0, 0]);
  });
  it('другая версия каталога — справки нет', () => {
    expect(powerCoverage({ version: 'other' }, 300, 300)).toBeNull();
  });
});
```

- [ ] **Step 2:** запуск — FAIL (нет модуля).
- [ ] **Step 3: реализация**

```ts
import type { Catalog } from './types';
import data from '../game-data/power-generators.json';

export interface CoverageRate { itemId: string; average: number; peak: number }
export interface GeneratorCoverage { id: string; name: string; power: number; average: number; peak: number; fuels: CoverageRate[]; supplemental: CoverageRate | null }

const count = (power: number, generator: number) => power > 0 ? Math.ceil(power / generator - 1e-9) : 0;
const perMinute = (power: number, energy: number) => Math.max(0, power) * 60 / energy;

export function powerCoverage(catalog: Pick<Catalog, 'version'>, average: number, peak: number): GeneratorCoverage[] | null {
  if (catalog.version !== data.provenance.catalogVersion) return null;
  return data.generators.map(g => ({
    id: g.id, name: g.name, power: g.power, average: count(average, g.power), peak: count(peak, g.power),
    fuels: g.fuels.map(f => ({ itemId: f.itemId, average: perMinute(average, f.energy), peak: perMinute(peak, f.energy) })),
    supplemental: g.supplemental && { itemId: g.supplemental.itemId, average: perMinute(average, 1 / g.supplemental.perMJ), peak: perMinute(peak, 1 / g.supplemental.perMJ) },
  }));
}
```

- [ ] **Step 4:** тесты — PASS; `pnpm typecheck` — PASS (импорт JSON уже используется в домене).

### Task 3: блок «Чем покрыть»

**Files:**
- Create: `apps/web/src/PowerCoverage.tsx`
- Modify: `apps/web/src/Results.tsx:79-80` (после `externalSources`, внутри `energy-panel`)
- Modify: `apps/web/src/styles.css` (таблица в общем стиле, без новых токенов)
- Test: `tests/ui/power-coverage.spec.ts`

**Interfaces:**
- Consumes: `powerCoverage` (Task 2), `model.averagePower`, `model.peakPower`, `settings.powerReserve`.
- Produces: `<PowerCoverage catalog average peak reserve />`.

- [ ] **Step 1: падающий UI-тест**

```ts
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createDefaultPlan } from '../../packages/domain/defaults';
import type { Catalog } from '../../packages/domain/types';
import { chooseMaximum } from './chooseVariant';

test.use({ baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5173' });
const catalog = JSON.parse(readFileSync(new URL('../../packages/game-data/catalog.json', import.meta.url), 'utf8')) as Catalog;
const plan = createDefaultPlan(catalog);
plan.mode = 'target';
plan.targets = [{ itemId: 'iron-ingot', rate: 30, weight: 1, scale: 1 }];
plan.sources = [{ id: 'iron', itemId: 'iron-ore', kind: 'flow', limit: 120, count: 1, purity: 1, minerId: 'miner-mk1', clock: 100 }];
plan.settings.enabledRecipeIds = ['iron-ingot'];
plan.settings.powerReserve = 10;

test('справка «Чем покрыть» показывает генераторы для средней мощности и пика с резервом', async ({ page }) => {
  await page.addInitScript(value => localStorage.setItem('ficsit-plan-v1', JSON.stringify(value)), plan);
  await page.goto('/');
  await page.getByRole('button', { name: 'Рассчитать', exact: true }).click();
  await chooseMaximum(page);
  const block = page.locator('.energy-panel details').filter({ hasText: 'Чем покрыть' });
  await block.locator('summary').click();
  await expect(block.getByRole('columnheader', { name: 'Пик + резерв' })).toBeVisible();
  await expect(block.getByRole('row', { name: /Угольный генератор/ })).toContainText('1');
  await expect(block).toContainText('Топливный генератор');
  await expect(block).toContainText('генерация не входит в оптимизацию');
});
```

- [ ] **Step 2:** `pnpm test:ui -- power-coverage` — FAIL.
- [ ] **Step 3: компонент**

```tsx
import type { Catalog } from '../../../packages/domain/types';
import { powerCoverage } from '../../../packages/domain/powerCoverage';
import { format, unit } from './controls';

export function PowerCoverage({ catalog, average, peak, reserve }: { catalog: Catalog; average: number; peak: number; reserve: number }) {
  const generators = powerCoverage(catalog, average, peak + reserve);
  if (!generators || average <= 0) return null;
  const item = (id: string) => catalog.items.find(i => i.id === id);
  const rate = (generatorId: string, r: CoverageRate) => <tr key={`${generatorId}:${r.itemId}`}><td>{item(r.itemId)?.name ?? r.itemId}</td><td>{format(r.average)} {unit(item(r.itemId))}</td><td>{format(r.peak)} {unit(item(r.itemId))}</td></tr>;
  return <details className="power-coverage"><summary>Чем покрыть</summary>
    <table><thead><tr><th>Генератор и топливо</th><th>Средняя</th><th>{reserve > 0 ? 'Пик + резерв' : 'Пик'}</th></tr></thead>
      <tbody>{generators.map(g => [<tr key={g.id} className="generator-row"><th scope="row">{g.name} · {format(g.power)} МВт</th><td>{g.average} шт.</td><td>{g.peak} шт.</td></tr>, ...g.fuels.map(f => rate(g.id, f)), ...(g.supplemental ? [rate(g.id, g.supplemental)] : [])])}</tbody></table>
    <p className="hint">Справка: генерация не входит в оптимизацию. Генераторы на 100% без усилителей; добычу топлива и воды план не включает.</p>
  </details>;
}
```

Импорт типа: `import { powerCoverage, type CoverageRate } from '../../../packages/domain/powerCoverage';`.

Вставка в `Results.tsx` после `model.externalSources.map(...)`:
`<PowerCoverage catalog={catalog} average={model.averagePower} peak={model.peakPower} reserve={reserve} />`.

- [ ] **Step 4:** CSS: `.power-coverage table { width: 100%; border-collapse: collapse }`, ячейки — существующие токены отступов; `.generator-row th { text-align: left }`. Проверить 390 px без горизонтального скролла.
- [ ] **Step 5:** UI-тест — PASS, снимки 1440/390 осмотрены. Изменения не коммитятся.

### Task 4: прогресс в `solveVariants` и worker

**Files:**
- Modify: `packages/solver/variants.ts:9,45-55`
- Modify: `apps/web/src/solver.worker.ts`
- Test: `tests/variants.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type VariantProgress = (report: ProductionVariants, pending: ProductionVariant['id'][]) => void;
  export interface VariantsMessage { report: ProductionVariants; pending: ProductionVariant['id'][]; done: boolean }
  solveVariants(catalog, input, highs, deadline?, onProgress?: VariantProgress): ProductionVariants
  ```

- [ ] **Step 1: падающий тест**

```ts
it('сообщает решённые варианты по одному, начиная с максимального', () => {
  const calls: { solved: string[]; pending: string[] }[] = [];
  const report = solveVariants(catalog, ingots(), highs, undefined, (partial, pending) => {
    calls.push({ solved: partial.variants.filter(v => !pending.includes(v.id)).map(v => v.id), pending: [...pending] });
  });
  expect(calls).toEqual([
    { solved: ['maximum'], pending: ['economy', 'resources', 'simple'] },
    { solved: ['maximum', 'economy'], pending: ['resources', 'simple'] },
    { solved: ['maximum', 'economy', 'resources'], pending: ['simple'] },
    { solved: ['maximum', 'economy', 'resources', 'simple'], pending: [] },
  ]);
  expect(report.variants[0].result.status).toBe('approximate');
});
it('не вызывает прогресс при некорректном плане', () => {
  const plan = ingots(); plan.targets = [];
  let calls = 0;
  solveVariants(catalog, plan, highs, undefined, () => { calls++; });
  expect(calls).toBe(0);
});
```

- [ ] **Step 2:** запуск — FAIL (callback не вызывается).
- [ ] **Step 3: реализация** — заменить строки 45–55:

```ts
  const ids = variants.map(v => v.id);
  const plans = [maximum, economy, resources, simple];
  const start = performance.now(), span = Math.max(0, deadline - start);
  for (const [index, variant] of variants.entries()) {
    variant.result = solve(catalog, plans[index]!, highs, index === variants.length - 1 ? deadline : start + span * (index + 1) / 4);
    variant.sameAs = variants.slice(0, index).find(other => !other.sameAs && equivalentResults(other.result, variant.result))?.id;
    const pending = ids.slice(index + 1);
    onProgress?.({ variants, equivalent: !pending.length && variants.slice(1).every(v => v.sameAs === 'maximum') }, pending);
  }
  return { variants, equivalent: variants.slice(1).every(v => v.sameAs === 'maximum') };
```

Комментарий о переходе неиспользованного времени сохраняется над циклом. Если пустой `plan.targets` проходит `parsePlan`, взять другой некорректный вход (например `plan.settings.clock = -1`), проверив его отказ в `parsePlan`.

- [ ] **Step 4: worker**

```ts
self.onmessage = async (event: MessageEvent<{ catalog: Catalog; plan: Plan }>) => {
  const post = (message: VariantsMessage) => self.postMessage(message);
  try {
    const report = solveVariants(event.data.catalog, event.data.plan, await highs, performance.now() + 25000, (partial, pending) => { if (pending.length) post({ report: partial, pending, done: false }); });
    post({ report, pending: [], done: true });
  }
  catch (error) { post({ report: { equivalent: false, variants: [{ id: 'maximum', label: 'Расчёт недоступен', plan: event.data.plan, result: emptyResult('error', error instanceof Error ? error.message : 'Ошибка загрузки решателя.') }] }, pending: [], done: true }); }
};
```

`postMessage` клонирует отчёт синхронно, поэтому последующие мутации `variants` не затрагивают отправленное.
- [ ] **Step 5:** `pnpm vitest run tests/variants.test.ts tests/simpler-build.test.ts tests/scarcity-alternates.test.ts` — PASS; `pnpm typecheck` — FAIL допустим до Task 5 только в `useSolver.ts` (тип сообщения), иначе исправить.

### Task 5: `useSolver` и карточки

**Files:**
- Modify: `apps/web/src/useSolver.ts`
- Modify: `apps/web/src/ProductionVariants.tsx:29-31,41,65-88`
- Modify: `apps/web/src/styles.css` (плашка `.status-badge.pending`, если нет подходящей)
- Test: `tests/ui/variants.spec.ts`

**Interfaces:**
- Consumes: `VariantsMessage` (Task 4).
- Produces: `useSolver` дополнительно возвращает `pending: ProductionVariant['id'][]`.

- [ ] **Step 1: падающие UI-тесты** (план `plan` из файла, ~10 с на четыре варианта)

```ts
test('основной вариант выбирается до конца расчёта, остальные дорешиваются в фоне', async ({ page }) => {
  await page.addInitScript(value => { if (!localStorage.getItem('seeded')) { localStorage.setItem('ficsit-plan-v1', JSON.stringify(value)); localStorage.setItem('seeded', '1'); } }, plan);
  await page.goto('/');
  await page.getByRole('button', { name: 'Рассчитать', exact: true }).click();
  const maximum = page.getByRole('article', { name: 'Максимальный выпуск', exact: true });
  await maximum.getByRole('button', { name: 'Использовать вариант', exact: true }).click({ timeout: 30000 });
  await expect(page.getByRole('button', { name: 'Отменить расчёт' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Максимальный выпуск', exact: true })).toBeVisible();
  await expect(page.locator('.results-column .spinner')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Отменить расчёт' })).toHaveCount(0, { timeout: 30000 });
  await page.getByRole('button', { name: 'Вернуться к вариантам', exact: true }).click();
  await expect(page.getByText('Считается…')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Использовать вариант', exact: true }).first()).toBeEnabled();
});

test('нерешённые варианты после отмены помечены отдельно, решённый остаётся выбираемым', async ({ page }) => {
  await page.addInitScript(value => localStorage.setItem('ficsit-plan-v1', JSON.stringify(value)), plan);
  await page.goto('/');
  await page.getByRole('button', { name: 'Рассчитать', exact: true }).click();
  const maximum = page.getByRole('article', { name: 'Максимальный выпуск', exact: true });
  await expect(maximum.getByRole('button', { name: 'Использовать вариант', exact: true })).toBeEnabled({ timeout: 30000 });
  await expect(page.getByText('Считается…').first()).toBeVisible();
  await expect(page.getByText('Подбор завершён без доступного варианта')).toHaveCount(0);
  await page.getByRole('button', { name: 'Отменить расчёт' }).click();
  await expect(page.getByText('Не рассчитан').first()).toBeVisible();
  await maximum.getByRole('button', { name: 'Использовать вариант', exact: true }).click();
  await expect(page.locator('.kpi').first()).toContainText('8,888');
});

test('правка плана после раннего выбора останавливает фоновые варианты', async ({ page }) => {
  await page.addInitScript(value => localStorage.setItem('ficsit-plan-v1', JSON.stringify(value)), plan);
  await page.goto('/');
  await page.getByRole('button', { name: 'Рассчитать', exact: true }).click();
  await page.getByRole('article', { name: 'Максимальный выпуск', exact: true }).getByRole('button', { name: 'Использовать вариант', exact: true }).click({ timeout: 30000 });
  await page.getByRole('button', { name: 'Цели и ограничения' }).click();
  await page.getByLabel('Резерв сети').fill('5');
  await expect(page.getByRole('button', { name: 'Отменить расчёт' })).toHaveCount(0);
});
```

Точное имя кнопки перехода к экрану целей сверить в `App.tsx` перед запуском.

Уточнено при реализации 2026-10-22: этот план решается за 1–2 с, а не за ~10 с,
поэтому промежуточное состояние ловится нестабильно. Три новых сценария вызывают
`holdLaterVariants(page)` до `page.goto`: маршрут подменяет скрипт worker и
задерживает все его сообщения после первого на 4 с; решатель и хук не
подменяются. Прежний сценарий «Проще построить» после «Рассчитать» ждёт возврата
кнопки «Рассчитать»: карточка видна до конца расчёта.

- [ ] **Step 2:** `pnpm test:ui -- variants` — новые тесты FAIL.
- [ ] **Step 3: `useSolver`**

```ts
  const [pending, setPending] = useState<ProductionVariant['id'][]>([]);
  const acceptedInput = useRef<string | null>(null);
  const live = (input: string) => input === requestInput.current || input === acceptedInput.current;
  useEffect(() => {
    if (worker.current && !live(fingerprint)) { stop(); setRunning(false); setError('Настройки изменились. Запустите подбор вариантов заново.'); }
  }, [fingerprint, stop]);
  // calculate: дополнительно setPending([]); acceptedInput.current = null;
      instance.onmessage = (event: MessageEvent<VariantsMessage>) => {
        if (worker.current !== instance) return;
        if (!live(currentInput.current)) { setError('Настройки изменились. Запустите подбор вариантов заново.'); setRunning(false); stop(); return; }
        setReport(event.data.report); setPending(event.data.pending);
        if (acceptedInput.current === null) setSolvedInput(fingerprint);
        if (event.data.done) { setRunning(false); stop(); }
      };
  const choose = (id: ProductionVariant['id']): Plan | null => {
    if (currentInput.current !== solvedInput) return null;
    const variant = report?.variants.find(v => v.id === id);
    if (!variant || !hasSolution(variant.result)) return null;
    const next = structuredClone(variant);
    const input = JSON.stringify(next.plan);
    if (running) acceptedInput.current = input;
    setSelected(next); setChoosing(false); setSolvedInput(input);
    return next.plan;
  };
  const failure = !running && report?.variants.filter(v => !pending.includes(v.id)).every(v => !hasSolution(v.result)) ? report.variants[0] : null;
  // return: + pending
```

`pending` после остановки не очищается: так карточки знают, какие варианты не рассчитаны. Нерешённый вариант выбрать нельзя и после остановки (его результат — заглушка `timeout`, `hasSolution` = false).

- [ ] **Step 4: `ProductionVariants`**
  - `const { report, selected, choosing, stale, running, error, pending } = solver;`
  - `hasVariants` — по решённым вариантам; текст статуса: `running ? 'Варианты появляются по мере готовности.' : stale ? … : hasVariants ? … : …`; при `running` блок `!hasVariants && <Results …>` не показывается.
  - Заголовок: `showCards || running && !selected ? 'Варианты производства' : …`.
  - Карточка с `pending.includes(variant.id)`: плашка `<span className="status-badge pending">{running ? 'Считается…' : 'Не рассчитан'}</span>`, вместо метрик — `<p className="hint">{running ? 'Вариант ещё решается.' : error ?? 'Расчёт остановлен.'}</p>`.
  - Кнопка выбора: `disabled={stale}` (без `running`).
  - Подробный план: `running={running && !selected}`, `error={selected ? null : error}`.
- [ ] **Step 5:** UI-тесты `variants`, затем весь `pnpm test:ui` — PASS (проверить, что `chooseMaximum` в остальных сценариях выбирает раньше и ожидания не ломаются). Изменения не коммитятся.

### Task 6: документация и проверки

**Files:**
- Modify: `AGENTS.md` (инварианты: справка генераторов; прогресс вариантов и ранний выбор)
- Modify: `docs/STATUS.md` (раздел этапа 4, проверки, следующий шаг)
- Modify: `docs/plans/2026-10-03-mid-game-roadmap.md:84-85` (отметки `[x]`)

- [ ] **Step 1:** AGENTS.md после абзаца о подборе вариантов: «Варианты решаются по очереди; worker отправляет частичный отчёт после каждого `{ report, pending, done }`. Решённый вариант выбирается до конца расчёта; worker продолжает, пока план равен входу запроса или принятому снимку этого запроса. Справка «Чем покрыть» — `powerCoverage` по `power-generators.json` (угольный и топливный генераторы из Docs, жидкости ×1000 на м³); генерация в оптимизацию не входит, генераторы на 100%.» Каждое утверждение сверить с `file:line`.
- [ ] **Step 2:** STATUS: раздел этапа 4 с результатами прогона и непроверенным.
- [ ] **Step 3:** `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm test:ui` — PASS; итог в STATUS.
