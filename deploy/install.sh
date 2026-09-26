#!/usr/bin/env bash
# Install or upgrade Podstudio on a Debian 12 / Ubuntu 22.04+ server, from a checkout:
#
#   sudo ./deploy/install.sh
#
# It asks for what it needs and checks each step: the server, your domain's
# DNS, the firewall, then installs Node 24 and Caddy, builds the app into
# /opt/podstudio, sets up nightly backups, checks HTTPS works, and prints a
# one-time link to create your admin account. Run it again to upgrade: it
# backs up the database first.
#
# Unattended:  sudo ./deploy/install.sh --domain podcast.example.com --email you@example.com --yes
#   --domain <d>     the domain (or give it as the first argument)
#   --email <e>      for Let's Encrypt expiry notices (optional)
#   --yes            accept every default, ask nothing
#   --no-firewall    leave the firewall alone
#   --no-backups     don't install the nightly backup
#   --no-start       install without starting services (containers, images)
set -euo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)"
APP=/opt/podstudio
DATA=/var/lib/podstudio
ENV_FILE=/etc/podstudio.env
BACKUPS=/var/backups/podstudio

DOMAIN="" EMAIL="" YES=0 FIREWALL=1 BACKUP=1 START=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --email) EMAIL="${2:-}"; shift 2 ;;
    --yes|-y) YES=1; shift ;;
    --no-firewall) FIREWALL=0; shift ;;
    --no-backups) BACKUP=0; shift ;;
    --no-start) START=0; shift ;;
    -h|--help) sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "Unknown option $1 (see --help)" >&2; exit 2 ;;
    *) DOMAIN="$1"; shift ;;
  esac
done
[[ -t 0 ]] || YES=1 # no terminal to ask on

# ---- Output and questions ----------------------------------------------------
if [[ -t 1 ]]; then B=$'\e[1m' DIM=$'\e[2m' G=$'\e[32m' R=$'\e[31m' Y=$'\e[33m' N=$'\e[0m'; else B= DIM= G= R= Y= N=; fi
STEP=0 STEPS=8
step() { STEP=$((STEP + 1)); echo; echo "${B}== $STEP/$STEPS  $*${N}"; }
ok() { echo "   ${G}✓${N} $*"; }
warn() { echo "   ${Y}!${N} $*"; }
fail() { echo "   ${R}✗${N} $*" >&2; exit 1; }
note() { echo "   ${DIM}$*${N}"; }
# ask "Question" default → $REPLY
ask() {
  if [[ $YES -eq 1 ]]; then REPLY="$2"; return; fi
  local hint=""; [[ -n "$2" ]] && hint=" ${DIM}[$2]${N}"
  read -r -p "   $1$hint " REPLY </dev/tty || true
  REPLY="${REPLY:-$2}"
}
# confirm "Question" y|n → status
confirm() {
  ask "$1 (y/n)" "$2"
  [[ "$REPLY" =~ ^[Yy] ]]
}
version_of() { sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$1" 2>/dev/null | head -1; }

echo "${B}Podstudio installer${N} ${DIM}· $(version_of "$SRC/package.json")${N}"

# ---- 1. The server ------------------------------------------------------------
step "Checking this server"
[[ $EUID -eq 0 ]] || fail "Run it as root: sudo $0"
. /etc/os-release 2>/dev/null || fail "Can't tell which Linux this is (no /etc/os-release)."
case "$ID:${VERSION_ID%%.*}" in
  debian:1[2-9]|ubuntu:2[2-9]|ubuntu:[3-9]?) ok "$PRETTY_NAME" ;;
  *) warn "$PRETTY_NAME isn't tested: Debian 12+ or Ubuntu 22.04+ is."; confirm "Carry on anyway?" n || exit 1 ;;
esac
MEM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if [[ $MEM_MB -ge 900 ]]; then ok "${MEM_MB} MB of memory"; else warn "${MEM_MB} MB of memory: 1 GB is recommended (building the app needs it)."; fi
mkdir -p /var/lib
FREE_MB=$(df -Pm /var/lib | awk 'NR==2 {print $4}')
ok "$((FREE_MB / 1024)) GB free for recordings: about $((FREE_MB / 518)) hours of 24-bit / 48 kHz audio per speaker"

