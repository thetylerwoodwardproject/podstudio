# Changelog

## 2026-10-18 (latest) — Screen 17 (Storage): target config, test-connection and routing real
- **Storage targets (real):** new `storage_targets` table (migration
  `0003_cold_deathstrike`) matching BUILD_PLAN §4's columns
  (`provider, endpoint, bucket, region, key_ref, routes json`), plus a UI-only
  `label` for telling targets apart. CRUD at `/studio/storage`: add/remove a
  target for any of the six listed providers (Linode, Backblaze B2, Wasabi,
  R2, AWS, MinIO).
- **Secrets stay out of the database:** `keyRef` never holds an actual access
  key — it names an env var pair in `deploy/.env`
  (`PODSTUDIO_S3_<KEYREF>_ACCESS_KEY_ID`/`_SECRET_ACCESS_KEY`), the same
  pattern already used for `BETTER_AUTH_SECRET`/`PODSTUDIO_ADMIN_PASSWORD`.
  Added `@aws-sdk/client-s3` to `apps/web` and a server-only
  `app/lib/storage.server.ts` with a real `testStorageConnection()` — it
  issues an actual `HeadBucketCommand` and reports the real result, including
  "no credentials configured for key reference …" rather than ever faking a
  success. Verified the client bundle doesn't pull in the SDK (the `.server.ts`
  suffix keeps it server-only, same convention as `auth.server.ts`).
- **Routing (real):** each target's `routes` column lists which of
  raw/exports/feed-media it's responsible for; the routing form rewrites all
  targets together so each kind stays assigned to exactly one target.
