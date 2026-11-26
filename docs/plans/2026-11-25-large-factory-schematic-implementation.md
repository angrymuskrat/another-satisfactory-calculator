# Схема больших заводов — план реализации (этап 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** схема завода на 100–250 машин читается целиком и служит планом
строительства: плотная раскладка ELK, узел в двух видах, связи без условных блоков,
боковая панель, мини-карта и поиск.

**Architecture:** `buildSchematic` перестаёт создавать условные узлы и вид по
отдельным зданиям. Средняя раскладка считается ELK layered в Web Worker.
Близкая раскладка выводится из средней чистой функцией растяжения. Ручные
позиции хранятся в координатах средней раскладки. Полотно, навигация, отметки
и готовность остаются своими и переиспользуются.

**Tech Stack:** TypeScript, React 19, Vite 7, Vitest, Playwright, `elkjs` (EPL-2.0).

**Spec:** [2026-11-25-large-factory-schematic-design.md](2026-11-25-large-factory-schematic-design.md)

Этап 2 (энергомодули на узле) — отдельный план после приёмки этого этапа.

## Global Constraints

- Ветка `claude/large-factory-schematic`. **Не коммитить и не пушить без прямой просьбы пользователя** (CLAUDE.local.md §1); шаги «Commit» в этом плане отсутствуют намеренно.
- Числа на узлах и связях берутся из перепроверенной `ConstructionModel`; представление не меняет расчёт.
- Порог 0,01% (`SCHEMATIC_MIN_FLOW_SHARE`) для непроверенных потоков сохраняется; к проверенным конвейерным связям не применяется.
- Скрытая миграция запрещена: новые ключи хранения версионируются, старые записи не переписываются и не удаляются.
- Мощность узла — сумма МВт его конфигураций (`averagePower`), без пересчёта из средней частоты.
- Размеры узлов фиксированы: средний `200×56`; близкий шириной `250`, высота по `closeNodeSize`.
- Порог близкого вида — масштаб `1` (100%). Минимальный масштаб — «Уместить весь завод», но не меньше `0.1`.
- Текст интерфейса — на русском; идентификаторы кода — на английском; плотность комментариев как в окружающем коде.

## Review Focus

1. Граф с циклом и самопетлёй (возвратная вода, переработка остатков) — ELK не падает, обратная связь рисуется отдельным стилем, узлы цикла остаются в своих слоях. Тест — задача 3.
2. Включённый учёт конвейеров — настоящие разделители и соединители остаются узлами, каждая физическая лента нарисована ровно один раз. Тест — задача 1.
3. Сохранённые ручные позиции v1 и позиции узла, которого больше нет в графе, — игнорируются без ошибки и без перезаписи v1. Тест — задача 4.
4. Ошибка загрузки или выполнения ELK (worker не стартовал, исключение) — явное сообщение «Не удалось разложить схему», инструкция доступна, повторное открытие пробует снова. Тест — задача 3 (чистая часть) и задача 7 (UI).
5. Пустой граф и граф из одного источника и одного продукта — раскладка без NaN, «Уместить» не делит на ноль. Тест — задача 3.

---

### Task 1: Связи без условных блоков, без вида по отдельным зданиям

**Files:**
- Modify: `packages/domain/schematic.ts` (режимы, ветка junction, пагинация)
- Modify: `packages/domain/constructionProgress.ts:50-141` (убрать `page` и `pageSize`)
- Test: `tests/schematic.test.ts`, `tests/routed-schematic.test.ts`

**Interfaces:**
- Produces: `type SchematicMode = 'types'`; `buildSchematic(catalog, model, destinations, mode: SchematicMode | 'configurations'): SchematicModel` — без параметра `requestedPage` и без полей `page`/`pages` в результате; `SchematicNode['kind']` без `'continuation'`; `'merge' | 'split'` остаются только для `routingDepth !== undefined`. `constructionDependencies(graph: SchematicModel)`; `MissingSupply` без `page`. `SCHEMATIC_PAGE_SIZE` удалён.

- [ ] **Step 1: Переписать тесты домена под новый контракт**

