# Sourced by deploy/install.sh and site/deploy.sh: one Caddy serving several
# sites. /etc/caddy/Caddyfile holds only the global options and an import;
# each site is its own file in /etc/caddy/sites/, so installing one never
# overwrites another.
#
# Expects ok/warn/note/fail from the caller.

CADDY_MAIN=/etc/caddy/Caddyfile
CADDY_SITES=/etc/caddy/sites
CADDY_MARK="# Managed by Podstudio's installers: sites are in $CADDY_SITES/."

# caddy_use_sites [email]: make the main Caddyfile import the sites folder.
caddy_use_sites() {
  local email="${1:-}" old=""
  mkdir -p "$CADDY_SITES"
  if [[ -f "$CADDY_MAIN" ]]; then
    old=$(cat "$CADDY_MAIN")
    # Keep an email set before if none is given now.
    [[ -z "$email" ]] && email=$(sed -n 's/^[[:space:]]*email[[:space:]]\+\([^[:space:]]*\).*/\1/p' "$CADDY_MAIN" | head -1)
  fi
  if [[ -z "$old" || "$old" == *"$CADDY_MARK"* || "$old" == *"Podstudio behind Caddy"* || "$old" == *"/usr/share/caddy"* ]]; then
    # Ours (or Caddy's stock welcome page): write it fresh.
    [[ -n "$old" && "$old" != *"$CADDY_MARK"* ]] && cp "$CADDY_MAIN" "$CADDY_MAIN.bak-$(date +%Y%m%d-%H%M%S)"
    # An older Podstudio install kept its site in this file: move it into the
    # sites folder first, so it keeps working until the installer rewrites it.
    if [[ "$old" == *"Podstudio behind Caddy"* && ! -f "$CADDY_SITES/podstudio.caddy" ]]; then
      awk 'BEGIN { g = 0 } NR == 1 && /^\{/ { g = 1 } g && /^\}/ { g = 0; next } !g' "$CADDY_MAIN" > "$CADDY_SITES/podstudio.caddy"
      note "Moved Podstudio's site to $CADDY_SITES/podstudio.caddy."
    fi
    {
      echo "$CADDY_MARK"
      if [[ -n "$email" ]]; then printf '{\n\temail %s\n}\n' "$email"; fi
      echo
      echo "import $CADDY_SITES/*.caddy"
    } > "$CADDY_MAIN"
  elif ! grep -q "import $CADDY_SITES/\*.caddy" "$CADDY_MAIN"; then
    # Someone else's Caddyfile: leave it, just add the import.
    cp "$CADDY_MAIN" "$CADDY_MAIN.bak-$(date +%Y%m%d-%H%M%S)"
    printf '\n# Added by Podstudio: its sites are in %s/.\nimport %s/*.caddy\n' "$CADDY_SITES" "$CADDY_SITES" >> "$CADDY_MAIN"
    note "Your Caddyfile has other sites in it: kept, with an import of $CADDY_SITES/ added (backup beside it)."
  fi
}

# caddy_write_site <name> <file>: install one site's config, then check it all.
caddy_write_site() {
  install -m 644 "$2" "$CADDY_SITES/$1.caddy"
  caddy validate --config "$CADDY_MAIN" --adapter caddyfile >/tmp/caddy-validate.log 2>&1 ||
    { tail -5 /tmp/caddy-validate.log >&2; fail "Caddy's configuration doesn't validate (caddy validate --config $CADDY_MAIN)."; }
}
