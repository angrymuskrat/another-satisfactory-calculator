# API пользовательских данных

`createApp({ databasePath?, serveStatic?, secureCookies? })` возвращает Fastify.
По умолчанию база — `.data/users.sqlite` от корня проекта; `:memory:` используется
в интеграционных тестах. Нужен Node.js 24 или новее, без нативных npm-модулей SQLite.
Node.js пока выводит предупреждение об экспериментальном `node:sqlite`.

`server.ts` слушает `127.0.0.1:3001`. Переменные окружения: `HOST`, `PORT`,
`DATABASE_PATH`, `SECURE_COOKIES=true`. При наличии сборки `dist/web/index.html`
сервер отдаёт frontend и поддерживает переходы внутри приложения.
Для HTTPS включается `SECURE_COOKIES=true`; HTTP на localhost работает без Secure.
Прокси должен сохранять исходный `Host`; `X-Forwarded-*` сервер не доверяет.

## Контракт

Все тела запросов — JSON. Ошибки имеют вид `{ "error": "описание" }`.
Сессия передаётся cookie; идентификатор пользователя в теле не принимается.

| Метод и адрес | Запрос | Ответ |
| --- | --- | --- |
| `GET /api/session` | — | `{ user: null \| { id, username } }` |
| `POST /api/auth/register` | `{ username, password }` | `201 { user }`, устанавливает cookie |
| `POST /api/auth/login` | `{ username, password }` | `200 { user }`, обновляет cookie |
| `POST /api/auth/logout` | — | `204`, отзывает сессию и очищает cookie |
| `GET /api/profiles` | — | `{ profiles: Profile[] }` |
| `POST /api/profiles` | `{ name, data: Plan }` | `201 { profile: Profile }` |
| `GET /api/profiles/:id` | — | `{ profile: Profile }` |
| `PUT /api/profiles/:id` | `{ name, data: Plan, revision }` | `{ profile: Profile }` с увеличенной revision |
| `DELETE /api/profiles/:id` | — | `204` |

`Profile = { id, name, revision, updatedAt, data: Plan }`, `updatedAt` — ISO UTC.
Начальная revision равна 1. `Plan` сохраняется целиком, включая цели, источники,
рецепты, здания, транспорт и параметры оптимизации. Его проверяет общий
`packages/domain/validation.ts`; неизвестные игровые ID сохраняются для дальнейшей
проверки совместимости с выбранным каталогом.

`/api/plans` поддерживает те же пять операций в отдельной коллекции.
Ответы используют ключи `plans` и `plan` соответственно.

Ошибки: `400` — невалидные поля; `401` — нет сессии или неверный пароль;
`403` — чужой Origin; `404` — запись отсутствует либо принадлежит другому
пользователю; `409` — занятый логин или конфликт revision; `413` — тело больше
1 МиБ; `429` — превышен лимит запросов входа/регистрации.

Логин содержит 3–40 букв, цифр, точек, дефисов или подчёркиваний; приводится
к NFKC и нижнему регистру. Пароль — 8–128 символов. Имя записи — 1–120 символов.
Лимит регистрации и входа — по 20 запросов за минуту с одного IP.

Пароли хешируются scrypt с индивидуальной солью (`N=32768, r=8, p=1`).
Cookie HttpOnly, SameSite=Lax, срок действия — 7 дней. В SQLite хранится SHA-256
случайного токена сессии. Выход немедленно отзывает токен на сервере.
Для изменяющих запросов проверяется совпадение Origin с протоколом и Host;
запросы API-клиентов без Origin допускаются. Ответы API запрещено кешировать.

## Проверки

Интеграционные тесты используют настоящие Fastify inject, SQLite и scrypt.
Запуск в текущей Windows-среде:

```powershell
node node_modules/vitest/vitest.mjs run tests/api.test.ts --configLoader runner
```

`--configLoader runner` обходит запрет среды на чтение esbuild родительских папок.
Проверяются сохранение и повторное открытие базы, изоляция пользователей,
одновременное обновление revision, валидация, срок сессии, неверный пароль,
выход, CSRF и ограничение попыток.
