# Происхождение данных и изображений

Начальные стабильные идентификаторы, исходный `data.json` и изображения взяты из
[KirkMcDonald/satisfactory-calculator](https://github.com/KirkMcDonald/satisfactory-calculator),
автор Kirk McDonald и участники проекта, commit
`c5664fc8fba4ff7dcb3f29f84f74278f497e9bb6`.
Лицензия upstream — Apache License 2.0; полный неизменённый текст находится в
`packages/game-data/source/LICENSE.upstream`. Исходный JSON сохранён как
`packages/game-data/source/upstream.json`. Код интерфейса и решателя upstream не заимствован.

`catalog.json` — изменённое производное: нормализованная структура, русская локализация,
обновлённые рецепты, мощность, правила утилизации, добыча и транспорт. Изменения
относительно upstream записаны в `packages/game-data/audit-report.json`.

Игровые названия, тексты, механические данные и изображения Satisfactory принадлежат
Coffee Stain Studios / соответствующим правообладателям. Лицензия кода upstream
не переносится автоматически на игровые изображения. Это неофициальный персональный
инструмент; он не связан с Coffee Stain Studios.

Дампы `Docs-en-US.json.gz` и `Docs-ru.json.gz` — побайтовые gzip-копии файлов
CommunityResources из локально установленного Satisfactory, Steam build `24656030`.
Исходная кодировка UTF-16LE с BOM сохранена. Данные игры не объявляются Apache-2.0.
SHA256, дата и происхождение хранятся в `packages/game-data/source/provenance.json`.
Иконки скопированы без изменения; их оригинальные пути и Git blob SHA записаны в
`packages/game-data/source/icon-manifest.json`.

Дополнительная проверка мощности проведена по
[Converter](https://satisfactory.wiki.gg/wiki/Converter),
[Quantum Encoder](https://satisfactory.wiki.gg/wiki/Quantum_Encoder) и
[Particle Accelerator](https://satisfactory.wiki.gg/wiki/Particle_Accelerator)
из Official Satisfactory Wiki, 2026-09-06. Сохранены только механические факты
и ссылки в `packages/game-data/source/power-evidence.json`; тексты статей не копировались.

## Решатель

Используется HiGHS через `highs-js` 1.15.2 (MIT),
[исходный проект](https://github.com/lovasoa/highs-js). Лицензия скопирована в
`packages/solver/LICENSE.highs-js`. `scripts/prepare-highs.mjs` генерирует изменённую
обёртку: чтение pretty-таблицы заменено чтением полного текстового решения, чтобы
не терять точность потоков. WASM-решатель не изменён. Сгенерированные файлы содержат
уведомление об изменении; они восстанавливаются при установке, сборке и тестировании.
