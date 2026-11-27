---
name: Плановый отдел
description: Пульт инженера рядом с игрой — тёмная тёплая сталь, маркированные таблички, один сигнальный оранжевый.
colors:
  bg: "#121110"
  dot: "#201e1c"
  surface: "#191816"
  surface-raised: "#201f1c"
  surface-hover: "#292724"
  surface-sunken: "#141312"
  surface-nav: "#141312"
  surface-nav-veil: "#141312f2"
  canvas: "#100f0e"
  canvas-veil: "#100f0ed9"
  canvas-dot: "#2e2b28"
  border-subtle: "#252320"
  border: "#302e2a"
  border-strong: "#3f3c37"
  border-hover: "#55514b"
  text: "#ebe8e2"
  text-2: "#ccc9c2"
  text-3: "#b2afa9"
  muted: "#97938c"
  placeholder: "#8b8781"
  accent: "#f0912f"
  accent-hover: "#ffa64d"
  accent-soft: "#f0912f1a"
  accent-line: "#f0912f66"
  accent-text: "#f6b36d"
  on-accent: "#1b1208"
  steel: "#93b6cb"
  steel-soft: "#93b6cb1a"
  steel-line: "#93b6cb4d"
  steel-text: "#b8d0de"
  green: "#82c39d"
  success-bg: "#17231c"
  success-border: "#2f4a3a"
  success-text: "#a9d3b8"
  warning-bg: "#2a2314"
  warning-border: "#57462a"
  warning-text: "#e3c27a"
  danger: "#e98a7c"
  danger-bg: "#2c1a17"
  danger-border: "#6b3a33"
  edge-default: "#a89a80"
  edge-label: "#e3dccd"
  edge-marker: "#b2afa9"
  tint-1: "#ffffff04"
  tint-2: "#ffffff08"
  tint-3: "#ffffff0e"
  overlay: "#000000b3"
typography:
  heading-page:
    fontFamily: "Fira Sans Condensed, Arial Narrow, sans-serif"
    fontSize: "29px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "0.005em"
  heading-plan:
    fontFamily: "Fira Sans Condensed, Arial Narrow, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    letterSpacing: "0.005em"
  heading-section:
    fontFamily: "Fira Sans Condensed, Arial Narrow, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    letterSpacing: "0.01em"
  panel-label:
    fontFamily: "Fira Sans Condensed, Arial Narrow, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    letterSpacing: "0.1em"
  marking:
    fontFamily: "Fira Sans Condensed, Arial Narrow, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    letterSpacing: "0.12em"
  body:
    fontFamily: "Golos Text, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.65
  body-sm:
    fontFamily: "Golos Text, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.7
  caption:
    fontFamily: "Golos Text, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "12px"
    fontWeight: 400
  number-kpi:
    fontFamily: "JetBrains Mono, ui-monospace, Consolas, monospace"
    fontSize: "25px"
    fontWeight: 500
    letterSpacing: "0px"
    fontFeature: "tnum"
  number-inline:
    fontFamily: "JetBrains Mono, ui-monospace, Consolas, monospace"
    fontSize: "17px"
    fontWeight: 400
    letterSpacing: "0px"
    fontFeature: "tnum"
  brand:
    fontFamily: "Fira Sans Condensed, Arial Narrow, sans-serif"
    fontSize: "19px"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "0.01em"
  brand-sub:
    fontFamily: "Fira Sans Condensed, Arial Narrow, sans-serif"
    fontSize: "11px"
    letterSpacing: "0.14em"
  brand-mark:
    fontFamily: "Fira Sans Condensed, Arial Narrow, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    letterSpacing: "0.04em"
  text-xs:
    fontSize: "12px"
  text-sm:
    fontSize: "13px"
  text-md:
    fontSize: "14px"
  text-lg:
    fontSize: "17px"
  text-xl:
    fontSize: "22px"
  text-2xl:
    fontSize: "28px"
  text-xs-1600:
    fontSize: "13px"
  text-sm-1600:
    fontSize: "14px"
  text-md-1600:
    fontSize: "15px"
  text-lg-1600:
    fontSize: "19px"
  text-xl-1600:
    fontSize: "24px"
  text-2xl-1600:
    fontSize: "30px"
