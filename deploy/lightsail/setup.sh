#!/usr/bin/env bash
# One-time setup on a fresh AWS Lightsail Ubuntu 24.04 instance.
# Run from the cloned repo at /opt/norochan:  sudo bash deploy/lightsail/setup.sh your-domain.com
# Safe to re-run: existing env file and data are never overwritten.
set -euo pipefail

DOMAIN="${1:?Usage: sudo bash deploy/lightsail/setup.sh your-domain.com}"
APP_DIR=/opt/norochan
DATA_DIR=/var/lib/norochan
ENV_DIR=/etc/norochan
HERE="$(cd "$(dirname "$0")" && pwd)"

if [ "$(id -u)" -ne 0 ]; then echo "Run with sudo." >&2; exit 1; fi
if [ ! -f "$APP_DIR/server.js" ]; then echo "Clone the repo to $APP_DIR first." >&2; exit 1; fi

echo "== Packages"
apt-get update
apt-get install -y ca-certificates curl gnupg debian-keyring debian-archive-keyring apt-transport-https

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
fi

echo "== User and folders"
id norochan >/dev/null 2>&1 || useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin norochan
install -d -o norochan -g norochan -m 700 "$DATA_DIR"
install -d -o root -g root -m 755 "$ENV_DIR"
chown -R root:root "$APP_DIR"
chmod -R a+rX "$APP_DIR"

if [ ! -f "$ENV_DIR/norochan.env" ]; then
  sed "s/example\.com/$DOMAIN/g" "$HERE/norochan.env.example" > "$ENV_DIR/norochan.env"
  echo "Created $ENV_DIR/norochan.env. Edit it and set STAKE_TOKEN before going live."
fi
chown root:root "$ENV_DIR/norochan.env"
chmod 600 "$ENV_DIR/norochan.env"

if [ ! -f "$DATA_DIR/rewards.json" ]; then
  install -o norochan -g norochan -m 600 "$APP_DIR/src/data/rewards.example.json" "$DATA_DIR/rewards.json"
  echo "Created $DATA_DIR/rewards.json from the example. Edit currentPrizePool and the payout figures."
fi

echo "== Services"
install -m 644 "$HERE/norochan.service" /etc/systemd/system/norochan.service
sed "s/example\.com/$DOMAIN/g" "$HERE/Caddyfile" > /etc/caddy/Caddyfile
systemctl daemon-reload
systemctl enable --now norochan
systemctl reload caddy || systemctl restart caddy

echo "== Done"
systemctl --no-pager --lines=5 status norochan || true
echo "Edit secrets: sudo nano $ENV_DIR/norochan.env && sudo systemctl restart norochan"
echo "Logs:         sudo journalctl -u norochan -f"