UPGRADE=0 OLD_VERSION=""
if [[ -f "$ENV_FILE" && -d "$APP" ]]; then
  UPGRADE=1
  OLD_VERSION=$(version_of "$APP/package.json")
  NEW_VERSION=$(version_of "$SRC/package.json")
  ok "Podstudio ${OLD_VERSION:-?} is installed: this upgrades it to ${NEW_VERSION}"
  [[ "$OLD_VERSION" == "$NEW_VERSION" ]] && note "Same version: it reinstalls it."
  confirm "Upgrade now?" y || exit 0
  [[ -z "$DOMAIN" ]] && DOMAIN=$(sed -n 's#^PODSTUDIO_ORIGIN=https://\([^,]*\).*#\1#p' "$ENV_FILE")
fi

# ---- 2. Domain ------------------------------------------------------------------
step "Your domain"
note "Browsers only allow the microphone over HTTPS, so Podstudio needs a domain"
note "(or a subdomain, like podcast.example.com) for Caddy to get a certificate for."
while [[ -z "$DOMAIN" ]]; do
  [[ $YES -eq 1 ]] && fail "Give the domain: sudo $0 --domain podcast.example.com"
  ask "Domain:" ""
  DOMAIN="$REPLY"
done
DOMAIN="${DOMAIN#https://}" DOMAIN="${DOMAIN#http://}" DOMAIN="${DOMAIN%%/*}"
[[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]] || fail "\"$DOMAIN\" doesn't look like a domain."
ok "$DOMAIN"

# ---- 3. DNS -----------------------------------------------------------------------
step "Checking DNS"
MY_IP=$( (curl -fs4 --max-time 5 https://api.ipify.org || ip -4 route get 1 | awk '{for (i=1;i<NF;i++) if ($i=="src") print $(i+1)}') 2>/dev/null || true)
note "This server's public address: ${MY_IP:-unknown}"
dns_ok() {
  local ips; ips=$( (getent ahostsv4 "$DOMAIN" | awk '{print $1}' | sort -u | tr '\n' ' ') 2>/dev/null || true)
  DNS_IPS="${ips% }"
  [[ -n "$MY_IP" && " $DNS_IPS " == *" $MY_IP "* ]]
}
if [[ "$DOMAIN" == "localhost" ]]; then
  warn "localhost: Caddy uses its own certificate; only this machine can record."
elif dns_ok; then
  ok "$DOMAIN points here ($MY_IP)"
else
  warn "$DOMAIN points to ${DNS_IPS:-nothing yet}, not this server (${MY_IP:-unknown})."
  note "At your DNS provider, add an A record: ${DOMAIN} → ${MY_IP:-<this server IP>}"
  note "Let's Encrypt can't issue the certificate until it does."
  if [[ $YES -eq 0 ]]; then
    while ! dns_ok; do
      ask "Wait and check again (w), carry on anyway (c) or quit (q)?" w
      case "$REPLY" in
        c*|C*) warn "Carrying on: HTTPS starts working once DNS points here."; break ;;
        q*|Q*) exit 1 ;;
        *) note "Checking every 10 s. Ctrl+C to stop."; for _ in 1 2 3 4 5 6; do dns_ok && break; sleep 10; done ;;
      esac
    done
    dns_ok && ok "$DOMAIN points here now"
  fi
fi

# ---- 4. Certificate email -----------------------------------------------------------
step "Certificate"
note "Caddy gets and renews the certificate from Let's Encrypt on its own."
if [[ -z "$EMAIL" ]]; then
  ask "Email for expiry notices (optional, Enter to skip):" ""
  EMAIL="$REPLY"
fi
if [[ -n "$EMAIL" ]]; then ok "Notices go to $EMAIL"; else ok "No email: fine, renewals are automatic"; fi

# ---- 5. Firewall ----------------------------------------------------------------------
step "Firewall"
if [[ $FIREWALL -eq 0 ]]; then
  note "Skipped (--no-firewall). Open ports 80 and 443; keep 4321 closed."
elif confirm "Set up the firewall (ufw): allow SSH, 80 and 443, block the rest?" y; then
  command -v ufw >/dev/null || { apt-get install -y -qq ufw >/dev/null; }
  ufw allow OpenSSH >/dev/null # first, so this SSH session stays open
  ufw allow 80,443/tcp >/dev/null
  ufw --force enable >/dev/null
  ok "ufw on: SSH, 80 and 443 open"