rounded:
  sm: "2px"
  md: "3px"
  lg: "3px"
  pill: "999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
  "6": "24px"
  "7": "32px"
  dot-grid: "24px"
  main-padding: "35px 39px 0"
  main-max-width: "1660px"
  sidebar-width: "215px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.sm}"
    padding: "0 17px"
    height: "38px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-primary-disabled:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.muted}"
  button-secondary:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text-2}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.sm}"
    padding: "0 17px"
    height: "38px"
  button-secondary-hover:
    backgroundColor: "{colors.surface-hover}"
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "{spacing.5}"
  kpi:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "15px"
  input:
    backgroundColor: "{colors.surface-sunken}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "0 11px"
    height: "39px"
  segmented:
    backgroundColor: "{colors.surface-sunken}"
    rounded: "{rounded.md}"
    padding: "3px"
  segmented-option:
    textColor: "{colors.text-3}"
    rounded: "{rounded.sm}"
    padding: "0 16px"
    height: "32px"
  segmented-option-selected:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.accent}"
  nav-item:
    textColor: "{colors.text-3}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.md}"
    padding: "13px 12px"
  nav-item-active:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent}"
  status-optimal:
    backgroundColor: "{colors.success-bg}"
    textColor: "{colors.success-text}"
    typography: "{typography.marking}"
    rounded: "{rounded.sm}"
    padding: "6px 8px"
  status-approximate:
    backgroundColor: "{colors.steel-soft}"
    textColor: "{colors.steel-text}"
  status-stale:
    backgroundColor: "{colors.warning-bg}"
    textColor: "{colors.warning-text}"
  status-failed:
    backgroundColor: "{colors.danger-bg}"
    textColor: "{colors.danger}"
  status-pending:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.muted}"
  alert-success:
    backgroundColor: "{colors.success-bg}"
    textColor: "{colors.success-text}"
    rounded: "{rounded.md}"
    padding: "13px"
  alert-warning:
    backgroundColor: "{colors.warning-bg}"
    textColor: "{colors.warning-text}"
  alert-error:
    backgroundColor: "{colors.danger-bg}"
    textColor: "{colors.danger}"
  brand-mark:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.brand-mark}"
    width: "40px"
    height: "43px"
  schematic-node:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
extensions:
  shadows:
    shadow-1: "0 6px 18px #0005"
    shadow-2: "0 14px 44px #0009"
    shadow-sheet: "0 -10px 30px #000a"
  hazard-warning: "repeating-linear-gradient(-45deg, var(--warning-text) 0 7px, var(--warning-bg) 7px 14px)"
  hazard-frame-width: "4px (панели и предупреждения), 2px (значок статуса)"
  select-arrow: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%2397938c' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")"
  focus-ring: "outline 2px solid {colors.accent}, offset 3px"
  root-font-size: "14px; 15px от 1600px"
  breakpoints:
    wide: "min-width 1600px — шаг шкалы text-*-1600 и корневой размер 15px"
    narrow-shell: "max-width 1180px — направляющая 180px"
    mobile-shell: "max-width 720px — направляющая становится липкой полосой сверху"
  motion: "не спроектировано; см. раздел Overview"
---

# Design System: Плановый отдел

## Overview

**Creative North Star: «Пульт инженера»**

Калькулятор — пульт рядом с игрой, а не тёмный SaaS-дашборд. Фон — тёплая графитовая сталь (`bg`) с едва заметной точечной сеткой 24 px (точки `dot` радиусом 1 px), как доски HUB и MAM. Поверх неё лежат плоские таблички: рамка 1 px, срез угла почти прямой (2–3 px), ярлык узкими прописными с разрядкой. Плотность высокая, но читаемая с соседнего монитора: крупные моноширинные числа, короткие маркировки, один сигнальный оранжевый.

Цвет работает как разметка пульта. Оранжевый означает «нажми, дальше, выбрано»; стальной голубой — «проверено, справка, жидкость»; зелёный, янтарный и красный — статусы решения. Всё прочее — оттенки стали и текста. Полосатая янтарная рамка — единственный «громкий» приём, и он закреплён за тем, что требует внимания.

Тема только тёмная (`color-scheme: dark`), светлой темы нет.

**Движение пока не спроектировано.** В сборке есть только служебные переходы: смена цвета рамки поля и поворот стрелки раскрывающегося блока (0.15 s), переключатель (0.2 s), спиннер (1 s linear), прозрачность узла схемы (0.15 s); `prefers-reduced-motion: reduce` отключает анимации и переходы целиком. Язык движения — открытый вопрос следующего этапа; до тех пор новые экраны не добавляют анимаций сверх этих.