- **Deliberate deviations/gaps:** the provider picker is plain radio inputs,
  not shadcn's RadioGroup (not installed; same kind of practical substitution
  as screen 02's hand-built table). The S3 client lives in `apps/web/app/lib`,
  not `packages/integrations` (still an empty placeholder per BUILD_PLAN §2)
  — moving it there waits for Stage 02's real upload path, which actually
  needs a shared package. No S3-compatible primary target has been chosen
  yet (STATUS.md's open "Before Stage 02" input), so testing a target for
  real requires Tyler to pick a provider and add its keys to `deploy/.env`
  first; nothing here uploads or stores any media — that's Stage 02.

## 2026-10-18 (earlier) — Screen 16b (Lock & verify): TXT records real, unlock deferred
- **TXT records (real):** new `show_txt_records` table (migration `0002_solid_starhawk`),
  CRUD at `/studio/feed/lock-verify`. Presets `applepodcastsverify`/`verify`/
  `ai-content` (true/false) plus custom with an optional purpose. Server-side
  validation: purpose ≤ 128 chars, value required and ≤ 4000 chars. Per README,
  the `ai-content` per-episode override belongs on Episode details (11), not
  here — not built.
- **Feed lock (half real):** locking (`shows.locked` → 1) needs no email, so
  it's real — a "Lock now" button when currently unlocked. Unlocking is
  deliberately NOT built: the spec gates it behind a verified owner email and
  a 6-digit code sent to it, and this build still has no email delivery
  (STATUS.md's open "Outstanding input" since Stage 01). The unlock button
  renders disabled with that explanation. No audit log table yet either — it
  arrives with the real unlock flow, since there's nothing to log besides
  "locked" until then.
- **Not built:** the live feed preview (no feed XML renderer exists at any
  stage yet), and the worker job that's supposed to auto-re-lock an expired
  unlock (moot without a working unlock).
- Verified against the production container: sign in, add a TXT record,
  confirmed it persists in the actual SQLite file, removed it, locked the
  feed, confirmed the unlock button is disabled, confirmed Show tags (16)
  links to and reflects this screen. Test data cleaned up afterward — the show
  ends this session unlocked with zero TXT records, same as before.

## 2026-10-18 (later still) — Fixed a real production bug: every POST was broken
- `react-router-serve` never configures Express's `trust proxy`, so behind Caddy
  `req.protocol` always read `http` regardless of the real `X-Forwarded-Proto:
  https`. React Router's own CSRF guard then rejected every action POST — show
  tags save, episode save/delete, anything — with a 400, because the app's own
  computed URL (`http://...`) never matched the browser's real `Origin`
  (`https://studio.tylerwoodward.me`). This had been live and broken since the
  episode-details/sign-in session: that work was "verified end-to-end" against
  the dev server and direct curl, never a real POST through Caddy+HTTPS with a
  real `Origin` header — the gap that let this through.
- Fixed by replacing `apps/web`'s `start` script with a small custom
  `server.js` (same static/compression/logging setup `react-router-serve`'s
  CLI uses, built directly on `@react-router/express`'s `createRequestHandler`)
  with `app.set("trust proxy", 1)` — trusting exactly the one hop Caddy
  represents.
- Caught by actually reproducing it: a first curl attempt with forged
  `X-Forwarded-Proto`/`Origin` headers still failed, because curl's default
  `Host` header (the raw `ip:port` it connects to) isn't what Caddy actually
  forwards (`studio.tylerwoodward.me`, no port) — a misleading test that
  looked like the fix hadn't worked. Re-tested with `Host` set to match what
  Caddy really sends before trusting the fix, then confirmed again for real
  through the live hostname (not simulated headers) for both show-tags save
  and an episode save.
- Also added: a help popover (`?` next to "Podcasting 2.0 (subset)") explaining
  what funding/value/medium/trailer/update-frequency/license actually mean,
  per Tyler's request while this was being fixed.

## 2026-10-18 (later) — Show tags (screen 16)
- `/studio/feed/tags`, linked from Episodes ("Edit show details"). Real RSS 2.0/
  iTunes fields (title, description, website, language, explicit) plus a scoped
  subset of Podcasting 2.0 tags (funding, value, medium, trailer, update
  frequency, license) stored in a new `shows.podcastTags` json column.
- Added `shows.description`, `shows.language`, `shows.explicit` columns — core
  RSS fields the compressed schema had simply omitted. Additive migration
  (`0001_yummy_famine.sql`), no reset needed this time (plain `ADD COLUMN`s).
- Deliberately not here, per README's own screen split: `person` (belongs on the
  already-modeled `people` table, not duplicated), `podroll` (Stage 11), TXT
  records (screen 16b, Lock & verify). `podcast:guid` and lock status are shown
  read-only with an explicit "never editable here" note — BUILD_PLAN's GUID
  non-negotiable #1.
- Verified: sign in, load the form, save (checked the DB row and the JSON blob),
  reload and confirm every field — including the checkbox — repopulates from
  what was actually saved. Production build clean.

## 2026-10-18 — Real sign-in gate + episode details (not a stage pass)
- **Auth (screen 01):** Better Auth (`better-auth` 1.7.10), Drizzle SQLite adapter, email/password only. `/studio/*` now actually requires a session — `apps/web/app/routes/studio/_layout.tsx`'s loader is the gate, redirecting to `/login`. This is deliberately short of Stage 01's full scope: email verification, password reset and invite redemption all need email delivery, which is still an open "Outstanding input" — `requireEmailVerification: false`, one seeded admin, no reset flow. Revisit when email delivery is chosen.
- Schema change: generated Better Auth's adapter tables with `@better-auth/cli generate` (pointed at `apps/web/app/lib/auth.server.ts`) using `usePlural: true` so they read `users`/`sessions`/`accounts`/`verifications`, matching BUILD_PLAN §4's naming convention instead of Better Auth's singular default. This **replaced** the earlier hand-rolled `users` table (which only had id/email/emailVerifiedAt/name/role) with Better Auth's real shape (adds image/updatedAt, emailVerified as boolean not a timestamp) plus a `role` additionalField (admin/editor), set server-side only (`input: false` — the public sign-up API can't set it). One identity table, not two.
- No real user data existed yet (just fixtures), so the migration baseline was **reset** rather than diffed through drizzle-kit's interactive rename prompts (which need a TTY this session doesn't have). `packages/db/src/migrations/` now starts fresh at the schema above. The docker named volume (`podstudio_data`) needs a wipe on next deploy for the same reason — noted below, not yet done against the running containers at time of writing.
- `apps/web/scripts/seed-admin.ts`: seeds the one admin (`tyler@fullymodulated.com`) through Better Auth's own `signUpEmail` API (it owns password hashing — never insert into `users`/`accounts` directly), then sets `role: "admin"` with a direct DB write server-side. Requires `PODSTUDIO_ADMIN_PASSWORD` (no default). Wired into `apps/web/docker-entrypoint.sh`'s first-boot sequence, after migrate+seed.
- Secrets: `BETTER_AUTH_SECRET` and `PODSTUDIO_ADMIN_PASSWORD` now required env vars on the `web` service (`deploy/docker-compose.yml`'s `${VAR:?...}` syntax fails loudly if unset, rather than booting insecurely). `deploy/.env.example` documents them; the real `deploy/.env` is gitignored, same as root.
- **Episode details (screen 11):** `/studio/episodes/:id` — real loader/action against `episodes`/`episode_people`, edits title/subtitle/description/status/visibility, deletes with a two-click inline confirm. `guid`/`guidIsPermalink`/`publicId` are deliberately not editable fields, per BUILD_PLAN's GUID non-negotiable #1. Episodes list (02) titles now link here.
- Verified end-to-end against both the dev server and the production `react-router-serve` bundle: gate redirect → sign-in → session → episodes → detail → save → delete → sign-out → gate again. All real HTTP round-trips, not just typecheck.
- Noted, not fixed: shadcn's current registry generates new components (`card`, `input`, `label`, `separator`, and the earlier `badge`) importing `cn` from the real npm `cn` package and `Slot` from the unified `radix-ui` package, while hand-written files in this repo (`episodes.tsx`, `studio-shell.tsx`, etc.) still use `~/lib/utils`'s own `cn`. Both work; it's a style inconsistency from mixing generated and hand-written code, not a bug — worth a pass to pick one convention before there are many more files.

## 2026-10-17 evening — Compressed app shell (not a stage pass)
- Scaffolded the monorepo at the code repo root per BUILD_PLAN §2: pnpm workspaces + Turborepo, `apps/web` (React Router v8.4.0 framework mode + Vite 8 + React 19.2.8 + TS strict), `apps/worker` (stub), `packages/db` (Drizzle + better-sqlite3). `packages/{ui,feed,audio,integrations}` remain empty placeholder directories.
- Dependency-version finding for PREBUILD: `create-react-router@latest` now installs **React Router v8.4.0**, not v7 as BUILD_PLAN/README/CLAUDE.md say throughout. Framework mode (file-based route config, server loaders, typegen) is present and works the same; this is a naming/version correction to make, not a behavior change found. Flagging here rather than silently diverging — update the docs' version references before Stage 00 locks dependency pins.
- Wired the handoff's `globals.css` tokens and `components.json` into `apps/web` unchanged (Podstudio dark theme, speaker colours, Geist/JetBrains Mono). Added shadcn primitives (button, table, dropdown-menu, badge) and pulled `@audiocn/level-meter` through the project's custom registry — this is real evidence for PREBUILD proof #1 (React 19.2 + Router v8 framework mode + Tailwind v4 + shadcn + audiocn render together, no hydration errors): `pnpm build` and `tsc --noEmit` are clean across `apps/web` and `packages/db`. Proofs #2–#4 (capture/recovery, 2hr/8-track performance, DSP/render parity) are untouched.
- Built the app shell: sidebar (grouped by README's screen sections) + 54px top bar + a ⌘K palette that does screen navigation only — Stage-00 asks for "empty commands," there are no real app commands yet. All 36 screen ids (01–32 + 13b/16b/17b/29b) have routes via a single shared registry (`app/lib/screens.ts`) so nothing 404s.
- Screen 02 (Episodes) is real, not a placeholder: Drizzle schema for `users/shows/people/episodes/episode_people` (a subset of BUILD_PLAN §4), an idempotent seed with the mockup fixtures (The Mic Drop; Alex Rivera, Dana Ruiz; Ep. 38–43 across all four statuses), and a data-backed table with checkboxes, status badges, mono duration, relative-time "edited," a row action menu, and pagination at 7 — hand-built rather than TanStack Table as README names, noted so this isn't mistaken for that integration later. Every other screen (03–32 except 02) is the shared stub component with zero feature logic.
- `apps/worker` is a stub: opens the shared SQLite file and heartbeats. None of Stage 00's durable-job-runner requirements (atomic claims, leases, idempotency keys, backoff/cancellation, bounded concurrency) exist yet — that needs its own `jobs` table and design pass.
- Wrote `deploy/docker-compose.yml` (caddy + web + worker, shared named volume for the SQLite file) and `deploy/Caddyfile` targeting `studio.tylerwoodward.me`. That hostname is internal-DNS-only (confirmed resolving to this host via the LAN resolver) — no public DNS record exists, so this uses Caddy's **internal CA** (`tls internal`), not public ACME. Litestream, MinIO/S3 and LiveKit are intentionally absent: no off-site backup target or S3-compatible target has been chosen yet (both are still open PREBUILD/Stage-00/02 inputs), and LiveKit is Stage 08.
- Stopped and disabled the host's stock `nginx` (was only serving the Ubuntu default page) to free ports 80/443 for Caddy; installed Docker Engine + compose plugin from Ubuntu's own repo (no external repo needed at this version).
- Fixed a real bug surfaced by actually running the production server (not just `build`): Vite's SSR bundler was inlining `better-sqlite3` into `build/server/index.js` because `@podstudio/db` is a workspace package, not `node_modules` — and `bindings` (better-sqlite3's native-binding locator) uses a bare `__filename`, which doesn't exist once Node loads that bundle as ESM. Fixed with `ssr.external: ["better-sqlite3", "bindings"]` in `apps/web/vite.config.ts`, plus adding `better-sqlite3` as a *direct* dependency of `apps/web` (pnpm's strict isolation otherwise leaves it unresolvable from that package's own `node_modules` once externalized). Confirmed via `node build/server/index.js` erroring, then `react-router-serve` serving correctly after the fix, in both plain Node and the Docker image.
- Hit and fixed an HSTS lockout: `tylerwoodward.me` (the real public site) evidently sends `Strict-Transport-Security` with `includeSubDomains`, so Chrome refused `https://studio.tylerwoodward.me`'s Caddy-internal-CA cert with no "proceed anyway" option at all (HSTS disallows that bypass). Added a plain-HTTP-only, raw-IP route (`:8081`, serving `deploy/certs/`) purely so a browser can fetch the CA root and trust it *before* the HSTS-protected hostname becomes reachable — a bare IP:port isn't covered by the subdomain HSTS policy. Left running per Tyler's call, for other LAN devices that'll need the same cert. The extracted `root.crt` is `.gitignore`d (regenerates — and goes stale — with the `caddy_data` volume); re-extract with `docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt deploy/certs/podstudio-ca-root.crt` if that volume is ever recreated.
- Noted, not fixed: the worker container's cold start is slow (~1–2 min) — `pnpm exec tsx` re-verifies the lockfile and reinstalls on every container start inside the runtime image rather than using what was already installed at build time. Works, just slow; worth trimming the worker Dockerfile's runtime stage before this matters for real (e.g. a crash-restart loop under load).
- Not done tonight, explicitly: PREBUILD's actual proofs (recovery drills, performance budget, DSP null-test, −16 LUFS delivery check), CI (lint/typecheck ran manually, no Vitest/Playwright/pipeline), auth of any kind, off-site restore drill. STATUS.md keeps PREBUILD **current** — this shell does not advance the stage gate.

## 2026-10-17 — Planning revision
- Recorded Tyler's confirmed scope: home/local-server deployment and a solo-audio first release with existing-show import, required noise reduction/voice processing, retake tone plus annotation, and password-protected sharing.
- Added PREBUILD before Foundation for dependency, recovery, long-session performance and render validation. Reset the current stage accordingly; no implementation is marked complete.
- Defined persistent capture/upload recovery, versioned linked editing, DSP parity, atomic publishing, verified ownership and early off-site restore requirements.
- Split Video into 10a ingest/sync, 10b shots/branding, 10c clips/audiograms/custom colours and 10d later interchange for Final Cut Pro, Premiere Pro and Resolve.
- Clarified optional live video, 24-hour single-use invites with separate recovery credentials, configurable remote AI services and deferred mobile work.
- Reconciled SSR, GUID generation/attributes, MP3 delivery, stable episode URLs, migration evidence and mockup behaviour overrides. Corrected the audiocn microphone-block registry name and package-local CSS path.
- This entry records documentation changes only; no production feature, mockup revision or technical proof is claimed as implemented.
