# Podstudio — ongoing handoff

This is the "what's actually true right now" doc. It gets **updated in place**
each session, not appended to — history lives in `git log` and
`docs/design/CHANGELOG.md`; the stage-by-stage plan lives in
`docs/design/STATUS.md` and `docs/design/BUILD_PLAN.md`. Read this one first.

**Last updated:** 2026-10-22 — screen 27 (Embed players) built; found the
Caddy/port-80 reboot issue (see Known issues).

## Live right now

`https://studio.tylerwoodward.me` — internal-DNS-only (resolves via 192.168.2.2
to this home server, 192.168.2.241). No public DNS record.

- Sign in as `tyler@fullymodulated.com`. Password is in `deploy/.env`
  (gitignored, `chmod 600`) as `PODSTUDIO_ADMIN_PASSWORD` — ask Claude to read
  it rather than storing it anywhere else. It only takes effect on first boot
  against an empty database; there's no change-password flow yet, so editing
  `.env` later does nothing to an existing account.
- First load needs the Caddy internal CA trusted once per device: fetch
  `http://192.168.2.241:8081/podstudio-ca-root.crt` and import it under
  `chrome://settings/certificates` → Authorities. (`tylerwoodward.me`'s real
  public site has HSTS with `includeSubDomains`, so this LAN-only subdomain's
  self-signed cert has no "proceed anyway" option until the root is trusted —
  that's what the `:8081` plain-HTTP route is for.)
- `docker compose -f deploy/docker-compose.yml ps` from this box to check
  container health; `caddy`, `web`, `worker` should all show `Up`.

## What's real vs. placeholder

Of the mockup's 36 screens (`docs/design/Podstudio v2.dc.html`):

| Screen | State |
|---|---|
| 01 Sign in | Real — Better Auth email/password |
| 02 Episodes | Real — seeded SQLite, paginated table, status badges |
| 11 Episode details | Real — edit/delete at `/studio/episodes/:id` |
| 15 Feed overview | Half real, at `/studio/feed` — episode-status counts and a recent-episodes table are real DB queries. Downloads/listeners cards + chart are explicitly "not available yet" rather than fabricated — no OP3 integration or `analytics_daily` table exists (Stage 11) |
| 16 Show tags | Real — RSS/iTunes + a subset of Podcasting 2.0 tags at `/studio/feed/tags`, linked from Episodes. `person`/`podroll` deliberately not here; TXT records moved to 16b |
| 16b Lock & verify | Half real, at `/studio/feed/lock-verify` — TXT records CRUD and locking the feed are real; unlocking is deliberately not built (needs a verified owner email + emailed 6-digit code; no email delivery exists yet) |
| 17 Storage | Real config/routing, at `/studio/storage` — add/remove S3-compatible targets, a real test-connection (HeadBucket call), and routing raw/exports/feed-media to a target. Access/secret keys are entered through the screen's own form and stored server-side in the DB (never echoed back to the browser), not in `deploy/.env`. Nothing uploads to a target yet — that's Stage 02 |
| 18 Server settings | Half real, at `/studio/settings/server` — Users (add/change role/remove) is real, on the existing Better Auth `users` table; "Add user" substitutes for "invite" (no email delivery yet, same gap as 16b). Domain shows the real hostname + "Caddy internal CA, LAN-only" as plain text, not a status badge (there's no real auto-TLS to report). Storage links out to 17 instead of duplicating it. AI keys (Whisper/LLM) and LiveKit URL/keys are an explicit "not configured" note — no schema, no stage reached |
| 27 Embed players | Half real, at `/studio/public/embeds` — the config form (what to embed: one episode/latest/whole show; audio/video; theme; accent; chapters/transcript/follow toggles) is real, saved as the show default under `shows.settings.embed` (no table; BUILD_PLAN §4 has none). Only public+published episodes are selectable. The three code tabs (iframe / Script / Paste a link) are real, generated live from the form. Live preview is an explicit "not available" note and the snippets' URLs (`/{show}/embed/*`, `/embed.js`, `/oembed`) don't resolve — screen 28's player and the public routes don't exist. Snippet origin is whatever host the studio is served from (public domain not chosen) |
| 29 Public page links | Half real, at `/studio/public/links` — social links (add/toggle-visible/remove/reorder) are real on a new `show_links` table; platform picker enforces one-per-platform; handles get normalized to full profile URLs on save (Discord/LinkedIn require a full URL — their handle format can't be guessed). Real Font Awesome 6 brand icons per platform. Website is read-only, linking to Show tags (16) instead of duplicating that field. No drag-and-drop (plain up/down buttons instead), no live preview (needs the public page, screen 25, not built) |
| everything else (26 screens) | Placeholder route only, zero feature logic |

**None of this is a passed BUILD_PLAN stage.** PREBUILD is still current per
`docs/design/STATUS.md` — its actual proofs (OPFS capture+crash-recovery
drill, 2hr/8-track memory benchmark, noise-reduction DSP null-test) haven't
been run. What exists is a compressed shell that happens to prove PREBUILD
proof #1 (dependency compatibility) as a side effect.

## Architecture snapshot

- Repo: `~/podstudio` (pnpm workspaces + Turborepo). `apps/web` (React Router
  **v8.4**, not v7 as BUILD_PLAN/README/CLAUDE.md say throughout — framework
  mode behaves the same, the version number in those docs just hasn't been
  reconciled yet), `apps/worker` (DB-heartbeat stub only, not Stage 00's
  durable job runner), `packages/db` (Drizzle + better-sqlite3).
  `packages/{ui,feed,audio,integrations}` are still empty placeholder dirs.
- Auth: Better Auth, Drizzle SQLite adapter. `users`/`sessions`/`accounts`/
  `verifications` tables (plural, matching BUILD_PLAN §4's naming; regenerate
  with `cd apps/web && npx @better-auth/cli generate --config
  app/lib/auth.server.ts` if the auth config changes — don't hand-edit those
  columns). `users.role` (admin/editor) is a Better Auth `additionalField`,
  server-set only. One seeded admin, no email verification/reset/invites —
  those need email delivery, still an open STATUS.md "Outstanding input."
- DB: one SQLite file (WAL), shared by `web` and `worker` via a Docker named
  volume (`podstudio_podstudio_data`). Seeded with the mockup fixtures (The
  Mic Drop; Alex Rivera, Dana Ruiz; Ep. 38–43).
- Deploy: `deploy/docker-compose.yml` — `caddy` (internal CA, `tls internal`;
  also a plain-HTTP `:8081` bootstrap route for the CA root), `web`, `worker`.
  Needs `deploy/.env` (`BETTER_AUTH_SECRET`, `PODSTUDIO_ADMIN_PASSWORD`) —
  see `deploy/.env.example`.
- `apps/web` runs its own `server.js` in production, **not**
  `react-router-serve` — that CLI never sets Express's `trust proxy`, so every
  action POST got rejected by React Router's CSRF guard behind Caddy (see
  CHANGELOG, "every POST was broken"). `server.js` sets `trust proxy: 1`.
  If you ever add another reverse proxy hop in front of Caddy, bump that
  number — it's deliberately not `true` (don't trust arbitrary upstream
  headers).

## Known issues, left as-is

- `apps/worker`'s container has a slow (~1–2 min) cold start — `pnpm exec
  tsx` reinstalls at runtime instead of reusing the build-time install. Works,
  just slow.
- Two parallel `cn` helpers in the codebase: shadcn's current registry
  generates new components importing `cn` from the real npm `cn` package and
  `Slot` from the unified `radix-ui` package, while hand-written files
  (`episodes.tsx`, `studio-shell.tsx`, etc.) use this repo's own
  `~/lib/utils`. Both work; pick one before there are many more files.
- No CI (lint/typecheck run manually, no Vitest/Playwright wired up), no
  off-site backup target chosen (Litestream isn't in docker-compose yet), no
  S3-compatible storage target chosen, no real worker job runner.

- **Caddy container can lose a port-80 race after a host reboot** (found
  2026-10-22): the apt-installed system `caddy.service` is *enabled* with a
  stray `/etc/caddy/Caddyfile` (`:80 { reverse_proxy localhost:8000 }`, nothing
  on :8000) and starts at boot before Docker, so `podstudio-caddy-1` can't bind
  host port 80 and exits 128 — the studio URL then refuses connections. Fix
  needs sudo and is Tyler's call (it's a host service, possibly used for
  something else): `sudo systemctl disable --now caddy` then
  `docker compose -f deploy/docker-compose.yml up -d caddy`. Until then a
  temporary workaround is a throwaway Caddy on 443 only (see CHANGELOG).

## Where to look next

Reference docs: `docs/design/STATUS.md` (stage-gate table), `docs/design/CHANGELOG.md`
(dated session history), `docs/design/BUILD_PLAN.md` (confirmed scope/architecture/
data model — the source of truth for what Podstudio should become), `CLAUDE.md`
(working rules).

**Direction, confirmed with Tyler:** keep building screens ahead of the formal
stage gate, same compressed-shell approach as every screen so far — not a pivot
to PREBUILD's technical validation, not a technical-debt-only session.

1. **(Done 2026-10-22 — screen 27 is built; this list item is the spec it followed.)** Screen 27 (Embed players), `/studio/public/embeds`. Read its full README
   spec first (options for what to embed, player type, theme/accent, toggles,
   three code-snippet tabs). Apply the same scoping process as every screen
   this session:
   - Likely real: the config form itself — needs a schema decision (a json
     column on `shows`, similar to the existing unused `shows.settings`/
     `shows.theme`, or a dedicated table — check BUILD_PLAN §4 for whether
     embeds have their own table before inventing one). The three
     code-snippet tabs can be real (static HTML/JS templates reflecting the
     configured options).
   - Likely deferred, and should say so honestly: the "live preview" and the
     snippets' actual embed URL won't work end-to-end — screen 28 (the real
     embed player bundle, a separate `packages/embed`/Preact build target)
     doesn't exist. Same shape as 29's deferred live preview needing screen 25.
   - Follow the proven pattern without exception: all `@podstudio/db`/
     `drizzle-orm`/`better-auth` access goes in a new `.server.ts` file, never
     imported directly into the route file — a hard rule now (see CHANGELOG,
     "Real bug: two sidebar links silently failed to navigate"), not optional
     tidiness.

2. **Fallback candidates** if 27 turns out bigger than expected, roughly by
   tractability: **31 Analytics** (mostly OP3-dependent like 15 already is —
   expect little new real surface) is the easiest fallback. **13 Clips**,
   **08 Editor**, **06 Record** all need real capture/editing infrastructure
   (Stage 03/04 territory) — a different category of work; don't start these
   without discussing scope first.

3. **Decisions that would unblock other screens if Tyler makes them** (not
   asking him to decide now, just recorded): an **email delivery provider**
   unblocks 16b's real unlock flow and 18's real invite-by-email; an
   **S3-compatible storage provider + credentials** unblocks actually testing
   17's "Test connection" for real; an **off-site backup target** unblocks
   Stage 00 starting; **home-server hardware/network specs, supported
   browsers, performance budgets** unblock PREBUILD's real proofs.

4. **Known technical debt** — see "Known issues, left as-is" above, still
   unprioritized: the duplicate `cn` helper, worker's slow cold start, no CI,
   no off-site backup, no S3 target chosen.

5. **Standing process reminder** (caught two real bugs this session): after
   any new screen, run `pnpm typecheck && pnpm build` and check the new
   route's client chunk stays small — then rebuild the Docker image,
   redeploy, and verify with an actual browser (the scratchpad has a working
   Playwright setup using the cached `chromium_headless_shell`, not just
   curl) before calling anything done. Clean up any test data created during
   verification against the live DB before finishing.