**Key Characteristics:**
- Тёплая графитовая сталь с точечной сеткой 24 px на фоне страницы и холста схемы.
- Плоские таблички: рамка 1 px, радиус 2–3 px, без теней в покое.
- Ярлыки Fira Sans Condensed прописными с разрядкой 0.1–0.12em.
- Числа — JetBrains Mono с табличными цифрами.
- Один сигнальный оранжевый; стальной голубой для проверенного и справки.
- Полосатая рамка только у требующего внимания.
- Знак «ПО» на оранжевой табличке со срезанным углом.

## Colors

Тёплая графитовая шкала с одним сигнальным оранжевым, одним справочным стальным голубым и тремя приглушёнными статусными цветами.

### Primary
- **Сигнальный оранжевый** (`accent`): главная кнопка, активный пункт навигации, выбранный вариант сегментного переключателя и режима, кольцо фокуса, каретка и `accent-color` флажков и ползунков, выделенный узел схемы, отмеченная карточка прогресса, знак «ПО». `accent-hover` — наведение на главную кнопку; `accent-soft` и `accent-line` — заливка и рамка выбранного; `accent-text` — текст на `accent-soft`; `on-accent` — текст на сплошном оранжевом.

### Secondary
- **Стальной голубой** (`steel`, `steel-soft`, `steel-line`, `steel-text`): проверенное и справочное. Статус «Допустимое приближение», полоса прогресса в обычном состоянии, жидкости на схеме (иконка узла, подписи жидких рёбер), управляющие рёбра схемы.

### Tertiary (статусы)
- **Зелёный** (`green`, `success-*`): «Оптимум найден», успешные уведомления, индикатор локального черновика.
- **Янтарный** (`warning-*`): «Требуется пересчёт», предупреждения, нехватка поставок, доля достижимого выпуска.
- **Красный** (`danger`, `danger-*`): «Заказ невыполним», «Выпуск не ограничен», «Ошибка расчёта», «Время расчёта истекло», ошибки полей и опасные действия.

### Neutral
- **Графитовая сталь** (`bg`): фон страницы под точечной сеткой `dot`.
- **Табличка** (`surface`): панели и KPI. `surface-raised` — вторичные кнопки, выпадающие списки, узлы схемы, выбранный сегмент; `surface-hover` — наведение; `surface-sunken` — поля ввода, подложка переключателей; `surface-nav` — направляющая слева, `surface-nav-veil` — её полупрозрачный вариант на телефоне.
- **Холст схемы** (`canvas`, `canvas-veil`, `canvas-dot`): поле схемы постройки со своей, более контрастной сеткой.
- **Рамки** (`border-subtle` → `border` → `border-strong` → `border-hover`): от разделителей направляющей до рамки при наведении.
- **Текст** (`text`, `text-2`, `text-3`, `muted`, `placeholder`): основной, вторичный, третичный (ярлыки, подсказки), приглушённый, заполнитель.
- **Подсветки** (`tint-1`, `tint-2`, `tint-3`): белая вуаль для наведения на прозрачные элементы и для мелкой сетки карточек прогресса. **Затемнение** (`overlay`): фон модальных окон и листов.
- **Рёбра схемы** (`edge-default`, `edge-label`, `edge-marker`): цвет ребра без собственного предмета, подписи и маркеры.

### Named Rules
**The One Signal Rule.** Оранжевый — только действие, «дальше» и выбранное. Он не красит заголовки, декоративные иконки, иллюстрации и статусы. Если оранжевый элемент нельзя нажать и он не обозначает текущий выбор, это ошибка.

**The Status Mapping Rule.** Статус решателя всегда кодируется и цветом, и подписью: оптимум — зелёный; допустимое приближение — стальной голубой (это проверенный, но не доказанно оптимальный результат, а не предупреждение); устаревший результат — янтарный с полосатой рамкой; невыполнимость, неограниченность, ошибка и тайм-аут — красный; «не рассчитан» и «считается» — приглушённый текст на `surface-raised`.

**The Muted Edges Rule.** Цвета рёбер схемы — данные, а не токены: каждый предмет получает стабильный цвет из двух приглушённых палитр мира (твёрдые — тёплые бежево-серые, жидкости — отдельная голубая), толщина 2 px для твёрдых и 3 px для жидкостей. Оранжевый и статусные зелёный, янтарный и красный в эти палитры не входят никогда.

## Typography

**Display Font:** Fira Sans Condensed (с Arial Narrow)
**Body Font:** Golos Text (с системным sans-serif)
**Label/Mono Font:** JetBrains Mono (с ui-monospace, Consolas) для чисел

**Character:** Узкий гротеск даёт трафаретную маркировку табличек, Golos — спокойный русский текст, моноширинный — числа, которые сверяют столбцом. Загружены начертания Golos 400/500/600, Fira Sans Condensed 500/600, JetBrains Mono 400/500.

