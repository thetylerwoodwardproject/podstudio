# Stage 00: Foundation

**Goal:** A running, deployable empty app with the Podstudio look.

**Prerequisite:** PREBUILD reviewed and approved, including exact dependencies, persistence/DSP contracts and capacity budgets. Deployment target is Tyler's home/local server.

At the end of this stage the app must still deploy and everything from earlier stages must keep working.

## Screens (ids from the mockup)
- None yet; every screen route renders a placeholder.

## Build
- [ ] pnpm + Turborepo monorepo as in BUILD_PLAN §2 (apps/web, apps/worker, packages/ui, db, feed, embed, audio, integrations)
- [ ] React Router v7 framework mode + Vite + React 19.2+ + TS strict, using PREBUILD's version pins
- [ ] shadcn init with components.json and globals.css from the handoff; Geist + JetBrains Mono; Font Awesome 6 Free set up
- [ ] App shell: sidebar with Podcast hosting sub-nav, 54px top bar, ⌘K palette (empty commands)
- [ ] SQLite (WAL) + Drizzle + first migration (users, shows); Litestream replicating to S3
- [ ] docker-compose (caddy, web, worker, litestream) and Caddyfile with auto-TLS
- [ ] Confirm independent off-site backup target; restore the initial database/configuration/secret references into a clean test volume and document the steps
- [ ] Durable worker skeleton: atomic claims, leases/heartbeats, abandoned-job recovery, idempotency keys, backoff/cancellation and bounded concurrency; no long work inside database transactions
- [ ] Home-server domain/DNS/public HTTPS ingress and external reachability checks; document hardware/upload limits and reserve LiveKit port/TURN planning for Stage 08
- [ ] CI: lint, typecheck, Vitest, Playwright smoke

## Out of scope
Anything listed in a later stage. Leave stub routes, not half-built features.

## Done when
- [ ] `docker compose up` serves the shell over HTTPS on a test domain
- [ ] All 36 screen ids (01–32 plus 13b, 16b, 17b, 29b) have placeholder routes with appropriate navigation state; reserve infrastructure routes against show-slug collisions
- [ ] CI is green
- [ ] Shell/sidebar/top bar match at 1440×900; future screen placeholders are not expected to match finished mockups
- [ ] Worker restart reclaims an abandoned test job without duplicating its committed effect; initial off-site restore exercise passes
- [ ] lint, typecheck, unit and e2e tests pass in CI
- [ ] CHANGELOG.md has an entry for this stage

## Demo for review
Open the app, click through every sidebar item, open ⌘K.

## Then
Update `STATUS.md`, write a short summary of what changed and anything that was skipped, and **stop**. Don't start the next stage until Tyler says go.
