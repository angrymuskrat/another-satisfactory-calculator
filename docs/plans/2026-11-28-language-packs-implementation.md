# Языковые пакеты и этап 4 «Язык и голос»: план реализации

> **Исполнителям:** план выполняется по задачам через
> `superpowers:subagent-driven-development`. Шаги отмечаются флажками `- [ ]`.
> Субагенты не коммитят: коммит, push и PR делает координатор и только
> по прямой просьбе пользователя (`local/AGENTS.local.md`).

**Цель:** интерфейс и названия из игры показываются на выбранном языке
(русский, английский), третий язык добавляется пакетом; этап 4 редизайна
правит уже вынесенный русский пакет.

**Архитектура:** пакет интерфейса — TypeScript-модуль на язык, английский
имеет тип русского. Названия из игры — сгенерированные словари `id → название`
на язык рядом с неизменным каталогом. Ядро возвращает код и параметры
сообщения, фразу собирает интерфейс.

**Стек:** TypeScript, React 19, Vite, Fastify/SQLite, Vitest, Playwright 1.63;
новых зависимостей нет.

**Спецификация:** `docs/plans/2026-11-28-language-packs-design.md`; этап 4 —
`docs/plans/2026-11-26-ui-redesign-implementation.md`, раздел «Этап 4».

## Глобальные ограничения

- До PR B видимое поведение не меняется: тексты, `lang="ru"`, формат чисел
  `ru-RU`. PR A1 и A2 принимаются попиксельной заморозкой
  `tests/ui/visual-freeze.spec.ts` (`VISUAL_FREEZE=1`) на 1920 и 390 px.
- `packages/game-data/catalog.json` и его `version` не меняются;
  после импорта `git diff --stat packages/game-data/catalog.json` пуст.
- Идентификатор категории — прежняя русская строка.
- Запасной порядок названия: выбранный язык → английский → `name` каталога.
- Ключ выбора языка: `planovy-otdel:locale:v1`.
- Поле `locale` в workspace необязательно; отсутствие — «не выбрано»;
  данные при загрузке не переписываются; схема SQLite не меняется.
- Параметры сообщений ядра — числа, введённые пользователем строки, ссылки
  `{ ref, id }` и вложенные сообщения; готовых названий из каталога в них нет.
- Английские названия из игры — только из данных той же сборки; ручной
  перевод помечается в `overrides.json` и `audit-report.json`.
- Sankey не добавлять; правила комментариев и тестов — по `AGENTS.md`
  (тест проверяет наблюдаемый результат, а не текст исходника).
- Удалённые тесты и ослабленные `expect` перечисляются в описании PR.
- Среда: Docker-контейнер `asc-dev`; `sh output/serve.sh`, `sh output/ui.sh
  <имя> [аргументы]`; Vitest не запускается одновременно с Playwright.

## Фокус ревью

1. **Сохранённый язык неизвестен** (`'de'`, `''`, мусор): берётся язык
   браузера или запасной, ключ не переписывается.
2. **Названия нет в словаре** (идентификатор новее словаря, язык без файла
   названий): показывается английское, затем `name` каталога; никогда
   `undefined` или голый идентификатор.
3. **Незнакомый код сообщения** (вкладка старее сервера, API без `code`):
   показывается поле `error` или общий текст с кодом; интерфейс не падает.
4. **Workspace без `locale` и чужой файл с `locale`:** старый читается как
   раньше; импорт файла не меняет язык импортирующего.
5. **Ввод чисел при английском языке:** поля принимают и `7.5`, и `7,5`
   на обоих языках; язык меняет только показ.

---

# PR A1. Каркас и интерфейс

Ветка `claude/i18n-a1-packs` от вершины ветки этапа 3 (или от `master`,
если PR этапа 3 уже слит).

## Задача 1.1. Каркас пакетов

**Файлы:**
- Создать: `apps/web/src/i18n/locales.ts`, `apps/web/src/i18n/plural.ts`,
  `apps/web/src/i18n/ru.tsx`, `apps/web/src/i18n/index.tsx`
