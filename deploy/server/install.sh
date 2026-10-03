#!/bin/bash
# Однократная настройка стенда для деплоя из GitHub Actions (см. docs/deploy.md).
# Запуск на сервере из каталога с этим файлом: sudo bash install.sh
# Повторный запуск безопасен. Контейнеры не перезапускает: переезд стенда
# в /opt/satisfactory-calc выполнит первый деплой.
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
APP_DIR=/opt/satisfactory-calc
OLD_DIR=${OLD_DIR:-/home/duckmaster/satisfactory-calc}
REPO=https://github.com/angrymuskrat/another-satisfactory-calculator.git
KEY=${KEY:-/home/duckmaster/github-deploy-key}
KEY_OWNER=${KEY_OWNER:-duckmaster}

[[ $EUID -eq 0 ]] || { echo "Запустите через sudo" >&2; exit 1; }
sed -i 's/\r$//' "$HERE"/deploy-satisfactory "$HERE"/deploy-satisfactory-ssh "$HERE"/sudoers-deploy

# 1. Git-клон стенда; серверные файлы переносятся из прежнего каталога.
[[ -d $APP_DIR/.git ]] || git clone --quiet "$REPO" "$APP_DIR"
[[ -f $APP_DIR/deploy/docker-compose.override.yml ]] ||
  { echo "В клоне нет deploy/: сначала влейте настройку деплоя в master" >&2; exit 1; }
if [[ -d $OLD_DIR ]]; then
  for f in .env .env.ovh .env.bak-http; do
    [[ -e $APP_DIR/$f || ! -e $OLD_DIR/$f ]] || cp -a "$OLD_DIR/$f" "$APP_DIR/$f"
  done
fi
[[ -f $APP_DIR/.env && -f $APP_DIR/.env.ovh ]] || { echo "Нет $APP_DIR/.env или .env.ovh" >&2; exit 1; }
ln -sfn deploy/docker-compose.override.yml "$APP_DIR/docker-compose.override.yml"
chown -R root:root "$APP_DIR"
chmod 600 "$APP_DIR/.env.ovh"

# 2. Пользователь только для принудительной команды деплоя.
id deploy >/dev/null 2>&1 || useradd --system --create-home --home-dir /home/deploy --shell /bin/bash deploy

# 3. Скрипты и единственное разрешённое правило sudo.
install -o root -g root -m 0755 "$HERE/deploy-satisfactory" /usr/local/sbin/deploy-satisfactory
install -o root -g root -m 0755 "$HERE/deploy-satisfactory-ssh" /usr/local/bin/deploy-satisfactory-ssh
visudo -cf "$HERE/sudoers-deploy" >/dev/null
install -o root -g root -m 0440 "$HERE/sudoers-deploy" /etc/sudoers.d/deploy-satisfactory
visudo -c >/dev/null

# 4. Ключ GitHub Actions: разрешена только команда деплоя, без pty и пробросов.
[[ -f $KEY ]] || sudo -u "$KEY_OWNER" ssh-keygen -q -t ed25519 -N "" -C github-actions-deploy -f "$KEY"
install -d -o deploy -g deploy -m 700 /home/deploy/.ssh
printf 'command="/usr/local/bin/deploy-satisfactory-ssh",restrict %s\n' "$(cat "$KEY.pub")" \
  > /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys

echo "Готово. Приватный ключ для секрета DEPLOY_SSH_KEY: $KEY"
echo "После копирования в GitHub удалите его: rm $KEY $KEY.pub"