В `tests/schematic.test.ts`:
```ts
it('в групповом виде без учёта конвейеров соединяет поставщиков с потребителями напрямую', () => {
  // два поставщика 'ingot' (60 + 40) и два потребителя (70 + 30), как в существующей фикстуре group()
  const graph = buildSchematic(catalog, m, destinations, 'types');
  expect(graph.nodes.some(n => n.kind === 'merge' || n.kind === 'split')).toBe(false);
  const ingot = graph.edges.filter(e => e.itemId === 'ingot');
  expect(ingot.reduce((s, e) => s + e.rate, 0)).toBeCloseTo(100);
  for (const e of ingot) expect(graph.nodes.find(n => n.id === e.from)!.kind).not.toMatch(/merge|split/);
});
```
Удалить тесты пагинации (`SCHEMATIC_PAGE_SIZE + 2`, `continuation`) и заменить `'machines'` на `'types'` или `'configurations'` там, где тест проверяет потоки, а не страницы. В `tests/routed-schematic.test.ts` оставить `it.each(['types'])`, удалить проверки страниц (строки 57–83 по `a374b8f`) и добавить:
```ts
it('при учёте конвейеров рисует каждую физическую ленту один раз в групповом виде', () => {
  const graph = buildSchematic(catalog, model, destinations, 'types');
  const physical = graph.edges.filter(e => e.physicalRouting);
  expect(physical).toHaveLength(model.beltRouting!.networks.reduce((s, n) => s + n.edges.length, 0));
  expect(graph.nodes.filter(n => n.routingDepth !== undefined).length).toBeGreaterThan(0);
});
```
Удалённые и изменённые `expect` перечислить в описании будущего PR с причиной «вид по отдельным зданиям удалён по дизайну».

- [ ] **Step 2:** `pnpm vitest run tests/schematic.test.ts tests/routed-schematic.test.ts` — ожидается FAIL на новых тестах (merge/split присутствуют).

- [ ] **Step 3: Реализовать**

В `buildSchematic` ветка прямого распределения (`if (mode !== 'types')`) выполняется для всех режимов; ветка `junction` удаляется. Параметр `parallel` в групповом виде остаётся `parallelLines(rate, capacity)`, развёртка на отдельные ленты по 120 — только в бывшем режиме `machines`, она удаляется вместе с ним. В `constructionDependencies` убрать `pageSize` и вычисление `page`.

- [ ] **Step 4:** тот же прогон — PASS; затем `pnpm typecheck` — ошибки только в `apps/web/src/Schematic.tsx`/`Construction.tsx` (их чинит задача 7, до неё допускается временная заглушка вызова без страниц).

