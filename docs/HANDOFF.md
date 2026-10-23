# Podstudio — ongoing handoff

This is the "what's actually true right now" doc. It gets **updated in place**
each session, not appended to — history lives in `git log` and
`docs/design/CHANGELOG.md`; the stage-by-stage plan lives in
`docs/design/STATUS.md` and `docs/design/BUILD_PLAN.md`. Read this one first.

**Last updated:** 2026-10-23 — a long build session. New this session: embed
player route + `/embed.js` + `/oembed` (27), Analytics (31), Brand & theme (29b,
applied to public pages and optionally the studio chrome), public show/episode
pages (25/30), Podroll (32), Publish to feed (14, scheduling + item XML), a real
channel-level RSS feed, New-episode + credits editing, self-hosted fonts,
migrations on every boot, Vitest (49 tests). Also found the Caddy/port-80 reboot
problem — **read the first Known issue before assuming the studio URL works.**

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
| 02 Episodes | Real — seeded SQLite, paginated table, status badges, and **"New episode"** (title, optional season/episode that auto-fill to latest season / next number; creates a private `recording` draft with a fresh UUID v4 `guid` (`isPermaLink` absent) and a separate UUID v4 `publicId`; duplicates of season/number allowed on purpose). The row ⋯ menu items (Open in editor / Duplicate / Delete) are still inert |
| 11 Episode details | Real — edit/delete at `/studio/episodes/:id`: title, subtitle, description, **season, episode number, explicit**, status, visibility; links to Publish to feed. guid/publicId are never editable. **People section**: add/remove host or guest credits (name autocompletes from existing people; matching is case-insensitive so one person isn't duplicated; the same person may hold two roles; exact duplicates rejected) — these feed `podcast:person` in the item preview and the public pages. Not built: people's own website/socials, per-episode TXT records, chapters/AI suggestions |
| 15 Feed overview | Half real, at `/studio/feed` — episode-status counts and a recent-episodes table are real DB queries. Downloads/listeners cards + chart are explicitly "not available yet" rather than fabricated — no OP3 integration or `analytics_daily` table exists (Stage 11) |
| 16 Show tags | Real — RSS/iTunes + a subset of Podcasting 2.0 tags at `/studio/feed/tags`, linked from Episodes. `person`/`podroll` deliberately not here; TXT records moved to 16b |
| 16b Lock & verify | Half real, at `/studio/feed/lock-verify` — TXT records CRUD and locking the feed are real; unlocking is deliberately not built (needs a verified owner email + emailed 6-digit code; no email delivery exists yet) |
| 17 Storage | Real config/routing, at `/studio/storage` — add/remove S3-compatible targets, a real test-connection (HeadBucket call), and routing raw/exports/feed-media to a target. Access/secret keys are entered through the screen's own form and stored server-side in the DB (never echoed back to the browser), not in `deploy/.env`. Nothing uploads to a target yet — that's Stage 02 |
| 18 Server settings | Half real, at `/studio/settings/server` — Users (add/change role/remove) is real, on the existing Better Auth `users` table; "Add user" substitutes for "invite" (no email delivery yet, same gap as 16b). Domain shows the real hostname + "Caddy internal CA, LAN-only" as plain text, not a status badge (there's no real auto-TLS to report). Storage links out to 17 instead of duplicating it. AI keys (Whisper/LLM) and LiveKit URL/keys are an explicit "not configured" note — no schema, no stage reached |
| 27 Embed players | Real end to end except audio, at `/studio/public/embeds` — config form (what to embed: one episode/latest/whole show; audio/video; theme; accent; chapters/transcript/follow) saved as the show default under `shows.settings.embed`; only public+published episodes selectable. The three code tabs are generated live, **and their targets now exist**: `/{show}/embed/{public-id\|latest\|all}` (iframe document in the README-28 dark/light tokens, theme=auto follows the OS, `follow=0` honoured, CSP `frame-ancestors *`, no cookies, query params allow-listed, all text escaped), `/embed.js` (turns `<div data-podstudio="show/target" …>` into the same iframe and auto-resizes from the iframe's postMessage — verified 152→247px), and `/oembed?url=` (JSON `rich` embed for a public episode or show URL on this origin; non-public/foreign-origin 404, bad url 400, non-JSON 501; discovery `<link rel="alternate" type="application/json+oembed">` on the public pages). The live preview is an iframe of that real route. **No player yet** (screen 28's actual player): the embed shows show/episode info with "Audio isn't available yet" — no `<audio>`, play button, chapters or transcript; `embed.js` doesn't forward play/pause/timeupdate or push colour-scheme changes. Snippet origin is whatever host serves the request (public domain not chosen) |
| 31 Analytics | Thin by design, at `/studio/analytics` — every number (KPIs, chart, top apps, countries, per-episode Day 1/7/30/all-time) needs OP3 and is shown as "No data" rather than faked. Real: the 30d/90d/12m range control (URL `?range=`), the published-episodes table rows, the "Show overview on public page" switch (persisted at `shows.settings.analytics.showOnPublicPage`; nothing reads it until screen 25 exists), and an honest "OP3 / Podcast Index: Not connected" status |
| RSS feed (no screen number) | Half real, at `/{show-slug}/feed` (public, `application/rss+xml`, no cookies; linked from the public page's RSS button and Feed overview's "View feed XML") — **channel only, zero `<item>`s**: items need an `<enclosure>` and there's no uploaded audio (Stage 02), so emitting items would make the feed invalid. Channel: title, link, description (falls back to title if unset), language, atom self link, `itunes:explicit`, `podcast:guid` (as stored), `podcast:locked owner=…`, TXT records, funding, medium, updateFrequency, license, host `podcast:person`s, the podroll. Omitted on purpose: `podcast:value` (stored fields lack a recipient name/split) and `podcast:trailer` (needs pubdate/length/type). Builder is pure (`lib/feed-xml.ts`); verified well-formed with Python's XML parser and that `& < > " '` round-trip in description/funding/TXT/podroll. **Note: the live show is currently `locked = no`** (seeded unlocked; README says locked by default) — lock it from Lock & verify when ready; unlocking is deliberately unbuilt |
| 14 Publish to feed | Half real, at `/studio/publish?episode=<id>` (sidebar; also linked from Episode details for unpublished episodes) — pick an unpublished episode; **Schedule / Reschedule / Unschedule** are real (datetime in the show's timezone, converted correctly across DST — verified CST→15:30Z, CDT→14:30Z; sets `status=scheduled` + `publish_at`; unscheduling returns it to `editing`; `recording` episodes are refused). A read-only checklist shows which Podcasting 2.0 tags the data can actually support, and the feed-item XML preview (`lib/item-xml.ts`, guid written exactly as stored, `isPermaLink` only when the stored flag is non-null, person role omitted when unset) is built from the real episode. **Publish now is deliberately absent** (needs the audio file uploaded + verified, Stage 02); no enclosure, upload progress, or transcript/chapters/soundbite/alternateEnclosure/value tags; per-tag switches omitted because there's nothing to toggle. Nothing yet *acts* on `scheduled`/`publish_at` — no worker flips it to published |
| 25 Public show page | Half real, at `/{show-slug}` (e.g. `/the-mic-drop`, **no login**, no cookies) — server-rendered from the DB: title, cadence (`updateFrequency`), description, hosts, social links (hero + footer, `rel="me noopener"`), latest episode, support card (when `fundingUrl` is set), paginated public episodes list (`?page=`), "Shows we recommend" from the podroll when its switch is on, Open Graph tags. Applies Brand & theme (29b) when its Public-site scope is on, else stock paper theme. **Only `published` + `public` episodes are ever queried** (`lib/public.server.ts`). Not built: artwork, category, Apple/Spotify follow buttons, , player/chapters/transcript/search, oEmbed discovery |
| 30 Public episode page (and 26, same markup) | Half real, at `/{show}/episodes/{public-id}/{slug}` — title, meta (date, length, season/episode, guests), plain-text show notes (no HTML accepted, so nothing to sanitize), people, up-next, breadcrumb, OG tags. Public id is authoritative: wrong/missing slug 301s to canonical; unknown/unpublished/private → 404. Single-column, 44px targets (so it doubles as the phone view; no sticky "Listen in your app" bar). Says "Audio isn't available on this page yet." — no player, transcript, chapters, soundbites, MP3 download, JSON-LD |
| 32 Podroll | Half real, at `/studio/podroll` (sidebar) — new `podroll_items` table (migration 0005). Manual add (title + required UUID `podcast:guid`, optional feed URL/note; rejects bad GUID, own GUID, duplicates case-insensitively), reorder (up/down), remove, `<podcast:podroll>` XML preview with escaping (`lib/podroll-xml.ts`, shared with the future feed generator), "Show on public page" switch (`shows.settings.podroll.showOnPublicPage`) feeding 25. Podcast Index search and the verified-GUID check need an API key (Stage 11) — every item is shown "Unverified" |
| 29b Brand & theme | Half real, at `/studio/public/brand` (linked from Embed players and Public page links, not in the sidebar) — accent (8 mockup presets or validated custom hex), public-site appearance, corners (Sharp 3/4 · Soft 8/12 · Round 20/18 px), and Public site / Embed players / Studio scopes, all persisted to `shows.theme`. The README's contrast rules are implemented in `app/lib/brand-theme.ts` (on-accent #111113 or #fff by contrast; link colour stepped until 4.5:1; studio ink→bone and <3:1 lightening) and shown in a live light/dark preview with the measured ratios. Consumers: the public pages (when the Public-site scope is on, else stock paper theme) and, **when the Studio scope is on (off by default), the studio chrome** — primary buttons, focus ring and an inset active-nav bar take the accent via CSS variables set in `routes/studio/_layout.tsx` (ink → bone, low-contrast accents lightened). The Embed-players scope has no consumer until screen 28 exists |
| 29 Public page links | Half real, at `/studio/public/links` — social links (add/toggle-visible/remove/reorder) are real on a new `show_links` table; platform picker enforces one-per-platform; handles get normalized to full profile URLs on save (Discord/LinkedIn require a full URL — their handle format can't be guessed). Real Font Awesome 6 brand icons per platform. Website is read-only, linking to Show tags (16) instead of duplicating that field. No drag-and-drop (plain up/down buttons instead), no live preview (needs the public page, screen 25, not built) |
| everything else (20 screens) | Placeholder route only, zero feature logic |

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

- **Embeds can't work from public sites while the studio host is LAN-only.**
  `studio.tylerwoodward.me` resolves to 192.168.x.x, so Chrome's Local Network
  Access check blocks `embed.js`/iframes loaded from a public page ("Permission
  was denied … `local` address space"). My test needed
  `--disable-features=LocalNetworkAccessChecks` to prove `embed.js`. Real embeds
  need the public pages/embeds served from a genuinely public hostname.

- `apps/worker`'s container has a slow (~1–2 min) cold start — `pnpm exec
  tsx` reinstalls at runtime instead of reusing the build-time install. Works,
  just slow.
- Two parallel `cn` helpers in the codebase: shadcn's current registry
  generates new components importing `cn` from the real npm `cn` package and
  `Slot` from the unified `radix-ui` package, while hand-written files
  (`episodes.tsx`, `studio-shell.tsx`, etc.) use this repo's own
  `~/lib/utils`. Both work; pick one before there are many more files.
- No CI (lint/typecheck/test run manually; no Playwright wired up), no
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
  temporary workaround is a throwaway Caddy on 443 only (see CHANGELOG) —
  **a container named `pw-caddy` is currently running as that workaround**
  (plain `docker run --rm`, no restart policy, gone after a reboot); `docker rm -f
  pw-caddy` before starting the real `caddy` service or they'll fight over :443.
- **Migrations now run on every web-container boot** (fixed 2026-10-22). Before
  this the entrypoint only migrated against an *empty* volume, so any new
  migration in a rebuilt image never reached the existing DB — screen 32 500'd
  with `no such table: podroll_items`, and 0004 (`show_links`) must have been
  applied by hand last session. Seeding is still first-boot only.
- Fonts (Geist, JetBrains Mono) are self-hosted via `@fontsource/*` (latin subset, imported in `app.css`); verified the public page and studio contact only `studio.tylerwoodward.me` — no Google Fonts request. (Fixed 2026-10-22; it used to violate CLAUDE.md's no-third-party rule on public pages.)
- **`pnpm test` now runs Vitest** (`apps/web`, 34 unit tests over the pure libs:
  brand-theme contrast maths, item/feed/podroll XML, DST-correct timezone
  conversion; mutation-checked — breaking the code makes them fail). Still no
  `lint` task, no CI, and no committed browser tests: UI verification has been
  ad-hoc Playwright scripts. `playwright-core` isn't in the repo — install it
  in a temp dir and point at `~/.cache/ms-playwright/chromium_headless_shell-*`.
  Hidden traps from those scripts: `waitForURL(/studio/)` matches the hostname;
  read the DOM only after waiting for the new text, not right after a click.

## Where to look next

Reference docs: `docs/design/STATUS.md` (stage-gate table), `docs/design/CHANGELOG.md`
(dated session history, newest first), `docs/design/BUILD_PLAN.md` (confirmed
scope/architecture/data model), `CLAUDE.md` (working rules).

**First thing next session:** check `docker ps`. The real `caddy` container is
down (system `caddy.service` owns :80 — see Known issues) and a throwaway
`pw-caddy` may or may not still be serving :443. Also note `:8081` (the CA-root
bootstrap route) lives in the real Caddy, so it's down too.

**The screens that don't need new infrastructure are done.** What's left is
blocked, not forgotten:

- **13 Clips, 13b Short video style, 08 Editor, 09 Retakes, 10 Transcript, 12
  Export, 06/07 Record, 03/04/05 remote/guest, 19–24 mobile** all need capture,
  editing, transcription or render infrastructure (Stages 03–10, 12) — each is
  a different category of work; discuss scope with Tyler before starting any.
- **17b Move podcast** needs the owner-consent unlock (emailed code) and Stage 11
  redirect machinery.
- **28 Player themes** (the actual audio/video player) needs media to play.
- **Media / uploads (Stage 02)** is the next real unblocker: it would give the
  feed `<enclosure>`s and items, make "Publish now" possible in 14, give the
  embed and public episode page something to play, and unblock 12/13. The plan
  explicitly says *not* to build a bare local-disk adapter ("home hosting does
  not imply a bare local-disk adapter") — it needs an S3-compatible target
  (local MinIO or an external provider), which is Tyler's call.

**Decisions recorded for Tyler (none requested right now):**
1. **S3-compatible storage target** (MinIO on this box vs. an external provider)
   — unblocks Stage 02, hence media, items, playback, Publish-now.
2. **Email delivery provider** — unblocks 16b's real unlock flow, 18's invites,
   17b.
3. **Off-site backup target** — unblocks Stage 00 / Litestream.
4. **A genuinely public hostname** for the public pages/embeds — the LAN-only
   host breaks embeds from public sites (Known issues) and `shows.feedUrl` is
   still the studio host.
5. **Lock the feed?** The seeded show is `locked = no`; README says locked by
   default. One click on Lock & verify.
6. Hardware/browsers/performance budgets — unblock PREBUILD's real proofs.
7. Episode 41's title still reads "Dana's Draft Day Rules (verified live)" —
   residue from an earlier session's edit.

**Known technical debt** (see Known issues): duplicate `cn` helper, worker's slow
cold start, no `lint` task / CI, no committed browser tests, no off-site backup,
no S3 target.

**Standing process** (it has caught real bugs every session): after any change,
`pnpm typecheck && pnpm test && pnpm build`, rebuild the Docker image, redeploy,
and verify in an actual browser — navigate via sidebar/in-page links (client-side
nav is where the db-import-in-route class of bug hides) and read the console;
don't trust curl or a typecheck alone. Wait for the *specific new text* before
reading the DOM. Clean up any test data from the live DB and say so.
