#!/usr/bin/env bash
# Install Podstudio on a fresh Debian 12 / Ubuntu 22.04+ server, as root, from a checkout:
#
#   sudo ./deploy/install.sh podcast.example.com
#
# Installs Node 24 and Caddy, copies the app to /opt/podstudio, builds it, and
# starts it behind Caddy on https://<domain>. Run it again to upgrade.
set -euo pipefail

DOMAIN="${1:-}"
if [[ -z "$DOMAIN" ]]; then
  echo "Usage: sudo $0 <domain>   (its DNS must already point at this server)" >&2
  exit 2
fi
if [[ $EUID -ne 0 ]]; then
  echo "Run as root (sudo)." >&2
  exit 1
fi
SRC="$(cd "$(dirname "$0")/.." && pwd)"
APP=/opt/podstudio
DATA=/var/lib/podstudio

echo "== Packages"
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg rsync debian-keyring debian-archive-keyring apt-transport-https sqlite3 >/dev/null
if ! command -v node >/dev/null || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt 24 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy >/dev/null
fi
echo "   node $(node -v), $(caddy version | cut -d' ' -f1)"

echo "== User and data folder"
id podstudio >/dev/null 2>&1 || useradd --system --home "$DATA" --shell /usr/sbin/nologin podstudio
mkdir -p "$DATA" "$APP"
chown -R podstudio:podstudio "$DATA"
chmod 750 "$DATA"

echo "== App"
rsync -a --delete --exclude node_modules --exclude dist --exclude .git --exclude .podstudio-dev --exclude data "$SRC/" "$APP/"
chown -R podstudio:podstudio "$APP"
sudo -u podstudio bash -c "cd $APP && npm ci --no-audit --no-fund --loglevel=error && npm run build >/dev/null"

echo "== Service"
if [[ ! -f /etc/podstudio.env ]]; then
  cat > /etc/podstudio.env <<ENV
PODSTUDIO_DATA=$DATA
PODSTUDIO_ORIGIN=https://$DOMAIN
HOST=127.0.0.1
PORT=4321
ENV
elif ! grep -q "^PODSTUDIO_ORIGIN=.*https://$DOMAIN" /etc/podstudio.env; then
  # Installed before under another address: point it at this one.
  sed -i '/^PODSTUDIO_ORIGIN=/d' /etc/podstudio.env
  echo "PODSTUDIO_ORIGIN=https://$DOMAIN" >> /etc/podstudio.env
  echo "   PODSTUDIO_ORIGIN set to https://$DOMAIN"
fi
install -m 644 "$APP/deploy/podstudio.service" /etc/systemd/system/podstudio.service
systemctl daemon-reload
systemctl enable --now podstudio >/dev/null
systemctl restart podstudio

echo "== Caddy"
sed "s/{\$DOMAIN}/$DOMAIN/" "$APP/deploy/Caddyfile" > /etc/caddy/Caddyfile
systemctl reload caddy || systemctl restart caddy

for i in $(seq 1 20); do
  curl -fs http://127.0.0.1:4321/api/health >/dev/null && break
  sleep 1
done
curl -fs http://127.0.0.1:4321/api/health >/dev/null || { echo "Podstudio didn't start: journalctl -u podstudio" >&2; exit 1; }
echo
echo "Done. Open https://$DOMAIN to create your account."