### Task 2: Подключить ELK и описать вход/выход раскладки

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml` (`elkjs` в `dependencies`)
- Create: `apps/web/src/schematicElk.ts`
- Modify: `THIRD_PARTY_NOTICES.md` (раздел elkjs: автор, EPL-2.0, ссылка на лицензию)
- Test: `tests/schematic-elk.test.ts`

**Interfaces:**
- Produces:
  - `MEDIUM_NODE: Size = { width: 200, height: 56 }`
  - `toElkGraph(graph: SchematicModel): ElkNode` — корень с `layoutOptions` `elk.algorithm=layered`, `elk.direction=RIGHT`, `elk.edgeRouting=ORTHOGONAL`, `elk.layered.considerModelOrder.strategy=NODES_AND_EDGES`, `elk.portConstraints=FIXED_SIDE`; порт на предмет: входы `WEST`, выходы `EAST`; узлы в порядке `stage`, затем `id`.
  - `fromElkLayout(graph: SchematicModel, laid: ElkNode): SchematicLayout & { bends: Record<string, Point[]> }`
  - `layoutWithElk(graph: SchematicModel): Promise<SchematicLayout & { bends: Record<string, Point[]> }>` — использует `elkjs/lib/elk.bundled.js` напрямую (работает в Node для тестов).

- [ ] **Step 1: Тесты** (`tests/schematic-elk.test.ts`, граф `graph()` из `tests/schematic-layout.test.ts` вынести в общий `tests/schematicFixtures.ts`):
```ts
it('раскладывает слева направо без наложений и детерминированно', async () => {
  const a = await layoutWithElk(g), b = await layoutWithElk(g);
  expect(a).toEqual(b);
  for (const e of g.edges) expect(a.rects[e.from].x).toBeLessThan(a.rects[e.to].x);
  expectNoOverlap(a.rects);            // helper в schematicFixtures.ts
});
it('раскладывает пустой граф и граф из двух узлов без NaN', async () => {
  expect(await layoutWithElk({ ...g, nodes: [], edges: [] })).toMatchObject({ width: expect.any(Number) });
  const two = await layoutWithElk(twoNodeGraph());
  expect(Object.values(two.rects).flatMap(r => [r.x, r.y]).every(Number.isFinite)).toBe(true);
});
it('раскладывает цикл с самопетлёй', async () => {
  const laid = await layoutWithElk(cycleGraph());   // a→b→a и c→c
  expectNoOverlap(laid.rects);
  expect(Object.keys(laid.rects)).toHaveLength(cycleGraph().nodes.length);
});
```
- [ ] **Step 2:** `pnpm vitest run tests/schematic-elk.test.ts` — FAIL (модуля нет).
- [ ] **Step 3:** установить `elkjs`, реализовать три функции. Размер узла — всегда `MEDIUM_NODE`; `bends` — точки `sections[].bendPoints` в абсолютных координатах.
- [ ] **Step 4:** тот же прогон — PASS; `pnpm typecheck` — без новых ошибок в `schematicElk.ts`.

### Task 3: Раскладка в worker и приёмка на большом заказе

**Files:**
- Create: `apps/web/src/schematicLayout.worker.ts`, `apps/web/src/useSchematicLayout.ts`
- Test: `tests/schematic-elk.test.ts` (дополнить), `tests/schematic-large.test.ts`

**Interfaces:**
- Consumes: `layoutWithElk` (задача 2).
- Produces: `useSchematicLayout(graph: SchematicModel): { status: 'pending' } | { status: 'ready'; layout: MediumLayout } | { status: 'error'; message: string }`, где `MediumLayout = SchematicLayout & { bends: Record<string, Point[]> }`. Worker создаётся как `new Worker(new URL('./schematicLayout.worker.ts', import.meta.url), { type: 'module' })`, кеш по ссылке на `graph`. Сообщение ошибки — `'Не удалось разложить схему.'`.

- [ ] **Step 1: Приёмочный тест** `tests/schematic-large.test.ts`: решить `largeOrder(catalog)` через `findWorkingPlans(catalog, plan, highs, performance.now() + 60_000, publish)`, взять вариант с `id === 'machines'`, `buildConstruction`, `buildSchematic(..., 'types')`, `filterSchematicFlows`, `layoutWithElk`.
```ts
expect(graph.nodes.filter(n => n.kind === 'merge' || n.kind === 'split')).toHaveLength(0);
expect(layout.width * layout.height).toBeLessThanOrEqual(0.15 * 10340 * 22217);
expectNoOverlap(layout.rects);
expectEdgesAvoidNodes(graph, layout);   // ни один отрезок bends не пересекает чужой прямоугольник
```
Тайм-аут теста — 120 с.
- [ ] **Step 2:** прогон — FAIL, пока нет `expectEdgesAvoidNodes` и worker-обвязки; при FAIL по площади — подобрать `elk.spacing.nodeNode` и `elk.layered.spacing.nodeNodeBetweenLayers` в `toElkGraph`, не меняя тест.
- [ ] **Step 3:** реализовать worker (принимает `SchematicModel`, отвечает `MediumLayout` или `{ error }`) и хук; ленивый импорт ELK только внутри worker.
- [ ] **Step 4:** `pnpm vitest run tests/schematic-elk.test.ts tests/schematic-large.test.ts` — PASS.

### Task 4: Близкая раскладка, ручные позиции v2, якорь масштаба

**Files:**
- Modify: `apps/web/src/schematicLayout.ts` (удалить `layoutSchematic` DFS и `shortenConnections`; добавить функции ниже)
- Modify: `apps/web/src/SchematicPosition.tsx` (ключ v2)
- Test: `tests/schematic-layout.test.ts`

**Interfaces:**
- Consumes: `MediumLayout`, `MEDIUM_NODE`.
- Produces:
  - `closeNodeSize(node: SchematicNode): Size` — ширина 250; высота `= 64 + 18 * (node.inputs.length + node.outputs.length) + (node.parts?.length ? 30 : 0)`.
  - `expandLayout(medium: MediumLayout, sizes: Record<string, Size>): MediumLayout` — x × `(250 + G) / (200 + G)`, где `G` — фактический зазор между колонками средней раскладки; затем проход сверху вниз со сдвигом ниже пересекающейся по x карточки с зазором 24; точки `bends` переводятся тем же x-множителем, а y — смещением ближайшего сверху узла той же колонки.
  - `zoomAnchor(before: SchematicLayout, after: SchematicLayout, nodeId: string, pointer: Point, zoomBefore: number, zoomAfter: number): { scrollLeft: number; scrollTop: number }` — экранное положение `nodeId` до и после совпадает.
  - `useSchematicPositions` использует ключ `'satisfactory:schematic-layout:v2:' + JSON.stringify([scope, mode])`.

- [ ] **Step 1: Тесты**
```ts
it('растягивает среднюю раскладку без наложений и сохраняет порядок в колонке', () => {
  const close = expandLayout(medium, closeSizes);
  expectNoOverlap(close.rects);
  for (const column of columnsOf(medium)) expect(orderY(close, column)).toEqual(orderY(medium, column));
});
it('ручная позиция одна на оба уровня', () => {
  const moved = placeSchematicNodes(medium, { b: { x: 900, y: 400 } });
  expect(expandLayout(moved, closeSizes).rects.b.x).toBeCloseTo(900 * ratio);
});
it('оставляет узел под курсором на месте при переходе через 100%', () => {
  const s = zoomAnchor(medium, close, 'b', { x: 300, y: 200 }, 0.9, 1);
  const screenBefore = medium.rects.b.x * 0.9 - scrollBefore.scrollLeft;
  expect(Math.abs(close.rects.b.x * 1 - s.scrollLeft - screenBefore)).toBeLessThanOrEqual(4);
});
it('игнорирует позиции v1 и позиции исчезнувших узлов, не трогая v1', () => { /* localStorage-заглушка vitest */ });
```
- [ ] **Step 2:** прогон `tests/schematic-layout.test.ts` — FAIL.
- [ ] **Step 3:** реализовать; старые тесты DFS-раскладки удалить (перечислить в описании PR), тест `placeFlowLabels` сохранить.
- [ ] **Step 4:** прогон — PASS.

### Task 5: Узел в двух видах и связи по предметам

**Files:**
- Create: `apps/web/src/SchematicNodeCard.tsx`, `apps/web/src/schematicColors.ts`
- Modify: `apps/web/src/schematic.css`
- Test: `tests/schematic-colors.test.ts`, `tests/ui/schematic.spec.ts`

**Interfaces:**
- Consumes: `closeNodeSize`, `builtCount`, `markBuilt` (`constructionProgress.ts`).
- Produces: `SchematicNodeCard({ node, level: 'medium' | 'close', progress, built, mark, selected, onSelect })`; `itemColor(itemId: string, fluid: boolean): string` — стабильный цвет из палитры 10 оттенков по хешу `itemId`, жидкости — голубая гамма; ширина линии жидкости 3, твёрдых 2.

Содержание узла:
- средний: `×{count} {здание}` (для дробного числа машин из расчёта — как сейчас), рецепт; рамка `ready`/`waiting`/`built` по `progress`;
- близкий: то же + частота (или «Средняя частота» при разных), входы и выходы «предмет · расход», `⚡ {сумма МВт}`, флажок и «Построено N из M».

- [ ] **Step 1:** `tests/schematic-colors.test.ts` — один `itemId` даёт один цвет между вызовами; 10 разных предметов дают не меньше 8 разных цветов; жидкость и твёрдый с тем же id различаются.
- [ ] **Step 2:** UI-тест в `tests/ui/schematic.spec.ts`: при масштабе 90% узел не содержит «⚡», после «+» до 100% содержит «⚡» и «Построено»; флажок в близком узле меняет счётчик в «Инструкции».
- [ ] **Step 3:** реализовать. Линия связи — ломаная «порт поставщика → `bends` → порт потребителя» из текущей раскладки; если хотя бы один конец сдвинут вручную, маршрут берётся из `routeSchematicEdges`. Связь, у которой потребитель левее поставщика (обратная в цикле), получает класс `back` (штрих). Ярлык связи — иконка предмета, расход и `×{parallel}` при `parallel > 1`, ставится у входа потребителя через `placeFlowLabels` (точка `at` — 40 px левее порта).
- [ ] **Step 4:** `pnpm vitest run tests/schematic-colors.test.ts` и `pnpm test:ui -- tests/ui/schematic.spec.ts` — PASS.

### Task 6: Полотно на всю высоту, панель, мини-карта, поиск

**Files:**
- Create: `apps/web/src/SchematicMinimap.tsx`, `apps/web/src/schematicSearch.ts`
- Modify: `apps/web/src/Schematic.tsx`, `apps/web/src/schematic.css`, `apps/web/src/useSchematicNavigation.ts` (нижний предел масштаба)
- Test: `tests/schematic-search.test.ts`, `tests/ui/schematic.spec.ts`

**Interfaces:**
- Produces: `findNodes(graph: SchematicModel, catalog: Catalog, query: string): string[]` — регистронезависимо по названию здания, рецепта и предметов входа/выхода, порядок — по `x`, затем `y` текущей раскладки (передаётся вторым массивом id); `SchematicMinimap({ layout, viewport, zoom, onMove })`.

Экран: строка управления (масштаб, «Уместить», поле поиска, «Подсветить: можно строить» — существующий `readyOnly`, «На весь экран», «?»); полотно `height: calc(100dvh - <высота шапки>)`; правая панель 280 px с содержимым нынешнего `.schematic-details` и списком «Нужны поставщики»; «Как читать схему» и «Численные остатки» — под полотном свёрнутыми; режим «Только схема» и подсказка под полотном удаляются (текст подсказки переезжает в «?»). При ширине окна меньше 720 px панель становится нижним листом высотой до 50dvh.

- [ ] **Step 1:** `tests/schematic-search.test.ts` — «литей» находит литейную; «кабель» находит конструктор кабеля и потребителей кабеля; пустая строка — пустой список.
- [ ] **Step 2:** UI-тесты: «Уместить» на 1440×900 — все `[data-node-id]` внутри видимой области; Enter в поиске выделяет узел и прокручивает к нему; щелчок по мини-карте меняет `scrollLeft/scrollTop`; полотно выше 600 px при окне 900; на пресете 390×844 выбор узла открывает нижний лист, полотно остаётся прокручиваемым.
- [ ] **Step 3:** реализовать.
- [ ] **Step 4:** `pnpm vitest run tests/schematic-search.test.ts` и `pnpm test:ui -- tests/ui/schematic.spec.ts` — PASS.

### Task 7: Интеграция в «Построить», ошибки раскладки, документы

**Files:**
- Modify: `apps/web/src/Construction.tsx` (переключатель «Инструкция» / «Схема»), `apps/web/src/Schematic.tsx` (состояния `useSchematicLayout`)
- Modify: `docs/construction-schematics.md`, `AGENTS.md`, `docs/STATUS.md`
- Test: `tests/ui/schematic.spec.ts`, `tests/ui/construction.spec.ts`

- [ ] **Step 1:** UI-тесты: переключатель содержит ровно «Инструкция» и «Схема»; пока раскладка считается — «Раскладываю схему…»; при подменённом через `page.route` чанке worker с ошибкой — «Не удалось разложить схему.», вкладка «Инструкция» работает; переход к поставщику из «Нужны поставщики» выделяет узел без смены страницы.
- [ ] **Step 2:** прогон — FAIL.
- [ ] **Step 3:** реализовать; обновить `docs/construction-schematics.md` (разделы «По типам зданий», «По отдельным зданиям» — удалить, «UI и границы первой версии», раскладка ELK, две раскладки, ключ позиций v2), инварианты схемы в AGENTS.md, запись в `docs/STATUS.md` с замерами до/после.
- [ ] **Step 4:** полный прогон по разделу 4 CLAUDE.local.md: `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm test:ui` — PASS; размер чанка ELK из вывода `pnpm build` записать в STATUS.
