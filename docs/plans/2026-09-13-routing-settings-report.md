# Подзадача 1: настройка распределения конвейеров

Выполнены контракт `Settings.beltRouting`, строгая runtime-валидация и блок
«Распределение конвейеров» в «Цели и ограничения». Отсутствующая настройка
читается интерфейсом как выключенный учёт с глубиной 4, но не добавляется
в старый план при разборе или открытии. Выключение сохраняет выбранную глубину.
Изменения проходят через существующий `setPlan`.

Это завершение подзадачи настроек, а не всей функции: подключение ограничения
к оптимизатору, свидетель топологии и справочник находятся вне её области.
Независимый обзор передаётся интегратору.

## Файлы

- `packages/domain/types.ts`: экспорт `BeltRoutingSettings`, необязательное поле Settings.
- `packages/domain/validation.ts`: необязательный строгий объект без default/приведения типов.
- `apps/web/src/BeltRoutingSettings.tsx`: checkbox, недоступный при выключении select 1–4,
  связанное пояснение глубины, русский текст, стандартная оболочка panel.
- `apps/web/src/Planner.tsx`: подключение блока.
- `tests/belt-routing-settings.test.ts`: старый план, JSON/импорт, некорректные значения.
- `tests/ui/belt-routing-settings.spec.ts`: управление клавиатурой и гостевое сохранение.

## Проверки 2026-09-13

1. До реализации:
   `node node_modules/vitest/vitest.mjs run tests/belt-routing-settings.test.ts --configLoader runner`
   — 19 FAIL, 1 PASS: новая настройка отклонялась как неизвестный ключ; старый план проходил.
2. После схемы: та же команда — **20/20 PASS**.
3. До компонента:
   `$env:PLAYWRIGHT_BASE_URL='http://127.0.0.1:5183'; node node_modules/@playwright/test/cli.js test --config tests/ui/playwright.config.ts belt-routing-settings.spec.ts`
   — **1 FAIL**, отсутствовал checkbox.
4. После компонента: та же команда — **1/1 PASS** (Chrome, 2,6 с).
   Проверен цикл: старый план → включение клавишей Space → глубина 2 клавиатурой
   → выключение → localStorage → перезагрузка → включение с сохранённой глубиной 2.
5. `node node_modules/vitest/vitest.mjs run tests/belt-routing-settings.test.ts tests/validation.test.ts tests/planner-storage.test.ts --configLoader runner`
   — **25/25 PASS**, три файла. Есть штатное предупреждение Node об experimental SQLite.
6. `node node_modules/typescript/bin/tsc --noEmit` — **PASS**, exit 0.
7. `git -c safe.directory=C:/Users/muskrat/workspace/another-satisfactory-calculator diff --check`
   — **PASS**.

Vite запущен без отдельного окна на `http://127.0.0.1:5183/`, exec session `94081`,
и передан интегратору/исполнителю справочника для общего UI окружения. API не
запускался; браузер использовал отдельный гостевой контекст Playwright.
Пользовательская база не затронута. Полная сборка, полный набор UI, мобильный
визуальный обзор и API roundtrip именно новой настройки здесь не выполнялись.
Коммитов и изменений зависимостей нет.
