#!/usr/bin/env bash
# Put the landing page (site/public) on this server, behind the same Caddy as
# Podstudio, as its own site. Run from a checkout, as root:
#
#   sudo ./site/deploy.sh                        # podstudio.dev, and www.podstudio.dev redirecting to it
#   sudo ./site/deploy.sh --domain example.com   # another domain
#   sudo ./site/deploy.sh --no-www               # no www redirect
#
# DNS: an A record for the domain, and one for www (unless --no-www), both
# pointing at this server.
#
# Run it again after changing the page. It never touches Podstudio's own site.
set -euo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)"
DOMAIN=podstudio.dev WWW=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --www) WWW=1; shift ;;
    --no-www) WWW=0; shift ;;
    -h|--help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option $1 (see --help)" >&2; exit 2 ;;
  esac
done

ok() { echo "   ✓ $*"; }
warn() { echo "   ! $*"; }
note() { echo "   $*"; }
fail() { echo "   ✗ $*" >&2; exit 1; }
. "$SRC/deploy/caddy-sites.sh"

[[ $EUID -eq 0 ]] || fail "Run it as root: sudo $0"
[[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]] || fail "\"$DOMAIN\" doesn't look like a domain."
command -v caddy >/dev/null || fail "Caddy isn't installed. Install Podstudio first (sudo ./deploy/install.sh), or: apt install caddy"
if grep -qs '^PODSTUDIO_PROXY=nginx' /etc/podstudio.env; then
  fail "This server's Podstudio uses Nginx, so Caddy can't have ports 80 and 443. Serve $SRC/site/public from Nginx instead, or reinstall Podstudio with --proxy caddy."
fi

echo "Landing page → https://$DOMAIN$([[ $WWW -eq 1 ]] && echo " (and www.$DOMAIN → it)")"
ROOT="/var/www/$DOMAIN"
mkdir -p "$ROOT"
rsync -a --delete "$SRC/site/public/" "$ROOT/"
chmod -R a+rX "$ROOT"
ok "Files in $ROOT"

{
  sed "s/{\$DOMAIN}/$DOMAIN/g" "$SRC/site/podstudio.dev.caddy"
  if [[ $WWW -eq 1 ]]; then printf '\nwww.%s {\n\tredir https://%s{uri} permanent\n}\n' "$DOMAIN" "$DOMAIN"; fi
} > "/tmp/$DOMAIN.caddy"
caddy_use_sites
caddy_write_site "$DOMAIN" "/tmp/$DOMAIN.caddy"
ok "Caddy site: $CADDY_SITES/$DOMAIN.caddy"

if command -v systemctl >/dev/null && systemctl is-active --quiet caddy 2>/dev/null; then
  systemctl reload caddy
  ok "Caddy reloaded"
  for _ in $(seq 1 20); do curl -fs --max-time 5 "https://$DOMAIN/" >/dev/null 2>&1 && break; sleep 3; done
  if curl -fs --max-time 5 "https://$DOMAIN/" >/dev/null 2>&1; then
    ok "https://$DOMAIN is up"
    if [[ $WWW -eq 1 ]]; then
      if curl -fsI --max-time 5 "https://www.$DOMAIN/" 2>/dev/null | grep -qi "^location: https://$DOMAIN"; then ok "www.$DOMAIN redirects to it"
      else warn "www.$DOMAIN doesn't redirect yet: add a www A record pointing here (Caddy gets its certificate once it resolves)"; fi
    fi
  else
    warn "https://$DOMAIN doesn't answer yet: check its DNS A record points here, then journalctl -u caddy -n 30"
  fi
else
  note "Caddy isn't running: start it with systemctl start caddy"
fi
