#!/usr/bin/env bash
# Keeps Docker's build leftovers from filling the disk (each rebuild of the web/worker
# images leaves ~1 GB of cache and superseded layers behind).
#
# Removes ONLY: build cache beyond the most recent KEEP_GB, and *dangling* images
# (old layers no tag points at). It never touches containers, volumes (podstudio_data,
# garage_*, caddy_*), or any image that is in use or tagged.
#   - run by hand:   scripts/docker-cleanup.sh
#   - runs weekly from the user crontab (see docs/HANDOFF.md)
#   - called by scripts/rebuild.sh after every rebuild
set -euo pipefail
KEEP_GB="${KEEP_GB:-8}"
before=$(df -B1G --output=avail / | tail -1 | tr -d ' ')
echo "[$(date -Is)] docker cleanup: keeping ${KEEP_GB} GB of recent build cache"
docker builder prune --keep-storage "${KEEP_GB}GB" -f | tail -1
docker image prune -f | tail -1
after=$(df -B1G --output=avail / | tail -1 | tr -d ' ')
echo "[$(date -Is)] free space on /: ${before} GB -> ${after} GB"