- Изменить: `apps/web/src/main.tsx` (обернуть `<App />` в `LocaleProvider`)
- Тест: `tests/i18n.test.ts`

**Интерфейсы (создаёт):**
- `type LocaleId = 'ru'`; `LOCALES: readonly { id: LocaleId; label: string;
  tag: string }[]` = `[{ id: 'ru', label: 'Русский', tag: 'ru-RU' }]`
- `LOCALE_KEY = 'planovy-otdel:locale:v1'`
- `detectLocale(languages: readonly string[], stored: string | null,
  available: readonly string[]): string` — сохранённый, если он есть
  в `available`; иначе первый язык браузера, чей основной подтег есть
  в `available`; иначе `'en'`, если он есть, иначе `available[0]`.
- `plural(tag: string, count: number, forms: { one?: string; few?: string;
  many?: string; other: string }): string`
- `ru` — объект пакета; `type Messages = typeof ru`.
- `LocaleProvider`, `useT(): Messages`,
  `useLocale(): { id: LocaleId; tag: string; set(id: LocaleId): void }`
- `activeLocale(): { id: LocaleId; tag: string }` — для чистых функций
  (`format`, `normalize`, `gameName`); компоненты перерисовываются через контекст.

- [ ] **Шаг 1. Падающие тесты** в `tests/i18n.test.ts`:
  - `detectLocale(['en-GB','ru'], null, ['ru','en'])` → `'en'`;
  - `detectLocale(['ru-UA'], null, ['ru','en'])` → `'ru'`;
  - `detectLocale(['de'], null, ['ru','en'])` → `'en'`;
  - `detectLocale(['de'], null, ['ru'])` → `'ru'`;
  - `detectLocale([], null, ['ru','en'])` → `'en'`;
  - `detectLocale(['en'], 'ru', ['ru','en'])` → `'ru'`;
  - (фокус 1) `detectLocale(['ru'], 'de', ['ru','en'])` → `'ru'`,
    то же для `''` и `'<script>'`;
  - `plural('ru-RU', n, { one: 'машина', few: 'машины', many: 'машин',
    other: 'машины' })` для 1, 2, 5, 21, 0, 1.5 → «машина», «машины», «машин»,
    «машина», «машин», «машины»;
  - `plural('en-US', 1, { one: 'machine', other: 'machines' })` → `machine`,
    для 0 и 2 → `machines`.
- [ ] **Шаг 2.** `pnpm exec vitest run tests/i18n.test.ts` — падают.
- [ ] **Шаг 3.** Реализовать модули. Провайдер читает `LOCALE_KEY`
  и `navigator.languages`, выставляет `document.documentElement.lang`.
  `set` пишет ключ. В A1 `available` = `['ru']`.
- [ ] **Шаг 4.** Тесты проходят; `pnpm typecheck` чистый.

## Задача 1.2. Словари названий из игры

**Файлы:**
- Создать: `scripts/import-locales.mjs`, `packages/game-data/locales/ru.json`,
  `packages/game-data/locales/en.json` (генерируются),
  `apps/web/src/i18n/gameNames.ts`
- Изменить: `scripts/import-game-data.mjs` (вызов последним шагом: скрипт читает
  `power-generators.json`),
  `packages/game-data/README.md`
- Тест: `tests/game-locales.test.ts`

**Интерфейсы (создаёт):**
- `type GameKind = 'item' | 'recipe' | 'building' | 'miner' | 'belt' | 'pipe'
  | 'category' | 'schematic' | 'researchTree' | 'gamePhase' | 'generator'`
- `type GameNames = Record<GameKind, Record<string, string>>`
- `gameName(kind: GameKind, id: string, fallback: string, locale?: string): string`
- `registerGameNames(locale: string, names: GameNames): void`

