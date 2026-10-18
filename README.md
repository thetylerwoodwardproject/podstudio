# Podstudio

Self-hosted podcast studio. **Read `docs/design/BUILD_PLAN.md` first**, then
`docs/design/STATUS.md` for the current stage, and `CLAUDE.md` for the working
rules. `docs/design/Podstudio v2.dc.html` is the visual reference (open in a
browser).

## Local dev (no Docker)

```bash
corepack enable
pnpm install
export PODSTUDIO_DB_PATH=$PWD/data/podstudio.db
pnpm db:generate   # only needed after a schema change
pnpm db:migrate
pnpm db:seed
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

## What's here tonight vs. not

See `docs/design/STATUS.md` and `docs/design/CHANGELOG.md` for the honest
accounting — this shell compresses part of PREBUILD proof #1 and Stage 00/01,
it does not claim either gate passed.