### Hierarchy
- **Heading-page** (Fira Sans Condensed 600, 29px, 1.25): заголовок экрана, один на странице.
- **Heading-plan** (600, `text-xl`): название варианта плана — обычный заголовок, не ярлык таблички.
- **Heading-section** (600, 17px, 0.01em): заголовки h2/h3 вне ярлыков панелей.
- **Panel-label** (600, `text-sm`, 0.1em, прописные): ярлык таблички — заголовок секции и панели, легенда, свёрнутая панель.
- **Marking** (600, `text-xs`, 0.12em, прописные): шапки таблиц, подписи KPI, заголовок колонок производства, значки статуса, метка «Рабочее пространство».
- **Body** (Golos 400, 14px, 1.65): абзацы. **Body-sm** (13px, 1.7): подсказки, кнопки, поля, навигация. **Caption** (`text-xs`): мелкие подписи.
- **Number-kpi** (JetBrains Mono 500, 25px, табличные цифры): значения KPI. **Number-inline**: скорости выпуска, счётчики, значения мощности, числа этапов. Единица измерения внутри числа (`small`) возвращается к Golos.

Шкала `text-xs`…`text-2xl` и корневой размер (14px) на экранах от 1600 px шире переходят на шаг `*-1600` (корень 15px) — под чтение со второго монитора.

### Named Rules
**The Label vs. Heading Rule.** Ярлык панели — Fira прописными с разрядкой 0.1em в размере `text-sm`; это маркировка, а не заголовок. Название плана (варианта) набирается как заголовок шага `text-xl` без прописных, потому что это имя объекта, которое читают, а не табличка, которую узнают.

**The Mono Numbers Rule.** Любое число, которое сверяют с игрой или соседней строкой, — JetBrains Mono с `tabular-nums` и нулевой разрядкой.

## Layout

Оболочка: слева фиксированная направляющая 215 px (`surface-nav`, рамка справа `border-subtle`) со знаком, меткой рабочего пространства и навигацией; справа верхняя полоса 67 px с хлебными крошками и основная область шириной до 1660 px с отступами 35px 39px. Экран планировщика — две колонки (`minmax(370px, .94fr)` и `minmax(400px, 1.3fr)`) с промежутком `space-6`; KPI — авто-сетка от 150 px с промежутком `space-3`.

Ритм — шкала `space-1`…`space-7` (4–32 px); внутренний отступ панели `space-5`, промежутки между панелями `space-4`. Панель плана липнет к верху при прокрутке.

Адаптивность: до 1180 px направляющая сужается до 180 px; до 720 px она становится липкой полосой сверху на `surface-nav-veil` с размытием 14 px, оболочка — одной колонкой. От 1600 px растёт шкала текста.

## Elevation & Depth

Система плоская: глубина передаётся тоном поверхности (`surface-sunken` < `surface` < `surface-raised` < `surface-hover`) и ступенями рамки. Тени есть только у того, что действительно парит над страницей.

### Shadow Vocabulary
- **Узел** (`shadow-1`, `0 6px 18px #0005`): узлы и всплывающие подсказки на холсте схемы.
- **Всплывающее** (`shadow-2`, `0 14px 44px #0009`): выпадающие списки поиска, меню, модальные окна, панель схемы.
- **Лист** (`shadow-sheet`, `0 -10px 30px #000a`): нижний лист схемы на узком экране.

Выбор и фокус передаются не тенью, а внутренней рамкой 1 px `accent-line` или кольцом `accent`.

### Named Rules
**The Flat Plate Rule.** Таблички в покое без теней. Тень получает только слой поверх страницы: список, меню, модальное окно, узел холста.

## Shapes

Почти прямые углы: `rounded.sm` 2 px у кнопок, сегментов и значков, `rounded.md`/`lg` 3 px у полей, панелей, KPI и узлов. `pill` — только круглые точки статуса и иллюстрация пустого состояния. Рамка всегда 1 px; исключения — полосатая рамка (4 px у панелей и предупреждений, 2 px у значка) и рамка ссылки пропуска (2 px).

Знак «ПО» — оранжевая табличка 40×43 px со срезанным правым верхним углом (`polygon(0 0, 75% 0, 100% 25%, 100% 100%, 0 100%)`). Срезанный угол — подпись бренда, не общий приём.

Группы рецептов и карточки источников внутри панели теряют собственную рамку и делятся только верхней линией.

