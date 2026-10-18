# Podstudio

Self-hosted podcast studio. **Read `docs/HANDOFF.md` first** — current state,
live URL, what's real vs. placeholder. Then `docs/design/BUILD_PLAN.md`, then
`docs/design/STATUS.md` for the current stage, and `CLAUDE.md` for the working
rules. `docs/design/Podstudio v2.dc.html` is the visual reference (open in a
browser).

## Local dev (no Docker)

```bash
corepack enable
pnpm install
export PODSTUDIO_DB_PATH=$PWD/data/podstudio.db
export BETTER_AUTH_SECRET=$(openssl rand -hex 32)
pnpm db:generate   # only needed after a schema change
pnpm db:migrate
pnpm db:seed
PODSTUDIO_ADMIN_PASSWORD=whatever pnpm --filter @podstudio/web run seed:admin
pnpm dev           # apps/web on :3000, apps/worker alongside it via turbo
```

## Docker (home-server deployment)

```bash
cd deploy
docker compose up -d --build
```

Serves `https://studio.tylerwoodward.me` via Caddy (internal CA — this is an
internal-DNS-only name, see `deploy/Caddyfile`). The web container migrates +
seeds the database on first boot against an empty `/data` volume.

## What's real vs. not

See `docs/HANDOFF.md` for the current snapshot, and `docs/design/STATUS.md` /
`docs/design/CHANGELOG.md` for the full honest accounting — this is a
compressed shell building real screens as they're picked off, not a passed
BUILD_PLAN stage.
