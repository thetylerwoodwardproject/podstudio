#!/bin/sh
# Every boot applies pending migrations (drizzle tracks what's applied, so it's
# a no-op when up to date — without this, a new migration shipped in a rebuilt
# image never reached the existing DB and its screen 500'd with "no such
# table"). Only a first boot against an empty /data volume also seeds the
# mockup fixtures and the admin. See packages/db/src/migrate.ts, seed.ts.
set -e

FIRST_BOOT=0
[ -f "$PODSTUDIO_DB_PATH" ] || FIRST_BOOT=1

(cd /repo/packages/db && pnpm exec tsx src/migrate.ts)

if [ "$FIRST_BOOT" = "1" ]; then
  echo "[web] no database found at $PODSTUDIO_DB_PATH — seeding"
  (cd /repo/packages/db && pnpm exec tsx src/seed.ts)
  (cd /repo/apps/web && pnpm exec tsx scripts/seed-admin.ts)
fi

exec node server.js
