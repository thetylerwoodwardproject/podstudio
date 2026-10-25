#!/usr/bin/env bash
# Rebuild and restart the app from deploy/, then tidy Docker's leftovers.
#   scripts/rebuild.sh            # web + worker
#   scripts/rebuild.sh web        # just web
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
cd "$here/../deploy"
if [ "$#" -eq 0 ]; then set -- web worker; fi
docker compose up -d --build "$@"
"$here/docker-cleanup.sh"
