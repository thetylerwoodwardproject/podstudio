#!/bin/sh
# First boot against an empty /data volume: apply migrations and seed the
# mockup fixtures, then start the server. Safe to re-run — migrate/seed are
# idempotent (see packages/db/src/migrate.ts, seed.ts).
set -e

if [ ! -f "$PODSTUDIO_DB_PATH" ]; then
  echo "[web] no database found at $PODSTUDIO_DB_PATH — migrating + seeding"
  (cd /repo/packages/db && pnpm exec tsx src/migrate.ts)
  (cd /repo/packages/db && pnpm exec tsx src/seed.ts)
fi

exec pnpm exec react-router-serve ./build/server/index.js