- [ ] **Шаг 1. Падающие тесты:**
  - у каждого `id` из `catalog.items/recipes/buildings/miners/belts/pipes`,
    каждой строки `catalog.categories`, каждой схемы `progression.schematics`
    с названием в данных игры, `researchTrees`, `gamePhases` и генератора
    есть непустая запись
    в `ru.json` и в `en.json`;
  - `ru.json` совпадает с `name` каталога для предметов, рецептов, зданий;
    `en.json` — с `nameEn`;
  - `ru.json.category[x] === x` для каждой категории;
  - в `en.json` нет кириллицы;
  - (фокус 2) `gameName('item', 'нет-такого', 'Запасное')` → `'Запасное'`;
    при активном языке без зарегистрированного словаря
    `gameName('item', 'iron-plate', 'Железная пластина')` → `'Iron Plate'`.
- [ ] **Шаг 2.** Тесты падают.
- [ ] **Шаг 3.** Реализовать `import-locales.mjs`: английские названия
  добытчиков, лент и труб — из `Docs-en-US` по тем же `ClassName`, что уже
  использует импорт; категорий — из `menu-assets.json`, а если там нет — из
  `overrides.json` (`manualNames.en.category`) с записью в `audit-report.json`
  (`verification.manualNames`); деревьев исследований и фаз — из
  `research-assets.json`. Пустое название останавливает импорт.
  Запустить `pnpm data:import`.
- [ ] **Шаг 4.** `git diff --stat packages/game-data/catalog.json` пуст;
  тесты проходят.

## Задачи 1.3–1.6. Вынос строк интерфейса

Правило для всех четырёх задач:

- каждый русский литерал, видимый пользователю (текст, `aria-label`, `title`,
  `placeholder`, текст ошибки), переносится в `ru.tsx` в раздел с именем файла
  в camelCase; текст не меняется ни на символ;
- строка с подстановкой становится функцией; число с существительным —
  через `plural`;
- `item.name`, `recipe.name` и другие названия из каталога в разметке
  заменяются на `gameName(kind, id, name)`;
- worker не обращается к пакету: он отправляет ключ сообщения, текст
  подставляет хук-получатель;
- `format` и `unit` в `controls.tsx` берут тег и единицы из активного языка,
  сигнатуры не меняются.

Проверка каждой задачи: `pnpm typecheck`; Playwright по файлам группы —
число прошедших то же, что до задачи; ни один `expect` в тестах не меняется.

| Задача | Файлы `apps/web/src` | Сценарии Playwright |
| --- | --- | --- |
| 1.3 Оболочка и миры | `App`, `Planner`, `controls`, `Profiles`, `ShareOrder`, `SharedOrderPreview`, `orderLink`, `planStorage`, `useWorldWorkspace`, `Worlds`, `SharedResources` | `planner`, `planner-layout`, `worlds`, `auth-errors`, `accessibility` |
| 1.4 Настройка плана | `Recipes`, `RecipeSetup`, `recipeCatalog`, `Research`, `Technologies`, `ProgressBoard`, `QuickOrder`, `Batch`, `VariantSettings`, `ParetoSettings`, `BeltRoutingSettings`, `ConstraintSummary`, `Expansion`, `SplitterSchemes`, `splitterCatalog.worker` | `p1`, `p2`, `quick-order`, `recipe-progress`, `research`, `belt-routing-settings`, `splitter-schemes` |
| 1.5 Результат | `ProductionVariants`, `ParetoResults`, `Results`, `ResultBoard`, `AlternatesRanking`, `AnalysisPanel`, `useAnalysis`, `analysis.worker`, `SupplyGaps`, `ResidueHelp`, `PowerCoverage`, `useSolver`, `solver.worker` | `variants`, `pareto`, `result-board`, `analysis`, `supply-gaps`, `residues`, `power-coverage`, `scarcity-alternates` |
| 1.6 Постройка и схема | `Construction`, `Schematic`, `SchematicNodeCard`, `SchematicPosition`, `useSchematicLayout`, `schematicLayout.worker`, `useConstructionMarks` | `construction`, `schematic`, `routed-factory` |

- [ ] 1.3 · [ ] 1.4 · [ ] 1.5 · [ ] 1.6

## Задача 1.7. Поиск и сортировка

**Файлы:** `controls.tsx` (`normalize`, поиск предметов), `recipeCatalog.ts`,
`schematicSearch.ts`, `Worlds.tsx`, `AnalysisPanel.tsx`;
тест: `tests/search-locales.test.ts`