else
  note "Left alone. Open ports 80 and 443; keep 4321 closed."
fi
note "If your VPS provider has its own firewall panel, open 80 and 443 there too."

# ---- 6. Install -------------------------------------------------------------------------
step "Installing"
apt-get update -qq || warn "apt-get update reported problems (carrying on)."
apt-get install -y -qq curl ca-certificates gnupg rsync debian-keyring debian-archive-keyring apt-transport-https sqlite3 >/dev/null
# The service runs /usr/bin/node; Podstudio needs 22.18+ (TypeScript runs directly). Installs 24 if older.
node_ok() { [[ -x /usr/bin/node ]] && /usr/bin/node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 18) ? 0 : 1)'; }
if ! node_ok; then
  (curl -fsSL https://deb.nodesource.com/setup_24.x | bash - >/dev/null && apt-get install -y -qq nodejs >/dev/null) ||
    fail "Couldn't install Node 24 from deb.nodesource.com. Check this server can reach it, or install Node 22.18+ as /usr/bin/node and run this again."
fi
ok "Node $(/usr/bin/node -v)"
if ! command -v caddy >/dev/null; then
  if curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg &&
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list; then
    apt-get update -qq || true
  else
    rm -f /etc/apt/sources.list.d/caddy-stable.list
    warn "Couldn't reach Caddy's own package repository: using $ID's Caddy package instead."
  fi
  apt-get install -y -qq caddy >/dev/null || fail "Couldn't install Caddy (apt-get install caddy)."
fi
ok "Caddy $(caddy version | cut -d' ' -f1)"

id podstudio >/dev/null 2>&1 || useradd --system --home "$DATA" --shell /usr/sbin/nologin podstudio
mkdir -p "$DATA" "$APP" "$BACKUPS"
chown -R podstudio:podstudio "$DATA"
chmod 750 "$DATA" "$BACKUPS"

if [[ $UPGRADE -eq 1 && -f "$DATA/podstudio.db" ]]; then
  SNAP="$BACKUPS/pre-${OLD_VERSION:-unknown}-$(date +%Y%m%d-%H%M%S).db"
  sqlite3 "$DATA/podstudio.db" "VACUUM INTO '$SNAP'"
  ok "Database backed up to $SNAP"
  note "To roll back: install the previous version, stop podstudio, copy this file to $DATA/podstudio.db."
fi

rsync -a --delete --exclude /node_modules --exclude /dist --exclude /.git --exclude /.podstudio-dev --exclude /data --exclude "/*.zip" "$SRC/" "$APP/"
chown -R podstudio:podstudio "$APP"
echo "   Building (a minute or two)…"
runuser -u podstudio -- bash -c "cd $APP && npm ci --cache /tmp/podstudio-npm --no-audit --no-fund --loglevel=error >/dev/null && npm run build >/dev/null" || fail "The build failed. Run it by hand to see why: cd $APP && runuser -u podstudio -- npm run build"
rm -rf /tmp/podstudio-npm
ok "Podstudio $(version_of "$APP/package.json") built in $APP"

if [[ ! -f "$ENV_FILE" ]]; then
  cat > "$ENV_FILE" <<ENV
PODSTUDIO_DATA=$DATA
PODSTUDIO_ORIGIN=https://$DOMAIN
HOST=127.0.0.1
PORT=4321
ENV
elif ! grep -q "^PODSTUDIO_ORIGIN=.*https://$DOMAIN" "$ENV_FILE"; then
  # Installed before under another address: point it at this one.
  sed -i '/^PODSTUDIO_ORIGIN=/d' "$ENV_FILE"
  echo "PODSTUDIO_ORIGIN=https://$DOMAIN" >> "$ENV_FILE"
fi
ok "Settings in $ENV_FILE"

{
  if [[ -n "$EMAIL" ]]; then printf '{\n\temail %s\n}\n\n' "$EMAIL"; fi
  sed "s/{\$DOMAIN}/$DOMAIN/" "$APP/deploy/Caddyfile"
} > /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 || fail "The Caddyfile doesn't validate: caddy validate --config /etc/caddy/Caddyfile"
ok "Caddy set up for $DOMAIN"

install -m 644 "$APP/deploy/podstudio.service" /etc/systemd/system/podstudio.service
if [[ $START -eq 1 ]]; then
  systemctl daemon-reload
  systemctl enable podstudio >/dev/null 2>&1
  systemctl restart podstudio
  systemctl reload caddy 2>/dev/null || systemctl restart caddy
  for _ in $(seq 1 30); do curl -fs http://127.0.0.1:4321/api/health >/dev/null && break; sleep 1; done
  curl -fs http://127.0.0.1:4321/api/health >/dev/null || fail "Podstudio didn't start. Its log: journalctl -u podstudio -n 50"
  ok "Podstudio is running"
else
  note "Not started (--no-start)."
fi

# ---- 7. Backups ------------------------------------------------------------------------------
step "Backups"
CRON=/etc/cron.d/podstudio-backup
if [[ $BACKUP -eq 0 ]]; then
  note "Skipped (--no-backups)."
elif [[ -f "$CRON" ]]; then
  ok "Nightly backup already set up ($CRON)"
elif confirm "Back up every night at 3:15 to $BACKUPS?" y; then
  cat > "$CRON" <<CRONTAB
# Podstudio nightly backup (install.sh): the database, safely while it runs, and the audio.
15 3 * * * root sqlite3 $DATA/podstudio.db ".backup '$BACKUPS/podstudio.db'" && rsync -a --delete $DATA/takes $DATA/live $DATA/media $BACKUPS/
CRONTAB
  chmod 644 "$CRON"
  ok "Nightly at 3:15 to $BACKUPS"
fi
note "Copy $BACKUPS off this server too (rsync, restic, or your provider's snapshots)."

# ---- 8. HTTPS and your account ------------------------------------------------------------------
step "Checking HTTPS"
if [[ $START -eq 0 ]]; then
  note "Skipped: nothing is running (--no-start)."
elif [[ "$DOMAIN" == "localhost" ]]; then
  curl -fsk --max-time 10 https://localhost/api/health >/dev/null && ok "https://localhost answers" || warn "https://localhost doesn't answer yet: journalctl -u caddy -n 20"
else
  echo "   Waiting for the certificate (up to 90 s)…"
  HTTPS=0
  for _ in $(seq 1 30); do
    if curl -fs --max-time 5 "https://$DOMAIN/api/health" >/dev/null 2>&1; then HTTPS=1; break; fi
    sleep 3
  done
  if [[ $HTTPS -eq 1 ]]; then
    ok "https://$DOMAIN works, with a real certificate"
  else
    warn "https://$DOMAIN doesn't answer yet. Usually one of:"
    note "- DNS doesn't point here yet (step 3): it starts working on its own once it does"
    note "- port 80 or 443 is closed, here or in your provider's firewall panel"
    note "Caddy's log: journalctl -u caddy -n 30"
  fi
fi

TOKEN_FILE="$DATA/setup-token"
echo
if [[ -f "$TOKEN_FILE" ]]; then
  LINK="https://$DOMAIN/setup/account?token=$(cat "$TOKEN_FILE")"
  echo "   ${B}┌──────────────────────────────────────────────────────────────${N}"
  echo "   ${B}│${N} Create your admin account: open this link"
  echo "   ${B}│${N}"
  echo "   ${B}│${N}   ${G}$LINK${N}"
  echo "   ${B}│${N}"
  echo "   ${B}│${N} It works once. Then set up two-factor with your authenticator"
  echo "   ${B}│${N} app and save the recovery codes it shows."
  echo "   ${B}└──────────────────────────────────────────────────────────────${N}"
elif [[ $START -eq 1 ]]; then
  ok "Your account is already set up: sign in at https://$DOMAIN"
fi

echo
echo "${B}Done.${N} Podstudio $(version_of "$APP/package.json") at https://$DOMAIN"
note "Recordings and database  $DATA"
note "Settings                 $ENV_FILE (restart after editing: systemctl restart podstudio)"
note "Logs                     journalctl -u podstudio -f"
note "Upgrade                  git pull, then run this again"
note "Lost the setup link      cd $APP && sudo -u podstudio env \$(cat $ENV_FILE | xargs) npm run setup-link"
note "Guide                    $APP/docs/deploy.md"