### Named Rules
**The Hazard Frame Rule.** Полосатая рамка `hazard-warning` (диагональ −45°, полосы `warning-text`/`warning-bg` по 7 px) — только у требующего внимания: янтарное предупреждение, панель нехватки поставок, значок «Требуется пересчёт» и доля достижимого выпуска. Она не украшает и не выделяет выбранное.

**The Solid Error Rule.** Ошибки — сознательное исключение из полосатой рамки: уведомление об ошибке держит сплошную красную рамку 1 px `danger-border` на `danger-bg`. Полосы значат «посмотри», красная сплошная — «сломано».

## Components

### Buttons
- **Shape:** почти прямой угол (2px), высота 38 px, отступ 0 17px, `text-sm` 600.
- **Primary:** сплошной `accent` с текстом `on-accent`; наведение — `accent-hover`. Неактивная главная кнопка не тускнеет прозрачностью, а становится `surface-raised` с текстом `muted`.
- **Secondary:** `surface-raised`, рамка `border-strong`, текст `text-2`; наведение — `surface-hover`.
- **Текстовые кнопки и кнопки-иконки:** прозрачные, наведение `tint-2`; текстовая кнопка-действие — оранжевым текстом. Опасное действие — текст `danger`.
- **Focus:** у всех интерактивных элементов кольцо 2 px `accent` со смещением 3 px.

### Chips / Segmented
- **Сегментный переключатель:** подложка `surface-sunken`, рамка `border`, внутренний отступ 3 px; вариант — `text-3`, наведение `tint-2`, выбранный — `surface-raised`, оранжевый текст и внутренняя рамка `accent-line`.
- **Значок статуса:** точка 5 px цветом текста, маркировка прописными, цвета по правилу статусов.
- **Счётчик:** `border-subtle` с рамкой `border-strong`, моноширинные цифры.

### Cards / Containers
- **Corner Style:** 3px.
- **Background:** `surface`; плитки внутри — `surface-sunken`, включённая плитка здания — `accent-soft` с рамкой `accent-line`.
- **Shadow Strategy:** без теней (Flat Plate Rule).
- **Border:** 1px `border`; KPI — `border-strong`; пустой результат — пунктир `border-strong`.
- **Internal Padding:** `space-5`; KPI 15 px.

### Inputs / Fields
- **Style:** `surface-sunken`, рамка 1px `border`, 3px, высота 39 px; наведение — `border-hover`; заполнитель `placeholder`.
- **Select:** без системной стрелки, своя стрелка `select-arrow` цвета `muted` справа в 10 px.
- **Focus:** кольцо `accent`; поле поиска при фокусе внутри — рамка и внешнее кольцо 1 px `accent`.
- **Error:** рамка `danger` и сообщение `danger` под полем.

### Navigation
- Пункт: `text-sm`, `text-3`, отступ 13px 12px, 3px; наведение `tint-2`; активный — оранжевый текст на `accent-soft` с внутренней рамкой `accent-line` и шевроном справа. На телефоне направляющая уходит в липкую верхнюю полосу.

### Alerts
- 1px рамка, 3px, отступ 13 px, `text-sm`: успех — зелёная тройка, предупреждение — янтарная с полосатой рамкой 4 px, ошибка — красная со сплошной рамкой.

### Schematic
- Холст `canvas` с сеткой `canvas-dot`; узлы — `surface-raised`, рамка `border-strong`, 3px, `shadow-1`; выбранный узел — контур 3 px `accent`. Рёбра — по Muted Edges Rule.

## Do's and Don'ts

### Do:
- **Do** класть таблички на `surface` с рамкой 1 px и радиусом 2–3 px поверх точечной сетки 24 px.
- **Do** подписывать панели ярлыком Fira Sans Condensed прописными (0.1em, `text-sm`), а название плана — заголовком `text-xl`.
- **Do** набирать сверяемые числа JetBrains Mono с табличными цифрами.
- **Do** кодировать статус и цветом, и словом; допустимое приближение — стальным голубым.
- **Do** ставить полосатую рамку только тому, что требует внимания, а ошибкам — сплошную красную.
- **Do** брать цвет ребра схемы из приглушённых палитр предметов.

### Don't:
- **Don't** красить оранжевым то, что нельзя нажать и что не выбрано: заголовки, декоративные иконки, иллюстрации.
- **Don't** использовать оранжевый, зелёный, янтарный или красный в палитре рёбер схемы.
- **Don't** давать табличкам тень в покое и скруглять углы больше 3 px.
- **Don't** применять полосатую рамку как украшение или знак выбора.
- **Don't** добавлять анимации сверх служебных переходов, пока язык движения не спроектирован.