**Интерфейсы:** использует `gameName`, `activeLocale`; создаёт
`searchNames(kind: GameKind, id: string, fallback: string): string` — название
на активном языке, русское и английское через пробел.

- [ ] **Падающие тесты:** поиск рецепта по `iron plate` и по `железная
  пластина` находит один и тот же рецепт; `ЖЕЛЕЗНАЯ` и `железная` дают
  одинаковый результат; `ёлка`/`елка` — замена «ё → е» сохранена; поиск
  узла схемы по английскому названию предмета находит узел.
- [ ] Реализовать; алфавитные сортировки в `apps/web` — через
  `Intl.Collator(activeLocale().tag)`.
- [ ] Тесты проходят.

## Задача 1.8. Приёмка A1

- [ ] `tests/ui/playwright.config.ts`: `use.locale = 'ru-RU'`.
- [ ] Эталон заморозки с базовой сборки (вершина ветки этапа 3), затем
  `VISUAL_FREEZE=1` на ветке A1 — оба вьюпорта проходят.
- [ ] `pnpm typecheck`, `pnpm test`, `pnpm build`, полный `sh output/ui.sh`.
- [ ] `docs/STATUS.md`: запись об A1. `README.md`: `locales/` в описании
  данных игры.
- [ ] `pre-ship`, `local/pre-pr-checklist.md`.

---

# PR A2. Ядро на коды сообщений

Ветка `claude/i18n-a2-core` от A1. Каждая задача — вертикальный срез:
источник сообщений и все его потребители меняются вместе, чтобы проект
компилировался после каждой задачи.

## Задача 2.1. Тип сообщения и отрисовка

**Файлы:**
- Создать: `packages/domain/messages.ts`, `apps/web/src/i18n/renderMessage.ts`
- Изменить: `apps/web/src/i18n/ru.tsx` (раздел `core`)
- Тест: `tests/messages.test.ts`

**Интерфейсы (создаёт):**
- `type MessageRef = { ref: 'item' | 'recipe' | 'building' | 'miner' | 'belt'
  | 'pipe' | 'category'; id: string }`
- `type MessageParam = number | string | MessageRef | Message`
- `type Message = { code: MessageCode; params?: Record<string, MessageParam> }`
- `type MessageCode` — объединение литералов; пополняется задачами 2.2–2.5.
- `msg(code: MessageCode, params?: Message['params']): Message`
- `class DomainError extends Error { code: MessageCode; params?: … }`,
  `message` равен коду.
- `renderMessage(message: Message, t: Messages): string`
- `ru.core: { [K in MessageCode]: string | ((p: Record<string, string |
  number>) => string) }`

- [ ] **Падающие тесты:** ссылка `{ ref: 'item', id: 'iron-plate' }`
  разворачивается в «Железная пластина»; вложенное сообщение — рекурсивно;
  число форматируется по активному языку; (фокус 3) объект с кодом, которого
  нет в пакете, даёт `t.core.unknown({ code })` и не бросает исключение;
  `new DomainError('x').message === 'x'`.
- [ ] Реализовать; тесты проходят.

## Задача 2.2. Результат расчёта и варианты

**Файлы:** `packages/domain/types.ts` (`Result.message: Message`,
`Result.warnings: Message[]`, удалить `ProductionVariant.label`
и `pareto.failures[].label`, `failures[].message: Message`),
`packages/solver/solve.ts`, `variants.ts`, `pareto.ts`, `workingPlans.ts`,
`beltRouting.ts`, `residues.ts`, `fuelProvenance.ts`, `diagnoseSupply.ts`,
`analysis.ts`, `build.ts`; потребители в `apps/web/src`
(`ProductionVariants`, `ParetoResults`, `Results`, `AnalysisPanel`, `useSolver`).

**Интерфейсы (создаёт):** `variantLabel(id: ProductionVariant['id'],
plan: Plan, t: Messages): string` в `apps/web/src/i18n/variantLabel.ts`
(«Максимальный выпуск» / «Компактный план» по режиму — как сейчас
в `variants.ts:21`).

