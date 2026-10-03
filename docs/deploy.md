# Деплой стенда

Стенд: https://satisfactory.hungrymuskrat.club:8445 (сервер 159.195.141.105).
Порты 80/443 на сервере заняты Hiddify, поэтому HTTPS обслуживает отдельный
Caddy на 8445, а сертификат Let's Encrypt выпускается через DNS-01 (OVH API).

## Схема

```
push в master → job check: pnpm typecheck, pnpm test
             → job deploy (environment production): ssh deploy@сервер <SHA>
                → /usr/local/bin/deploy-satisfactory-ssh  (пользователь deploy)
                   проверяет, что команда — полный SHA, и вызывает через sudo
                → /usr/local/sbin/deploy-satisfactory     (root)
                   git fetch → SHA входит в origin/master → checkout
                   → docker compose -p satisfactory-calc up --build -d
                   → ждёт healthy и ответ /api/session через Caddy
                   → при провале возвращает прежний коммит, job падает
```

Ключ GitHub Actions ограничен в `authorized_keys` принудительной командой и
`restrict`: он не даёт shell, pty и пробросов, а развернуть можно только коммит,
который уже есть в `master`. Серверные скрипты не обновляются из репозитория
автоматически: изменения в `deploy/server/` устанавливаются вручную через
`install.sh`, иначе любой push мог бы изменить код, выполняемый от root.

## Файлы

| В репозитории | На сервере |
| --- | --- |
| `deploy/server/deploy-satisfactory` | `/usr/local/sbin/deploy-satisfactory` |
| `deploy/server/deploy-satisfactory-ssh` | `/usr/local/bin/deploy-satisfactory-ssh` |
| `deploy/server/sudoers-deploy` | `/etc/sudoers.d/deploy-satisfactory` |
| `deploy/docker-compose.override.yml` | симлинк `/opt/satisfactory-calc/docker-compose.override.yml` |
| `deploy/caddy/` | используется из клона в `/opt/satisfactory-calc/deploy/caddy` |
| `deploy/.env.ovh.example` | `/opt/satisfactory-calc/.env.ovh` (ключи OVH, 0600, не в Git) |

`/opt/satisfactory-calc/.env`: `BIND_ADDRESS=127.0.0.1`, `PORT=3101`,
`SECURE_COOKIES=true`. Данные — в томах `satisfactory-calc_app-data`
(SQLite) и `satisfactory-calc_caddy-data` (сертификаты); имя Compose-проекта
`satisfactory-calc` менять нельзя.

## Первичная настройка

1. Когда `deploy/` уже есть в `master`, на сервере:
   `sudo git clone https://github.com/angrymuskrat/another-satisfactory-calculator.git /opt/satisfactory-calc`
   и `sudo bash /opt/satisfactory-calc/deploy/server/install.sh`.
   Скрипт переносит `.env*` из прежнего каталога `~/satisfactory-calc`,
   ставит симлинк override, создаёт пользователя `deploy`, ставит скрипты и
   правило sudo и генерирует ключ `~/github-deploy-key`. Контейнеры он не
   трогает: стенд переезжает в `/opt` при первом деплое (Re-run job в Actions).
2. GitHub → Settings → Environments → `production`:
   - Deployment branches: только `master`;
   - secret `DEPLOY_SSH_KEY` — содержимое приватного ключа;
   - secret `DEPLOY_KNOWN_HOSTS` — вывод `ssh-keyscan -t ed25519 159.195.141.105`,
     сверенный с `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` на сервере;
   - variable `DEPLOY_HOST` = `159.195.141.105`;
   - при желании — Required reviewers для ручного подтверждения деплоя.
3. Удалить приватный ключ с сервера после копирования в GitHub.
4. Settings → Branches: защитить `master` (PR и зелёный `check`).

## Ручные действия

- Повторить деплой: Actions → Deploy → Run workflow (ветка `master`) или
  Re-run для прежнего запуска — так же выполняется откат на старый коммит.
- Изменение `deploy/caddy/Caddyfile` применяется после
  `sudo docker compose -p satisfactory-calc restart caddy` в `/opt/satisfactory-calc`.
- Отозвать доступ GitHub: удалить строку из `/home/deploy/.ssh/authorized_keys`.