- [ ] Тесты Vitest, сверяющие русские фразы результата, переводятся на
  `toMatchObject({ code, params })`; список — в PR.
- [ ] Новый тест: `variantLabel('maximum', план-максимум)` → «Максимальный
  выпуск», для заказа и партии → «Компактный план».
- [ ] Реализовать; `pnpm typecheck`, `pnpm test`.

## Задача 2.3. Независимый валидатор

**Файлы:** `packages/solver/validate.ts` и его потребители; тесты валидатора.

- [ ] Ошибки валидатора — `Message[]`; каждой из прежних фраз соответствует
  свой код; тесты переходят на коды.

## Задача 2.4. Ошибки домена и API

**Файлы:** `packages/domain/validation.ts`, `recipeSettingsFile.ts`,
`worlds.ts`, `worldPlanValidation.ts`, `research.ts`, `recipeProgress.ts`,
`sharedResources.ts`, `availability.ts`, `sourceCapacity.ts`,
`plannerCompatibility.ts`, `beltNetwork.ts`, `beltRouting.ts`;
`apps/api/app.ts`, `worlds.ts`, `legacyPlans.ts`, `server.ts`;
места `catch` в `apps/web/src`.

- [ ] Бросаемые ошибки — `DomainError`; ошибки чтения файлов получают
  параметр `path` вместо текста Zod.
- [ ] API: ответ об ошибке `{ code, params?, error }`, где `error` — прежний
  русский текст.
- [ ] Интерфейс показывает текст по `code`; (фокус 3) тест: ответ без `code`
  показывает `error`.
- [ ] Тесты API проверяют `code`; изоляция пользователей и валидация —
  без изменений.

## Задача 2.5. Подписи моделей

**Файлы:** `packages/domain/schematic.ts`, `construction.ts`,
`sourceLabel.ts`, `constructionProgress.ts` (`MissingSupply.label`),
`complexity.ts`, `production.ts`, `transport.ts`, `powerCoverage.ts`,
`mapResources.ts`, `defaults.ts`; потребители в `apps/web/src`.

- [ ] Модели хранят идентификаторы; составные подписи — `Message`.
- [ ] `defaults.ts`: имя по умолчанию приходит аргументом от интерфейса.
- [ ] Тесты схемы и постройки сверяют идентификаторы и коды.

## Задача 2.6. Приёмка A2

- [ ] В `packages/domain`, `packages/solver`, `apps/api` русский текст
  остаётся только в комментариях и в поле `error` API.
- [ ] Заморозка экранов проходит; `pnpm typecheck`, `pnpm test`, `pnpm build`,
  полный Playwright.
- [ ] `docs/STATUS.md`, `docs/invariants.md` (раздел о сообщениях ядра).
- [ ] `pre-ship`, чеклист.

---

# PR B. Этап 4 и английский

Ветка `claude/redesign-stage4-voice` от A2.

## Задача 3.1. Статусы (этап 4.1)

**Файлы:** создать `apps/web/src/statusText.ts`; тест `tests/status-text.test.ts`.

**Интерфейс:** `statusText(result: Result, t: Messages): { tone: 'ok' |
'steel' | 'warn' | 'bad'; title: string; text: string }`

- [ ] Тесты: каждое значение `Result['status']` даёт свою фразу; «Оптимум
  доказан» только у `'optimal'`; `approximate` не `bad` и не `warn`.
- [ ] Реализовать и подключить вместо карты `statuses` в `ProductionVariants`
  и в заголовке результата.

## Задача 3.2. Уточнение текстов (этап 4.2)

- [ ] Единицы у метрик вариантов; перевод «Somersloops»; счётчики Парето —
  в раздел «Диагностика»; ошибка быстрого заказа — у поля выпуска.
- [ ] Изменённые тексты в тестах обновляются в этой же задаче; список — в PR.

## Задача 3.3. Реплики (этап 4.3)

- [ ] Координатор составляет таблицу «ключ → было → стало» для загрузки,
  пустых состояний, ошибок, подсказок и подвала и **согласует её
  с пользователем до правки**.
- [ ] После согласования правится `ru.tsx`; каждая ошибка сохраняет причину
  и действие (Playwright-проверка текстов ошибок).

## Задача 3.4. Английский пакет

**Файлы:** создать `apps/web/src/i18n/en.ts`; изменить `locales.ts`
(`LocaleId = 'ru' | 'en'`, запись `{ id: 'en', label: 'English',
tag: 'en-US' }`), `gameNames.ts` (ленивая загрузка `locales/en.json`);
тест `tests/i18n-en.test.ts`.

- [ ] `export const en: Messages`; компиляция падает на пропущенном ключе.
- [ ] Тесты: во всех строках и результатах функций `en` (вызванных
  с образцовыми параметрами) нет кириллицы; `en.core` покрывает каждый
  `MessageCode`.
- [ ] Английский голос — тот же, что согласован в 3.3; термины игры —
  только из `locales/en.json`.

## Задача 3.5. Переключатель и выбор языка

**Файлы:** создать `apps/web/src/LanguageSwitch.tsx`; изменить `App.tsx`
(шапка), `i18n/index.tsx`, `packages/domain/worlds.ts`
(`Workspace.locale?: string`, схема), `useWorldWorkspace.ts`;
тесты `tests/workspace-locale.test.ts`, `tests/ui/language.spec.ts`.

- [ ] Vitest: workspace без `locale` разбирается как раньше и при
  сериализации не получает поля; с `locale: 'en'` — сохраняет его;
  (фокус 4) `mergeWorkspace` не переносит `locale` из импортируемого файла.
- [ ] Playwright: `locale: 'en-US'` в контексте → интерфейс английский;
  `locale: 'de-DE'` → английский; выбор «Русский» сохраняется после
  перезагрузки; смена языка после расчёта меняет тексты табло без нового
  запроса к worker; вход в аккаунт с `locale: 'en'` при невыбранном языке
  включает английский, а при выбранном в браузере русском — не меняет;
  (фокус 1) `localStorage[LOCALE_KEY] = 'de'` → язык браузера, ключ не изменён.
- [ ] Клавиатура: переключатель доступен с Tab, меню закрывается Escape,
  текущий язык помечен `aria-current`.
- [ ] `title`, `meta[name=description]`, `html[lang]` меняются с языком.

## Задача 3.6. Сквозные проверки

**Файлы:** `tests/ui/language.spec.ts`.

- [ ] Обход на английском: «Цели и ограничения», «Рецепты», «Технологии»,
  «Разделители», «Миры», «Профили», результат, инструкция, схема, быстрый
  заказ — в `document.body.innerText` нет кириллицы (кроме введённого
  в тесте имени фабрики).
- [ ] Поиск предмета по `iron plate` на русском языке и по «железная
  пластина» на английском находит предмет.
- [ ] План, сохранённый в `ficsit-plan-v1` до изменений (фикстура из
  существующего теста), открывается на обоих языках; содержимое ключа
  после открытия не изменилось.
- [ ] (фокус 5) Поле выпуска принимает `7.5` и `7,5` на обоих языках;
  табло показывает `7,5` на русском и `7.5` на английском.

## Задача 3.7. Документация и приёмка B

- [ ] `AGENTS.md`: описание проекта и требование о локализации — по разделу
  «Правила проекта» спецификации; `sh local/build-agents-override.sh`.
- [ ] `README.md` (выбор языка, добавление языка: файл пакета, файл
  названий, строка в `locales.ts`), `docs/invariants.md` (раздел «Языковые
  пакеты»), `docs/STATUS.md`, `PRODUCT.md` (голос на двух языках).
- [ ] `impeccable clarify` по обоим пакетам.
- [ ] `pnpm typecheck`, `pnpm test`, `pnpm build`, полный Playwright.
- [ ] `pre-ship`, чеклист.

## Процесс

- Задачи 1.3–1.6 независимы по файлам, но все правят `ru.tsx`; выполняются
  по одной.
- После каждого PR — ревью пользователя; следующий PR строится на ветке
  предыдущего до его слияния.
- Отступление от плана записывается в `docs/STATUS.md` с причиной.
