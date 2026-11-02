# Podstudio — ongoing handoff

This is the "what's actually true right now" doc. It gets **updated in place**
each session, not appended to — history lives in `git log` and
`docs/design/CHANGELOG.md`; the stage-by-stage plan lives in
`docs/design/STATUS.md` and `docs/design/BUILD_PLAN.md`. Read this one first.

**Last updated:** 2026-11-02 — editor round 2 from Tyler's live use (tracks menus/colours/delete, range selection + loop, crossfades, meters, **export loudness normalisation −19 LUFS mono / −16 stereo**, bottom transport, shadcn throughout; see "Editor round 2"). Before that, 2026-11-01 — **Stage 04 (core editor) built, awaiting Tyler's review** (see "Editor (Stage 04)" below): versioned project document, canvas timeline, split/trim/move/ripple, gain/fades, undo, autosave + conflict detection, retake cleanup, audio upload (ffmpeg), WAV export in the worker, 2-hour/8-track measurements. Earlier: 2026-10-25 — Stage 02 slice: MP3 upload → Garage, public audio serving, real feed items, Publish now. Also, Garage added as local S3 (see Storage below). 2026-10-24 — Episodes row menu (Duplicate/Delete) made real. Earlier, 2026-10-23 — a long build session. New this session: embed
player route + `/embed.js` + `/oembed` (27), Analytics (31), Brand & theme (29b,
applied to public pages and optionally the studio chrome), public show/episode
pages (25/30), Podroll (32), Publish to feed (14, scheduling + item XML), a real
channel-level RSS feed, New-episode + credits editing, self-hosted fonts,
migrations on every boot, Vitest (49 tests). Also found and fixed the Caddy/port-80
reboot problem (see Known issues).

## Live right now

`https://studio.tylerwoodward.me` — internal-DNS-only (resolves via 192.168.2.2
to this home server, 192.168.2.241). No public DNS record.

- Sign in as `tyler@fullymodulated.com`. Password is in `deploy/.env`
  (gitignored, `chmod 600`) as `PODSTUDIO_ADMIN_PASSWORD` — ask Claude to read
  it rather than storing it anywhere else. It only takes effect on first boot
  against an empty database; change it afterwards in Server settings → Your account
  (editing `.env` later does nothing to an existing account).
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
| 02 Episodes | Real — seeded SQLite, paginated table, status badges, and **"New episode"** (title, optional season/episode that auto-fill to latest season / next number; creates a private `recording` draft with a fresh UUID v4 `guid` (`isPermaLink` absent) and a separate UUID v4 `publicId`; duplicates of season/number allowed on purpose). The row ⋯ menu is real: **Open details**, **Duplicate** (new private `recording` draft, "Copy of …", next number, credits copied, fresh guid + publicId) and **Delete** (inline confirm). "Open in editor" was dropped — the editor (08) is a placeholder |
| 11 Episode details | Real — edit/delete at `/studio/episodes/:id`: title, subtitle, description, **season, episode number, explicit**, status, visibility; links to Publish to feed. guid/publicId are never editable. **People section**: add/remove host or guest credits (name autocompletes from existing people; matching is case-insensitive so one person isn't duplicated; the same person may hold two roles; exact duplicates rejected) — these feed `podcast:person` in the item preview and the public pages. **Audio section**: upload/replace/remove the episode's MP3 (see Media below). Not built: people's own website/socials, per-episode TXT records, chapters/AI suggestions |
| 15 Feed overview ("Podcast hosting") | Half real, at `/studio/feed`, laid out after the mockup: **RSS feed URL card with Copy** (`https://<host>/<slug>/feed`, plus items / size / last-episode-age read from the real feed), **Podcast 1.0** and **Podcasting 2.0** cards, the episodes actually in the feed (published + public + verified audio), and a Directories card. The validity cards come from `lib/feed-check.ts` run over the XML we serve (our own self-check, 5 unit tests, not Apple's validator) — **today it correctly reports 2 errors: the feed has no show artwork (`itunes:image`) or category (`itunes:category`)**, which Apple and Spotify require; neither field exists yet. Not built because nothing real is behind it: the mockup's "Hosting on" switch, per-directory status ("Not tracked yet"; needs Podcast Index, Stage 11), Import feed. The old status-count cards and the "Downloads & listeners" note were dropped from this screen (Analytics has its own). |
| 16 Show tags | Real — RSS/iTunes + a subset of Podcasting 2.0 tags at `/studio/feed/tags`, linked from Episodes. `person`/`podroll` deliberately not here; TXT records moved to 16b |
| 16b Lock & verify | Half real, at `/studio/feed/lock-verify` — TXT records CRUD and locking the feed are real; unlocking is deliberately not built (needs a verified owner email + emailed 6-digit code; no email delivery exists yet) |
| 17 Storage | Real config/routing, at `/studio/storage` — add/remove S3-compatible targets, a real test-connection (HeadBucket call), and routing raw/exports/feed-media to a target. Access/secret keys are entered through the screen's own form and stored server-side in the DB (never echoed back to the browser), not in `deploy/.env`. Nothing uploads to a target yet — that's Stage 02. **Two Garage targets are now configured and routed** (see Architecture → Storage) |
| 18 Server settings | Half real, at `/studio/settings/server` — Users (add/change role/remove) is real **and admin-only, enforced server-side (non-admins get 403 on those actions; controls hidden)**; **"Your account" lets any signed-in user change their own password** (current + new ≥ 8 chars + confirm; signs out every other device), on the existing Better Auth `users` table; "Add user" substitutes for "invite" (no email delivery yet, same gap as 16b). Domain shows the real hostname + "Caddy internal CA, LAN-only" as plain text, not a status badge (there's no real auto-TLS to report). Storage links out to 17 instead of duplicating it. AI keys (Whisper/LLM) and LiveKit URL/keys are an explicit "not configured" note — no schema, no stage reached |
| 27 Embed players | Real end to end, at `/studio/public/embeds` — config form (what to embed: one episode/latest/whole show; audio/video; theme; accent; chapters/transcript/follow) saved as the show default under `shows.settings.embed`; only public+published episodes selectable. The three code tabs are generated live, **and their targets now exist**: `/{show}/embed/{public-id\|latest\|all}` (iframe document in the README-28 dark/light tokens, theme=auto follows the OS, `follow=0` honoured, CSP `frame-ancestors *`, no cookies, query params allow-listed, all text escaped), `/embed.js` (turns `<div data-podstudio="show/target" …>` into the same iframe and auto-resizes from the iframe's postMessage — verified 152→247px), and `/oembed?url=` (JSON `rich` embed for a public episode or show URL on this origin; non-public/foreign-origin 404, bad url 400, non-JSON 501; discovery `<link rel="alternate" type="application/json+oembed">` on the public pages). The live preview is an iframe of that real route. **The embed now plays audio** (see "Embed player audio" below). Chapters, transcript chip and a real video player are not built (no data). Snippet origin is whatever host serves the request (public domain not chosen) |
| 31 Analytics | Thin by design, at `/studio/analytics` — every number (KPIs, chart, top apps, countries, per-episode Day 1/7/30/all-time) needs OP3 and is shown as "No data" rather than faked. Real: the 30d/90d/12m range control (URL `?range=`), the published-episodes table rows, the "Show overview on public page" switch (persisted at `shows.settings.analytics.showOnPublicPage`; nothing reads it until screen 25 exists), and an honest "OP3 / Podcast Index: Not connected" status |
| RSS feed (no screen number) | Half real, at `/{show-slug}/feed` (public, `application/rss+xml`, no cookies; linked from the public page's RSS button and Feed overview's "View feed XML") — channel plus **one `<item>` per published + public episode that has a verified MP3** (enclosure → `/{show}/media/{public-id}/…`, length = stored byte count, duration from the parsed file, description, people). Episodes without verified audio are never emitted. Channel: title, link, description (falls back to title if unset), language, atom self link, `itunes:explicit`, `podcast:guid` (as stored), `podcast:locked owner=…`, TXT records, funding, medium, updateFrequency, license, host `podcast:person`s, the podroll. Omitted on purpose: `podcast:value` (stored fields lack a recipient name/split) and `podcast:trailer` (needs pubdate/length/type). Builder is pure (`lib/feed-xml.ts`); verified well-formed with Python's XML parser and that `& < > " '` round-trip in description/funding/TXT/podroll. **Note: the live show is currently `locked = no`** (seeded unlocked; README says locked by default) — lock it from Lock & verify when ready; unlocking is deliberately unbuilt |
| 14 Publish to feed | Half real, at `/studio/publish?episode=<id>` (sidebar; also linked from Episode details for unpublished episodes) — pick an unpublished episode; **Schedule / Reschedule / Unschedule** are real (datetime in the show's timezone, converted correctly across DST — verified CST→15:30Z, CDT→14:30Z; sets `status=scheduled` + `publish_at`; unscheduling returns it to `editing`; `recording` episodes are refused). A read-only checklist shows which Podcasting 2.0 tags the data can actually support, and the feed-item XML preview (`lib/item-xml.ts`, guid written exactly as stored, `isPermaLink` only when the stored flag is non-null, person role omitted when unset) is built from the real episode. **Unpublish is real** (published episodes appear in the picker; two-step confirm; returns the episode to `editing` + `private`, clears `publishAt`, keeps the audio and guid — verified: feed item and audio URL go away, republish works). **Publish now is real**: needs a verified MP3 and a non-`recording` episode; sets `published` + `public` + `publishAt = now` (that is what lists it in the feed and on the public pages). The item preview now includes the enclosure when audio exists. Still absent: transcript/chapters/soundbite/alternateEnclosure/value tags; per-tag switches omitted because there's nothing to toggle. **Scheduled publishing is real**: the worker checks every 15 s and flips a due `scheduled` episode to `published` + `public` (`publish_at` stays as the scheduled time and becomes the item's pubDate; logic in `packages/db/src/scheduler.ts`, 6 unit tests). Scheduling now requires a verified MP3 (button disabled without one), and a due episode that somehow lacks verified audio is left scheduled with a one-time worker log line. Verified in the browser against the deployed build: scheduled ~1 min out, appeared in the feed ~35 s later with a 200 audio enclosure and the right pubDate; test episode cleaned up. Note: seed episode 42 ("The Transfer Portal, Explained") is scheduled for a past date with no audio, so the worker logs it as blocked and leaves it alone |
| 25 Public show page | Half real, at `/{show-slug}` (e.g. `/the-mic-drop`, **no login**, no cookies) — server-rendered from the DB: title, cadence (`updateFrequency`), description, hosts, social links (hero + footer, `rel="me noopener"`), latest episode, support card (when `fundingUrl` is set), paginated public episodes list (`?page=`), "Shows we recommend" from the podroll when its switch is on, Open Graph tags. Applies Brand & theme (29b) when its Public-site scope is on, else stock paper theme. **Only `published` + `public` episodes are ever queried** (`lib/public.server.ts`). Not built: artwork, category, Apple/Spotify follow buttons, , player/chapters/transcript/search, oEmbed discovery |
| 30 Public episode page | Half real, at `/{show}/episodes/{public-id}/{slug}` — title, meta (date, length, season/episode, guests), plain-text show notes (no HTML accepted, so nothing to sanitize), people, up-next, breadcrumb, OG tags. Public id is authoritative: wrong/missing slug 301s to canonical; unknown/unpublished/private → 404. Single-column, 44px targets, verified at 390 px with no horizontal scroll — this is effectively screen 26's layout, but **26 itself (`/public/episode-phone`) is still a placeholder route** and the sticky "Listen in your app" bar isn't built. Has a basic native `<audio>` player + Download MP3 when the episode has verified audio (else "Audio isn't available…"). Not built: custom player, transcript, chapters, soundbites, MP3 download, JSON-LD |
| 32 Podroll | Half real, at `/studio/podroll` (sidebar) — new `podroll_items` table (migration 0005). Manual add (title + required UUID `podcast:guid`, optional feed URL/note; rejects bad GUID, own GUID, duplicates case-insensitively), reorder (up/down), remove, `<podcast:podroll>` XML preview with escaping (`lib/podroll-xml.ts`, shared with the future feed generator), "Show on public page" switch (`shows.settings.podroll.showOnPublicPage`) feeding 25. Podcast Index search and the verified-GUID check need an API key (Stage 11) — every item is shown "Unverified" |
| 29b Brand & theme | Half real, at `/studio/public/brand` (linked from Embed players and Public page links, not in the sidebar) — accent (8 mockup presets or validated custom hex), public-site appearance, corners (Sharp 3/4 · Soft 8/12 · Round 20/18 px), and Public site / Embed players / Studio scopes, all persisted to `shows.theme`. The README's contrast rules are implemented in `app/lib/brand-theme.ts` (on-accent #111113 or #fff by contrast; link colour stepped until 4.5:1; studio ink→bone and <3:1 lightening) and shown in a live light/dark preview with the measured ratios. Consumers: the public pages (when the Public-site scope is on, else stock paper theme) and, **when the Studio scope is on (off by default), the studio chrome** — primary buttons, focus ring and an inset active-nav bar take the accent via CSS variables set in `routes/studio/_layout.tsx` (ink → bone, low-contrast accents lightened). The Embed-players scope has no consumer until screen 28 exists |
| 29 Public page links | Half real, at `/studio/public/links` — social links (add/toggle-visible/remove/reorder) are real on a new `show_links` table; platform picker enforces one-per-platform; handles get normalized to full profile URLs on save (Discord/LinkedIn require a full URL — their handle format can't be guessed). Real Font Awesome 6 brand icons per platform. Website is read-only, linking to Show tags (16) instead of duplicating that field. No drag-and-drop (plain up/down buttons instead), no live preview (needs the public page, screen 25, not built) |
| 08 Editor | **Real (Stage 04)**, full-screen at `/studio/editor?episode=<id>` (chooser without it; Episode details and the Episodes row menu have **Edit**). Multitrack canvas timeline, transport, split/trim/move/ripple, gain + fades, M/S/lock/height per track, retake + chapter marks, undo/redo, autosave revisions with conflict detection, audio upload, export. FX tab, loudness, video, shots, branding and the transcript lane are **not built** (later stages; FX shown disabled). See "Editor (Stage 04)" |
| 09 Retake cleanup | **Real (Stage 04)** as a docked panel inside the editor (`/studio/editor/retakes?episode=` opens it). Proposes one cut per retake mark from the tone + pauses in the audio, audition (join / removed part), ±0.1 s nudge, checkbox per cut, "Apply N cuts" = one undoable edit across all tracks. No transcript refinement (Stage 07) |
| 12 Export | **Half real (Stage 04)**: a dialog over the editor (`/studio/export?episode=` opens it). Audio tab only: WAV 16/24-bit × 44.1/48 kHz mono, rendered by the **worker** from an exact saved revision, read back + SHA-256 verified, downloadable, cancellable. MP3 (Stage 05), Video (10a) and Editor-project (10d) tabs are disabled |
| Library (new, not in the mockup) | **Real**, at `/studio/library` (sidebar, under Episodes): the show's reusable audio. Upload (button or drop, as Music or Sound effect), inline rename, default-track kind, preview, delete (refused while any episode uses it). Added to episodes from the editor's **Library** button. See "Fades, ducking, library" |
| everything else (17 screens) | Placeholder route only, zero feature logic |

**None of this is a passed BUILD_PLAN stage.** PREBUILD is still current per
`docs/design/STATUS.md` — its actual proofs (OPFS capture+crash-recovery
drill, 2hr/8-track memory benchmark, noise-reduction DSP null-test) haven't
been run. What exists is a compressed shell that happens to prove PREBUILD
proof #1 (dependency compatibility) as a side effect.

## Media (Stage 02 slice, built 2026-10-25)

- **Upload**: Episode details → Audio → Upload MP3. The browser PUTs the raw file to
  `/studio/episodes/:id/audio` (resource route under the login middleware; `X-Filename`
  header, not multipart) and the server streams it into the bucket routed for **feed media**
  via S3 multipart (`lib/media.server.ts`). Checks: `.mp3` name, MPEG/ID3 magic bytes,
  500 MB cap, then **read-back verification** — stored size must equal bytes received and
  `music-metadata` must parse MPEG audio with a duration. SHA-256, size, duration, sample rate
  and channels are stored on a new `assets` row (migration 0006); `episodes.audio_asset_id`
  only ever points at a `verified` asset. Failed uploads leave a `failed` asset row and delete
  the object. Replace deletes the old object; removing audio or deleting the episode deletes
  objects too (verified: bucket returns to 0 objects).
- **Serving**: `/{show}/media/{public-id}/{name}.mp3` proxies from storage with Range
  (206/416/HEAD), ETag = sha256, only for published + public episodes with verified audio;
  everything else 404s. The storage service itself has no public port.
- **Caveats**: only MP3 is accepted (no WAV/other, no loudness check or re-encode — that's
  Stage 05). `assets` is used only for episode audio so far; no `upload_sessions` table, no
  resumable/chunked upload (a dropped connection means start again — nothing partial is kept),
  no recording-chunk manifests (Stage 03). Uploads pass through the web process, so the
  public hostname/Caddy limits matter once that exists. The audio lives in the **public**
  bucket, so anyone with the URL of a *published* episode can fetch it (by design).

## Architecture snapshot

- Repo: `~/podstudio` (pnpm workspaces + Turborepo). `apps/web` (React Router
  **v8.4**, not v7 as BUILD_PLAN/README/CLAUDE.md say throughout — framework
  mode behaves the same, the version number in those docs just hasn't been
  reconciled yet), `apps/worker` (heartbeat + scheduled-publish tick, plus **export and import jobs** from `render_jobs`; still not Stage 00's general durable job runner), `packages/db` (Drizzle + better-sqlite3).
  `packages/audio` (**new, real**) holds the project document, plan, history, render and resampler shared by web and worker; `packages/{ui,feed,integrations}` are still empty placeholder dirs.
- Auth: Better Auth, Drizzle SQLite adapter. **No session cookie cache** (turned off 2026-10-23: it let revoked sessions live up to 5 min), so revocation — password change, removed user — is immediate; the role check for admin-only actions reads the DB, not the session. `users`/`sessions`/`accounts`/
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

- Storage: **Garage on this box** (single node, `dxflrs/garage:v2.1.0`), service
  `garage` in `deploy/docker-compose.yml`, internal-only (`http://garage:3900`,
  region `garage`, no host ports). Tyler first chose MinIO (2026-10-25) but its
  repo is archived and ships no images, so it was swapped out the same day
  (nothing had been stored in it). Config: `deploy/garage.toml`; `GARAGE_RPC_SECRET`
  in `deploy/.env`. The image is scratch-based, so run the CLI as
  `docker compose -f deploy/docker-compose.yml exec garage /garage ...`
  (`status`, `bucket list`, `key info podstudio-app --show-secret`). Layout is
  one node, zone `dc1`, 20G capacity assigned. Buckets `podstudio-private`
  (routes: raw + exports) and `podstudio-feed` (feedMedia) and the scoped key
  `podstudio-app` (read/write/owner on just those two) were made with the CLI
  — no bucket-creation code exists. Both targets are in Studio → Storage;
  both tested "Connected" in the browser. **Not a backup** — same disk. `/` was
  ~83% full (17 GB free); raise the 20G layout capacity only if there's room.

## Known issues, left as-is

- **Fixed 2026-10-25: `deploy/.env` was being baked into the web and worker images.**
  There was no `.dockerignore`, so `COPY . .` copied the secrets file (admin password,
  `BETTER_AUTH_SECRET`, Garage RPC secret), the dev `data/podstudio.db` and the host's
  384 MB `node_modules` into every image. Added `.dockerignore`; rebuilt both images and
  confirmed `/repo/deploy/.env` is absent in the running containers. Images built before
  this date held a copy — they were replaced, but don't push or share any older image. The
  same change added a persistent pnpm cache mount; a web+worker rebuild now takes ~3 min
  (it was 10–15 min per web-only rebuild).

- **FIXED 2026-10-23 — unauthenticated writes (security).** The studio's login
  gate was a *loader* on the `/studio` layout, which guards page loads but does
  not stop a child route's **action** from running: an unauthenticated
  `POST /studio/<anything>` executed its write and was only redirected
  afterwards (I confirmed it by flipping the podroll/analytics switches,
  rewriting the brand theme and creating an episode with curl and no session;
  all reverted). The gate is now **middleware** (`routes/studio/_layout.tsx`),
  which runs before every loader and action. Re-verified: with no session all
  writes are blocked (DB identical before/after) and `.data` requests redirect.
  `scripts/verify-studio-auth.sh` re-runs that check. **Exposure/forensics:**
  the studio host is LAN-only DNS, so this was reachable by machines on the
  home network, not the open internet; I can't tell whether it was ever
  exploited — web logs record method/path/status but not sessions, and old
  container logs were discarded on rebuild. If you want to be careful, skim the
  show/episodes/podroll/links/TXT/users data for anything you didn't make, and
  consider changing the admin password (Server settings → Your account).
  **Second hole, same day: open self-registration.** Better Auth serves
  `POST /api/auth/sign-up/email` whenever email+password is enabled, so anyone
  who could reach the host could create an `editor` account and sign into the
  studio (confirmed with a probe account, deleted). `routes/api.auth.$.ts` now
  returns 403 for `/api/auth/sign-up*`; admin "Add user" and the seed script
  create accounts in-process (`auth.api.signUpEmail`) and are unaffected
  (re-verified). Accounts exist only if an admin adds them.
  **Also added the same day:** baseline response headers from `apps/web/server.js`
  — `X-Content-Type-Options: nosniff`, `Referrer-Policy:
  strict-origin-when-cross-origin`, and `X-Frame-Options: SAMEORIGIN` on
  everything **except** `/{show}/embed/*`, which must stay framable (it sets its
  own `frame-ancestors *` CSP). Verified a third-party page can frame the embed
  but not `/login` or `/studio`. Not done: a site-wide CSP, HSTS (Caddy/host
  decision — careful, `tylerwoodward.me` already has HSTS includeSubDomains).
  Any *new* route with an `action` must live under `routes/studio/` (so the
  middleware covers it) or do its own session check.

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

- **Fixed 2026-10-23: Caddy lost a port-80 race after a host reboot.** The
  apt-installed system `caddy.service` was *enabled* (with a stray `:80 {
  reverse_proxy localhost:8000 }` config, nothing on :8000), so after the
  05:33 reboot on 10-22 it took :80 before Docker and `podstudio-caddy-1` exited
  128 — the studio URL refused connections for ~16 h. Tyler ran `sudo systemctl
  disable --now caddy`; the real container was then **force-recreated**
  (`docker compose -f deploy/docker-compose.yml up -d --force-recreate caddy`)
  because merely starting the stale failed container left its ports unpublished.
  Verified: :80 → 308 to https, :443 → 200, :8081 serves the CA root, feed 200,
  and the served chain is the same "Caddy Local Authority" root (no re-trust
  needed). If this ever recurs, check `ss -ltn | grep ':80 '` and
  `systemctl is-enabled caddy` first.
- **Migrations now run on every web-container boot** (fixed 2026-10-22). Before
  this the entrypoint only migrated against an *empty* volume, so any new
  migration in a rebuilt image never reached the existing DB — screen 32 500'd
  with `no such table: podroll_items`, and 0004 (`show_links`) must have been
  applied by hand last session. Seeding is still first-boot only.
- Fonts (Geist, JetBrains Mono) are self-hosted via `@fontsource/*` (latin subset, imported in `app.css`); verified the public page and studio contact only `studio.tylerwoodward.me` — no Google Fonts request. (Fixed 2026-10-22; it used to violate CLAUDE.md's no-third-party rule on public pages.)
- **`pnpm test` now runs Vitest** (`apps/web`, 49 unit tests over the pure libs:
  brand-theme contrast maths, item/feed/podroll XML, embed escaping and
  allow-lists, episode-form parsing, DST-correct timezone conversion; mutation-checked — breaking the code makes them fail). Still no
  `lint` task, no CI, and no committed browser tests: UI verification has been
  ad-hoc Playwright scripts. `playwright-core` isn't in the repo — install it
  in a temp dir and point at `~/.cache/ms-playwright/chromium_headless_shell-*`.
  Hidden traps from those scripts: `waitForURL(/studio/)` matches the hostname;
  read the DOM only after waiting for the new text, not right after a click.

## Where to look next

Reference docs: `docs/design/STATUS.md` (stage-gate table), `docs/design/CHANGELOG.md`
(dated session history, newest first), `docs/design/BUILD_PLAN.md` (confirmed
scope/architecture/data model), `CLAUDE.md` (working rules).

**First thing next session:** `docker compose -f deploy/docker-compose.yml ps` — `caddy`, `web`, `worker` should all be `Up` (Caddy was repaired 2026-10-23; see Known issues).

**Next: Tyler's review of Stage 04** (list under "Editor (Stage 04)"), then — only on your go — Stage 05 (noise reduction, voice FX, loudness, MP3) or closing PREBUILD formally. The screens that don't need new infrastructure are done. What's left is
blocked, not forgotten:

- **13 Clips, 13b Short video style, 10 Transcript, 06 Record with a guest, 03/04/05 remote/guest, 19–24 mobile** all need capture,
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

**Decisions recorded for Tyler:**
0. **Stage 04 review** — in particular: (a) own timeline instead of waveform-playlist (see Editor section), (b) is the mockup's bottom transport / retake-region UI required before sign-off, (c) PREBUILD performance budgets (none recorded, so the 2-hour numbers have nothing to be judged against).
1. ~~S3-compatible storage target~~ — decided: local S3 on this box, Garage (2026-10-25).
   Stage 02 (uploads → enclosures, Publish-now, playback) is now unblocked.
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

## Planned, not designed or built yet

- **Teleprompter as a pop-up overlay (later stage; added 2026-10-25 at Tyler's request).** Let the teleprompter open as an overlay window on top of whatever screen is open, with the background dimmed, instead of only as a full-screen stage. Needs a design pass first (mockup, then build). Decided with Tyler (2026-10-25):
  - **Where:** over both the recorder and the editor.
  - **Size and position:** static (not draggable or resizable), taking up about 90% of the screen, with the dimmed app visible around it.
  - **Controls:** scroll speed, font size and keyboard shortcuts: yes.
  - **While recording:** stays open during a take and works with the retake key (K): yes.
  - **Still open:** whether to also offer a separate browser window for a second monitor (Tyler's answers covered four of the five questions; confirm this one in the design pass).
  The script already exists as episode data (`saveScript`, solo recorder).

## Studio shell / sidebar (2026-10-25)
Rebuilt after the mockup (`components/layout/studio-shell.tsx`): logo, show card (title + episode count, from `lib/shell.server.ts`), Episodes, Podcast hosting with its sub-nav (Feed, Analytics, Show tags, Podroll, Storage, Move podcast; Public page & embeds' three real pages are listed under it so Brand & theme and Public page links stay reachable), Server settings, and the user block (initials, name, role) with command-menu and sign-out buttons. The top header bar is gone (pages carry their own title). Show templates / FX presets / Writing style are shown **disabled** (no screens exist). Record, Editor, Clips and Publish to feed have no sidebar entry (as in the mockup): Publish is reached from the episode page, the rest from the ⌘K menu, which lists every screen. Also fixed: Escape now closes the ⌘K menu (it never did). `lib/screens.ts` `inSidebar` flags / `sidebarScreens()` are no longer used by the shell.

## Show artwork, category, author (2026-10-25)
Show tags (`/studio/feed/tags`) now has **Show artwork** (upload/replace/remove), **Author** and **Category + Subcategory** (Apple's closed list, `lib/podcast-categories.ts`; stored in `shows.podcast_tags` as `author`/`category`/`subcategory`). Artwork is checked server-side (`lib/image-info.ts`: PNG/JPEG by magic bytes, square, 1400–3000 px, ≤ 5 MB), stored in the feedMedia bucket, read back and hash-compared before it counts (`lib/artwork.server.ts`; asset kind `show_artwork`, `shows.artwork_asset_id`, migration 0007). Served publicly at `/{slug}/artwork/{sha12}.{png|jpg}` (hash in the name → immutable; stale names 404). The feed now writes `itunes:image`, nested `itunes:category` and `itunes:author` when set, so the Feed overview's Podcast 1.0 card goes green once they are. The sidebar show card shows the artwork. **They are not set on the live show** — I tested with throwaway values and cleaned up; set your own. Not done: artwork on the public show page and per-episode artwork.

## Public artwork + "where do I fix this" links (2026-10-25)
The public show page (`/{slug}`) shows the show artwork in the hero, and both public pages emit `og:image` when artwork is set. Every problem the Feed overview reports (`lib/feed-check.ts`, `FeedIssue`) now carries a `fix` — the studio location, shown as "Fix it in Podcast hosting → Show tags → Category →" and linking to `/studio/feed/tags#category`. The studio shell scrolls to and focuses `#anchor` targets (the page scrolls inside `<main>`, so the browser's own anchor handling doesn't work). The Publish screen's "needs a verified MP3" hints link to the episode's audio upload the same way. **Convention for new warnings: say where to fix it and link there.**

## "View public page" shortcuts (2026-10-25)
Brand & theme, Public page links, Embed players, Show tags and Podroll have a **View public page ↗** button (new tab, `components/view-public.tsx`; the show slug comes from `ShowSlugContext`, set by the studio shell). The episode page has **View public episode page ↗** when the episode is published + public (hidden otherwise, since it would 404). Convention: any screen that changes what the public site shows gets this button.

## Collapsible sidebar sections (2026-10-25)
Podcast hosting and its "Public page & embeds" sub-group have chevron toggles (`aria-expanded`); the choice persists per browser in `localStorage["podstudio.sidebar"]` and survives reloads. Moving *into* a collapsed section from elsewhere (link, ⌘K) reopens it so the active page is visible; a reload on a page inside it keeps your choice. Episodes and Server settings are single items, so there is nothing to collapse.

## Studio shell is pinned to the viewport (2026-10-25)
Reported: after clicking the sidebar and scrolling, the whole shell shifted up and left blank space at the bottom. I could not reproduce it in headless Chromium, so the fix targets the likely causes: the shell was `h-screen` (100vh, which can be taller than the visible area) inside a scrollable document, and `overflow:hidden`-style boxes can still be scrolled by focus/`scrollIntoView`. It is now `fixed inset-0` with `overflow-clip` and a `minmax(0,1fr)` row, and `<main>`/nav use `overscroll-y-contain`. Verified at two viewport heights that after forced `scrollTo`, `scrollIntoView`, focus, wheel and End the sidebar stays at top 0, content reaches the bottom, and the document is not scrollable. **If it still happens, note the browser and window size** — that would point at something I couldn't see in Chromium.

## Embed player audio (2026-10-25)
`/{show}/embed/{public-id|latest|all}` is now a working player (`lib/embed-player.ts`): play/pause, −15 / +30, scrubber, time, speed (1/1.25/1.5/2×), show artwork, Media Session lock-screen controls, and in the whole-show playlist click-to-play with auto-advance. It never autoplays and loads nothing until you press play (`preload="none"`). Audio comes from the public media route (Range-capable), only for episodes with a **verified** MP3; published episodes without one (seed episodes 38–40) show as disabled rows / "Audio isn't available for this episode yet". `embed.js` re-fires `podstudio:play|pause|ended|timeupdate` on the host element (`detail`: `id`, `currentTime`, `duration`). CSP gained `media-src 'self'; img-src 'self'`. Verified in Chromium incl. a cross-origin host page framing the embed. Not done: chapter scrubber/chip, transcript chip, real video, play counting (OP3, Stage 11), pushing colour-scheme changes to the iframe. Audio can't be heard in headless tests — playback was verified by `currentTime` advancing, seek/skip/speed values and events, not by listening.

## Public pages + embed player polish (2026-10-25)
Redesigned after the mockup (screens 25, 30, 28), using only real data: **show page** — sticky header with artwork mark and Follow, large artwork hero, eyebrow (cadence · category · count), 60px title, description, host avatars, labelled follow pills (RSS, website, socials), Latest episode card with a working player, episode list rows (play affordance, Ep. N, title + "with guest"/Solo, date, mono duration), recommendations as cards, footer with © / RSS / socials. **Episode page** — breadcrumb, big title, icon meta row, player card (artwork, −15/+30, scrubber, speed, Download MP3, Subscribe by RSS), About this episode, People cards, Up next with artwork (3 episodes) and a support card. The public pages now use their own player (`components/public/audio-player.tsx`, Media Session, nothing loads until play) instead of the browser's native control. **Embed player** — card with artwork, "Show · Ep. N", Follow pill, bold title, round play button, scrubber with accent fill, mono time, speed; playlist rows with durations. **Video option** shows SMPTE-style colour bars with a black "VIDEO NOT AVAILABLE" station-ID box (no video player exists). Durations under a minute read "44 sec". Added dependency `@fortawesome/free-solid-svg-icons` (imported per icon). Not built (no data): chapters, transcript, soundbites, "mentioned in this episode", follow-in-app buttons (Apple/Spotify URLs aren't stored), the stats strip (needs OP3). Light/paper theme (Public-site scope off) was not re-screenshotted after the restyle; dark was checked at desktop and 390px mobile.

## Public site: site-wide player, richer list, directory links (2026-10-25)
Ideas from Buzzsprout's public page, built on real data. **Site-wide player**: the public show + episode pages now sit under a layout route (`routes/public/_layout.tsx`, pathless, children keep their `:showSlug` paths) that owns the chrome and one `<audio>` (`components/public/player-context.tsx`). Any play button (list row, Latest card, episode page) drives it; a sticky bottom bar (`sticky-player.tsx`) shows title/scrubber/−15/+30/speed/close and keeps playing across client-side navigation; it steps aside while the current track's own inline player is on screen; Media Session incl. next/previous; auto-advances through the page's queue. Nothing loads until play. **Episode list rows** now have a play button that plays in place, a 2-line description snippet, and a "date • Ep. N • length • with guest" line; **search** (`?q=`, title/subtitle/description, LIKE with escaped wildcards, shown when the show has more than 5 public episodes or a query is active; Latest card hidden while searching; pagination keeps `q`); **"Podcasting since {year}"** in the eyebrow (earliest public episode); description **Show more/less**. **Follow area**: directory buttons (Apple Podcasts, Spotify, YouTube Music, Pocket Casts, Overcast, Amazon Music) shown only for the ones set under **Public page links → Listen on** (`shows.settings.directories`; https links on the directory's own hosts only, validated in `lib/directories.ts`), then RSS, **Copy RSS link**, website, socials. Feed overview's Directories card now says "Link on public page" / "Add link" (it still can't tell whether a directory accepted the feed). Not done: per-episode thumbnails (episodes have no artwork of their own, so the show art would just repeat), hosts/guests section with headshots and person pages, SEO structured data/sitemap, Podcast-Index artwork for recommended shows. None of the directory URLs are set on the live show — add yours in Public page links. Verified in Chromium incl. 390px; playback by `currentTime`/state, not by ear.

## Public site: hosts & guests, SEO, share (2026-10-25)
**Hosts & guests** — new studio screen `/studio/people` (+ `/studio/people/:id`; sidebar: Podcast hosting → Public page & embeds → Hosts & guests): add people, set role (host/guest), bio, website and a **headshot** (PNG/JPEG ≥ 200×200, ≤ 5 MB; verified read-back like the show artwork; `people.bio`, `people.avatar_asset_id`, migration 0008, asset kind `person_avatar`). Deleting is blocked while a person is credited. Public: a **Hosts** section on the show page, host avatars/names in the hero (linked), guest names in the episode list linked, People cards on episodes linked, and profile pages at `/{show}/people/{id}/{slug}` (id authoritative, wrong slug 301s) listing their public episodes with in-place play. **Privacy rule (tested):** hosts are always public; a guest's profile *and* headshot (`/{show}/avatar/{id}/{sha}.{ext}`) 404 until they're credited on a published, public episode — a draft credit exposes nothing. **SEO** — `/sitemap.xml` (show, public episodes, listed people; drafts excluded), `/robots.txt` (blocks /studio, /api, /guest, /mobile), canonical + Open Graph + Twitter `summary` card on all public pages, JSON-LD (`PodcastSeries`, `PodcastEpisode` with `AudioObject`/duration/series, `Person`), search-result pages are `noindex`. **Episode extras** — Share panel (copy link, copy link at current time, copy embed code, native share), `?t=` deep links, Newer/Older episode links, directory buttons under the player. Pure builders are in `lib/seo.ts` (+tests). Not done: per-episode artwork, person social links, a people index page, structured data for chapters/transcripts. The real sitemap URL uses whatever host serves it (no public hostname yet). Test people were created and deleted; none are left.

## Episode descriptions / show notes (2026-10-25)
The episode page's **About this episode** section renders the episode's Description right after the player, with live **links** (new tab, `noopener noreferrer nofollow ugc`), **timestamps** (`12:34`, `1:02:03` → buttons that start the episode there in the site-wide player) and **bullet lists** (`lib/notes.ts`, 9 tests; notes stay plain text, never HTML, `javascript:` is never linked). The same text feeds the list snippet, meta description, JSON-LD and the feed item. Episode details' Description field is taller and says what it does; the Publish checklist now has a "description (show notes)" row that links to the field (and the MP3 / credits rows link to theirs). **None of the published episodes (38–40, 42) currently has a description, and the show itself has none either — they need writing; nothing is invented.** Riverside-page ideas noted for later: episode grid cards with per-episode artwork, light/dark toggle in the header, Subscribe menu, header search/share icons, Recent/Popular tabs.

## Rich-text descriptions + WYSIWYG editing (2026-10-25)
**Editing**: the episode Description, the show Description (Show tags) and the person Bio are now WYSIWYG (`components/rich-text-field.tsx`, TipTap): headings, bold/italic/underline/strike, bullet + numbered lists, quote, divider, links, images (https URL), undo/redo, clear formatting, plus an **HTML** tab for raw markup (tables, embeds). Switching HTML → Visual warns when it would drop tables/embeds. **Storage**: descriptions are now sanitised HTML (older plain-text entries still work — `toHtml` converts them on the fly); everything goes through `lib/rich-text.server.ts` on save *and* on render. **Public pages** render the HTML with a generous allowlist — headings (h1→h2), lists, quotes, tables, code, `details`, https images, and iframes only from YouTube / Vimeo / Spotify / Apple Podcasts embeds — and never scripts, styles, event handlers, forms or `javascript:`/`data:` URLs. That limit is deliberate: the public site shares an origin with the studio login, so a script in a description would run with the admin session; "full HTML" therefore means everything except what can execute code. Links get `target=_blank rel="noopener noreferrer nofollow ugc"`. Bare timestamps in the text become buttons that seek the player (`RichNotes`). **Feed**: item `<description>` is CDATA with a small Apple-safe subset (p, br, lists, links, bold/italic/underline, quotes, h2–h4, code; no images/tables/iframes) plus a plain `itunes:summary`; the channel description is plain text. List snippets, meta tags and JSON-LD use plain text (`htmlToText`). Known limitation: episode search matches the stored HTML, so searching a tag name like "strong" can match. **Placeholder content**: I filled in sample descriptions so you can see the layout — episodes 38, 39, 40, 42 (each ends with an italic "Placeholder show notes" line), the show description, and bios for Alex Rivera, Tyler N Woodward and Dana Ruiz. Replace them in Podstudio; nothing else was changed.

## Per-episode artwork, card grid, header image, thumbnails (2026-10-25)
**Episode artwork** (Episode details → "Episode artwork"; optional; PNG/JPEG, square, 1400–3000 px, ≤ 5 MB; `episodes.artwork_asset_id`, migration 0009, asset kind `episode_artwork`). Without it the show artwork is used everywhere. With it: the public episode page (player card, `og:image`, JSON-LD), list/grid cards, Up next, the sticky player + lock screen, the embed player, and the feed (`<itunes:image>` on the item). Public URL `/{show}/episode-art/{publicId}/{sha}.{ext}`; a draft's cover 404s. **Card grid**: the show page's episode list is now a Riverside-style grid by default (16:10 tile with the cover over a blurred wash, in-place play button, title, date • length); a Grid | List toggle (`?view=list`, kept through search and paging). **Header image** (Brand & theme → "Header image"; PNG/JPEG ≥ 1600×400 and ≥ 2.5:1, ≤ 6000 px wide, ≤ 5 MB; `shows.banner_asset_id`, migration 0010, kind `show_banner`): a full-width banner at the top of the show page with the artwork overlapping it; with none, a soft blurred wash of the show artwork. **Thumbnails**: every public image has an `-s` variant (`{sha}-s.{ext}`: 640 px for covers, 256 for headshots, 1920 for the header) generated by sharp on first request and stored next to the original (`lib/image-assets.server.ts`; nothing to backfill; removing an asset removes its thumbnail); pages use them wherever the picture is small. Also fixed: **duplicating an episode no longer copies its audio/artwork asset ids** (deleting either copy used to delete the other's file), and removing an episode's audio no longer deletes its artwork. New deps: `sharp`. Not done: artwork thumbnails in the studio's episode list; Recent/Popular tabs (no play data until OP3).

## Solo recording (Stage 03 slice), 2026-10-25
**Where**: Episode details → **Record** (also the Episodes row menu, and ⌘K → "Solo prompter" which asks which episode) → `/studio/record/solo?episode=<id>`, a full-screen stage laid out after the mockup (script prompter, REC pill + timer, live 60 s waveform, big RETAKE/K button, retake list, input picker + level meter). **How it works**: AudioWorklet (`public/pcm-capture.worklet.js`) captures mono 48 kHz PCM with echo cancellation / noise suppression / AGC **off**; the worklet's sample count is the recording clock (it starts at 0 on `begin`). 2 s chunks (24-bit PCM) are written to an **IndexedDB journal first** ("saved locally"), then uploaded one at a time; the server re-hashes each chunk (declared size + SHA-256 + read-back size) before it counts ("verified"); retries/backoff while offline. **Finalize** builds `recordings/{id}/{asset}.wav` by streaming the verified chunks (never whole in memory), checks the stored size, creates a private `raw_audio` asset on the *raw* storage target (Garage private bucket), then deletes the chunk objects. It **refuses to cross a gap**; "Finish with the gap" (`allowPartial`) keeps the contiguous start and records `report` (gaps, lost tail). **Retake (K or the button)**: a 1 kHz / 250 ms / −6 dBFS tone with 5 ms fades is *added into the captured samples* by the worklet and a sample-timed annotation is saved (`recordings.annotations`); tone constants live in `lib/capture-contract.ts` (+ `findRetakeTones` for the later cleanup editor). **Recovery**: reload after a crash/closed tab → banner with what's journaled, how many chunks the server already has, and the **measured lost tail** (capture clock at the last 250 ms heartbeat minus journaled audio); "Upload & finish" finalizes as *incomplete* with that tail reported. Playback uses `/studio/recordings/:id/audio` (auth-gated, Range). New tables: `recordings`, `recording_chunks`, `episodes.script` (migration 0011). Tests: 60+ unit tests (contract, worklet driven in a fake scope, chunk analysis) and a real-browser run with a fake microphone (`rec.mjs`, 44 checks): a 7 s take with two K presses (tones found in the WAV within ~6 ms of their annotations, no discontinuity at chunk boundaries), idempotent/conflicting/corrupt chunk uploads, gap refusal and explicit partial finalize, a tab killed mid-recording and recovered (incomplete, tail reported), a take recorded across 5 s offline (uploads catch up, complete), private audio not reachable without a session, delete cascade.
**Not done / honest limits**: the Stage 03 acceptance runs that need long sessions — a **30-minute upload with no gaps** and a **2-hour memory/buffering run** — have *not* been done (only short takes); the plan's OPFS journal was not built (IndexedDB only; quota/write errors are reported and the audio is held in memory for upload meanwhile); no pause/resume; mono only; Notes/Prep/Links tabs of the mockup are not built; "Follow my voice" is disabled (Stage 13); no mobile layout; the real-microphone path (device pickers on real hardware) is only verified with Chromium's fake device. Stage 03 is **not** marked passed in STATUS.md.

### Solo recording: 30-minute run (2026-10-25)
A 30:00 take with a fake microphone in headless Chromium (script `long.mjs`, kept out of the repo): **899 chunk boundaries, none with a discontinuity; no silent hole (longest quiet run 200 ms); duration 1800.22 s; 247.2 MB 48 kHz mono 24-bit WAV, header and size consistent; all 3 K tones in the file within ≈7 ms of their annotations; server status `complete`, no report; stop → verified WAV took 10.9 s.** Browser JS heap stayed 9–12 MB; upload backlog never above 1 chunk; the web container grew from ~133 MB to ~211 MB after assembling (assembly streams chunk by chunk). **Browser storage grows ~8 MB/minute** because the journal keeps every chunk until the server verifies the finished recording (by design): ≈ 250 MB at 30 min, so ≈ 1 GB at 2 h — the 2-hour run still has to show whether IndexedDB quota and memory are acceptable (and whether chunks should be dropped from the journal once the server has verified them, keeping only a bounded tail). **Not yet run:** the 2-hour budget run and real-hardware qualification beyond the one real take (a 15 s take on a MacBook's built-in microphone in Chrome, made during this session, finalized complete at 48 kHz input).

### Solo recording: 2-hour run (2026-10-25/26)
Fake microphone, headless Chromium, `validation/recording/run-long.sh 120` (detached). **First run failed one check:** at ~1:58 the browser's local journal showed a save error with storage at 977 MB (the journal kept every chunk until the whole take was finalized). The audio was unaffected (server file verified, no gaps) but the last ~2 minutes had no local backup. **Fix:** once the server verifies a chunk its bytes are dropped from the journal (only the meta row stays), and a red banner says how many seconds of audio exist only in the tab if a local save ever fails while uploads are stalled; the test now also fails if browser storage exceeds 60 MB. **Rerun, all checks passed:** 2:00:00.66 recorded, finalized complete with no report; 988.9 MB 48 kHz mono 24-bit WAV; 3599 chunk boundaries with no discontinuity; no silent hole (longest quiet run 200 ms); all 3 retake tones within 50 ms of their annotations; max upload backlog 1 chunk; JS heap 12-16 MB flat; browser storage max 2 MB (was 977 MB); web container 115-150 MiB during the run; stop to verified WAV 39.6 s; no JS or local-journal errors. Still not done: real audio hardware, Firefox/Safari, OPFS journal, pause/resume.

## Editor (Stage 04), built 2026-11-01 — awaiting review

**Not marked as a passed stage** (PREBUILD is still "current" in STATUS.md, and the Stage 04 checklist below has real gaps). Everything listed as done was verified in headless Chromium against the deployed Docker build; scripts are in `validation/editor/` (README there).

**Design decisions (please confirm):**
- **I did not use `@waveform-playlist/browser`**, although BUILD_PLAN/Stage 04 name it. It decodes whole files into `AudioBuffer`s (a 2-hour mono 48 kHz file is ~1.4 GB of float32 per source) and drags in Tone, styled-components and dnd-kit; BUILD_PLAN itself says to pick a *bounded decode* strategy first. Instead: the application-owned project document (`packages/audio/src/document.ts`) + a canvas timeline (`components/editor/`) + a Web Audio player that streams the WAV by HTTP Range in 10 s windows (≤ 10 windows in memory) and schedules every piece on the audio clock (`lib/project/player.ts`). The plan that decides *what plays when* (`planPieces`, `gainBreakpoints`) is shared with the worker render.
- Sources must be at the project rate (48 kHz); mono only. Imported audio is converted to that on the way in.

**What exists**
- *Document* (`packages/audio/src/document.ts`, re-exported by `apps/web/app/lib/project/*`): tracks (host/guest/music/sfx; mute/solo/lock/height 64–260), clips in **integer source samples** (`srcStart`, `length`, timeline `start`, `gainDb`, linear fades), annotations anchored to *source* samples (retakes, chapters) so they follow the audio. Pure edits: split, trim, move, delete, `cutRange(s)` (ripple or leave-gap; ripple refuses if a track with audio is locked or left out, because that would silently desync it), add track/clip, levels. Original-to-edited time map (`timeMap`, `sourceToEdited`, `editedToSource`). `parseProject` validates untrusted JSON on the server. Undo/redo (`history.ts`, 200 steps, same-group edits merge). 32+ unit tests (mutation-checked).
- *Persistence*: tables `projects`, `project_revisions` (migration 0012). Every autosave appends an immutable revision whose parent must be the current one; a stale tab gets **409 + the current revision** and the editor shows a banner (Load newer / Keep mine). Source assets are re-checked server-side (verified, same episode, `raw_audio`, right length/rate). Routes: `GET|POST /studio/projects/:episodeId`, `POST …/start` (project is created from a finished recording). Deleting an episode deletes its project, jobs and files; deleting a recording used by a project is refused.
- *Waveforms*: `PeakBuilder` streams the WAV once and caches min/max per 256 samples beside it (`<key>.peaks1`, 2.6 MB for 2 h); `GET /studio/assets/:id/peaks`, audio at `/studio/assets/:id/audio` (Range). Recording-keyed routes still exist for the recorder.
- *Timeline*: virtualised canvas per track (draws only the visible window), ruler, retake/chapter lane, drag to move/trim, drag the ruler to select a range, Shift+drag in a track, zoom, resizable track height. Keys: Space play, X split, Delete ripple-delete, Shift+Delete leave gap, M/S/L, ↑↓ select track, +/− height, ←/→ (Shift = 10 s) nudge the playhead, Home/End, Ctrl+Z / Ctrl+Shift+Z; nothing fires while typing in a field. S is solo, not split.
- *Retake cleanup*: `lib/project/retake.ts` — finds the 1 kHz tone near each mark, measures 10 ms loudness frames (threshold = noise floor + 10 dB), walks back through the flubbed phrase to the previous pause ≥ 350 ms and forward to where the redo starts, leaving ≤ 150 ms of pause either side; flags "tone not found" and "no pause found". 7 tests, checked in the browser against bursts detected independently in the WAV.
- *Upload audio* (Stage 04 "upload/drop existing audio"): header menu, empty-track button, drag-and-drop, "+ Add track". Original kept as-is (`import_original` asset, private raw bucket); the **worker** runs ffprobe (must have an audio stream, ≤ 8 h) and ffmpeg → 48 kHz mono 24-bit, writes our 44-byte-header WAV, reads it back and hashes it; the editor then places the clip at the playhead (next free spot) as one undoable edit. Accepts wav/mp3/m4a/aac/flac/ogg/opus/aiff/wma/mp4/mov/webm up to 1 GB; others are refused with 415; a non-audio file fails with ffmpeg's message. **ffmpeg is now installed in the worker image.**
- *Export*: table `render_jobs` (migration 0013), worker loop every 2 s: atomic claim, 60 s lease renewed while running (a restarted worker re-claims an abandoned job; ≤ 3 attempts), cancel polled between 1 s blocks, partial objects deleted on failure. `packages/audio/src/render.ts` mixes all audible tracks to mono (mute/solo honoured), applies gain + linear fades, optional 44.1 kHz (96-tap Kaiser polyphase; flat to 20 kHz, −52 dB at 22.5 kHz, −90 dB from 23.5 kHz), 16-bit TPDF dither (seeded → byte-identical reruns). The worker hashes the stream while rendering and compares with a full read-back of the stored object. Download at `GET /studio/exports/:id`. Routes: `…/exports`, `/studio/exports/:id`.
- **Garage quirk:** it reports a wrong `x-amz-checksum-crc32` for whole multipart objects, so the AWS SDK aborts a full-object GET (it killed the first 2-hour export's read-back). Both `clientFor`s set `responseChecksumValidation: "WHEN_REQUIRED"`; integrity is our own SHA-256.

**Measured (headless Chromium + this server; no PREBUILD budgets exist to compare against)**
- Parity: export vs the sample-by-sample definition of the edit (cuts, ripple, fades, gain, mute/solo): residual −163 dBFS (24-bit/48 k, requirement −60); 16-bit dithered < −80 dBFS; 44.1 kHz keeps level within 0.01 dB. Independent check against the source recording at six positions of the 2-hour export: worst −147.9 dBFS. Original recordings are byte-identical after editing.
- 2-hour synthetic recording (`validation/editor/make-2h.mjs`), 8 tracks × 1,166 clips: peaks built in 5.2 s (cached 112 ms); editor open → all 8 tracks painted 0.4 s; scroll redraw median 33 ms / p95 51 ms; seek 17 ms; playing 12 s on 8 tracks fetched 2.7 MB; split 119 ms, ripple delete 78 ms, undo 59 ms in the UI; autosave of a 199 KB document 26 ms. Export of the whole thing: **57 s**, worker ≈ 312 MiB, 1.04 GB WAV verified.
- Imports: MP3 (44.1 kHz stereo), FLAC, M4A (22 kHz) decoded; our decode vs a host ffmpeg decode: identical (residual −200 dBFS, same length).
- Security: every new route is under the login middleware; `scripts/verify-studio-auth.sh` now also probes project save, export create/delete and the GETs (all 302, DB unchanged). Downloads and audio need a session.

**Timeline feel fixes (2026-11-01, after first use)** — Tyler reported the waveform lines swimming when a clip is dragged and rough horizontal scrolling. Causes and fixes: (1) the waveform was bucketed on a grid cut from the *viewport origin*, so at any fractional clip start or fractional `scrollLeft` (trackpads) every column re-sliced the audio — now everything is snapped to whole content pixels and columns are bucketed from the **clip's own first pixel** (`draw.ts`; 4 unit tests incl. one that reproduces the old behaviour); (2) the canvas was repositioned through React state a frame behind the scroll and every scroll event re-rendered and redrew all tracks — now each track draws into a **tile three viewports wide in content space**, so scrolling is native and JS-free, with a re-centre only when the viewport gets within half a viewport of the tile's edge (150 fast scroll steps across several re-centres: 0 undrawn frames); (3) drags are coalesced to one document update per frame and a track only redraws when *its own* clips change; (4) `overscroll-behavior-x: contain` stops a horizontal trackpad swipe triggering browser Back; (5) ruler labels show 2 decimals at quarter-second steps. Not reproducible in headless Chromium (whole-pixel coordinates), so the swimming fix is proven by the draw unit tests, not by a browser run — **please confirm on your trackpad**. Also fixed from the same pass: retake cleanup now also cuts the rest of a phrase when K was pressed mid-sentence (it used to stop at the tone and leave the tail).

**Timeline UI pass 2 (2026-11-01, from Tyler's screenshot):** (1) track lanes, the ruler and the retake lane now run to the right edge of the timeline however short the project (they were only as wide as the content, so the lines stopped mid-screen); (2) sliders are styled (`components/ui/range.tsx` + `.ps-range` in `app.css`: slim track with a filled part, round thumb) — gain and track height; (3) scrollbars are thin, dark and on-theme everywhere (`app.css`, WebKit and Firefox); (4) **mouse wheel works like a DAW**: up/down scrolls the timeline sideways, Shift+wheel scrolls the tracks up/down, Ctrl/⌘+wheel and a trackpad pinch zoom around the pointer (verified: the time under the cursor stays put), sideways swipes stay native; zoom buttons keep the playhead fixed; zoom-out now stops at "whole project fits"; (5) the playhead could be stranded past the end after an edit shortened the project ("0:19.0 / 0:11.9") — it is now clamped; (6) the header stays one 48 px line at 1440 px (title/subtitle truncate, save status never wraps). Scrollbar and slider looks were checked in screenshots with scrollbars enabled; test: `validation/editor/wheel-lanes-sliders.mjs`.

**Track rename in place (2026-11-01):** click a track's name in the header to edit it right there (Enter or clicking away saves, Esc cancels, empty is refused, undoable; shortcuts are suppressed while typing). Test: `validation/editor/rename-track.mjs`.

**Stage 04 checklist — what is NOT done / caveats**
- **No CI/lint**; the browser tests are scripts in `validation/editor/`, not a `pnpm e2e` task. 211 unit tests pass (typecheck 3/3, `pnpm build` ok).
- **Preview ↔ export parity was not measured through Web Audio.** Both follow the same plan and the export is proven against the definition, but nobody has captured the browser's audio output and compared it. Preview playback was verified by clock/advance, requested byte ranges and event state, never by listening.
- Heap numbers from `performance.memory` are coarse (it barely moved); real-hardware and Firefox/Safari behaviour untested. The 2-hour test reused one source on all 8 tracks (the 8 clip lists differ), not 8 distinct 2-hour files.
- Mockup comparison: header tabs (Edit / Transcript / Publish / Clips) were added after looking at it, but the transport is at the **top**, not the bottom bar of the mockup; no guest-connected status, "Script & prep", or knob per track; retake cleanup is a table panel rather than hatched regions with a popover (selecting a row shades the range on the timeline); no whole-episode overview strip. Screens were not pixel-compared at 1440×900.
- Not built: linked video, FX/noise reduction/loudness (Stage 05), MP3 export, transcript lane, mono-only (no stereo or per-channel), no resampling of non-48 kHz *recordings* (only imports are converted), no waveform-playlist recording/annotation packages.
- Export jobs/ imports share the narrow `render_jobs` table; deleting an episode while an export is *running* marks it cancelled and deletes the row, so the worker may finish a render whose row is gone (leaves one orphan object until the next cleanup — not handled).
- Verified-but-unplaced imports (finished while the editor was closed) are placed automatically the next time the project opens; there is no way to discard one except placing it and deleting the clip, then it stays in storage until the episode is deleted.
- Retake detection is heuristic (pauses): a flub with no pause before it gets `startLimited` and the user must nudge. `maxLookbackS` is 25 s.
- Test data from the whole session was deleted through the studio (the bucket went back from 1.9 GiB to 1.4 MiB); the deletion found and fixed a real bug (episode delete failed with a foreign-key error when uploaded audio existed — the project now goes first).

## Fades, ducking, library (2026-11-01, Tyler's requests)

**Fades by dragging corners.** Drag the top-left or top-right corner of a clip inward to set its fade-in / fade-out (cursor changes, dots mark where each fade ends, the faded part is shaded). The fade follows how far you drag from where you took hold (no jump), clamps so fades never exceed the clip, is one undo step, and never moves or trims the clip. The inspector's numeric fields still work. (Linear fades only.)

**Ducking** (Inspector → Ducking). Rules in the project document (`ProjectDoc.ducking`, optional so old projects load): *which tracks get turned down* (any tracks, checkboxes), *what triggers it* (**all host and guest tracks**, or **only the tracks you pick**; a track can't both trigger and be ducked by one rule), amount (−40…0 dB, default −12), threshold (−70…−10 dBFS, default −42), speed of the dip (attack 1–500 ms, default 60) and time to come back (release 20–3000 ms, default 450), enable switch, up to 8 rules; removing a track updates/drops rules that mention it. DSP (`packages/audio/src/duck.ts`): a fast peak follower on the loudest audible trigger track (after clip gain and fades; a muted trigger doesn't trigger) with ~80 ms hold so gaps between words don't pop the music back up, then attack/release smoothing of the gain on the target tracks, applied before the mixdown. **Export** and **preview** use the same code: the render mixes tracks separately then ducks; the player computes the same curve from the audio windows it has loaded (with a run-up after seeks) and gives Web Audio a 10 ms-resolution curve per piece (measured ≤ 0.2 dB from the exact per-sample gain). Verified: export vs an independent reference of fades + ducking −155 dBFS, deepest dip exactly the set amount, blocked render = one-pass reference < −100 dBFS, mutating the detector or the smoothing makes tests fail (10 ducking tests). Not done: no lookahead (the music starts dipping when the voice starts, over the attack time, not before), no gain-reduction display on the timeline, no per-rule solo/audition, preview ducking verified by running (no errors, clock advances) and by the curve-error test, **not by listening**.

**Library.** Table `library_items` (migration 0014; show-wide, kind music|sfx, status queued/running/ready/failed, decoded asset + original). Upload keeps the original privately (`import_original`), the worker's new `library-jobs.ts` converts it with the same shared `decodeUpload` as editor uploads (48 kHz mono 24-bit, read-back + SHA-256 verified; one decode function now serves both). Library assets have `episode_id = null`; `checkSources` accepts them for any project of the show. In the editor, **Library** (header) lists ready items with preview and adds one to the selected track at the playhead (next free spot) or to a new track of its kind; adding the same item again makes another clip of the *same source* (`addSourceClip` now reuses a source with the same asset). **Delete is refused while any episode's current project uses the item** (409 with a count); deleting an episode never touches library audio. Routes: `GET|PUT /studio/library/items`, `PATCH|DELETE /studio/library/items/:id`; all under the login middleware (`scripts/verify-studio-auth.sh` probes them). Limits: one show, only music/SFX kinds, no folders/tags/search/bulk, preview is the decoded 24-bit WAV (browser-dependent), items are not versioned (replace = upload a new one).

## Editor round 2 (2026-11-02, Tyler's requests while using it)

All deployed (`scripts/rebuild.sh` web + worker), **uncommitted** like the rest of Stage 04. Unit tests 233; new browser scripts in `validation/editor/` (all passing against the live build): `track-menus.mjs`, `range-loop.mjs`, `crossfade.mjs`, `meters.mjs`, `loud-export.mjs`.

- **shadcn everywhere new** (Tyler: "ALWAYS use shadcn components where we can"): added `popover`, `context-menu`, `switch`, `toggle`, `toggle-group`, `tabs`, `tooltip` to `components/ui` via the shadcn CLI (no new deps — `radix-ui` umbrella). Editor menus, popovers, ducking switch/segmented control/chips, inspector tabs, export settings, M/S/lock buttons now use them. Tooltip is installed but unused (needs a `TooltipProvider`).
- **Layout**: header = back, title (readable down to 1024 px), workflow tabs, save status, Export. Edit tools on their own row (labels collapse to icons under `lg`). **Transport pinned to the bottom** (play/stop/ends, loop, clock, zoom, "Shortcuts" popover instead of the hint line). Right **inspector collapses** to an icon rail (button, `I`, remembered per browser).
- **Tracks**: **"+ Add track"** popover = empty Host/Guest/Music/SFX, **straight from the library** (preview, search when >5, lands on a new track at the playhead), or upload to a new track. Track **⋯ / right-click** menu: rename, **colour** (10 presets avoiding red + custom picker + "default"), mute/solo/lock, **delete track** (asks when it has clips; undoable; refuses the last or a locked track). Colour = optional `Track.color` (`#rrggbb`, validated) used by the waveform, header bar and ducking chips.
- **Range selection**: drag on a track (empty space), **Shift+drag** anywhere, or the **Range tool (R)** selects a section *on that track*; drag up/down to take in more tracks; the ruler still selects all tracks. **Right-click a selection**: *Delete from Host only (leave silence — stays in sync)*, *Cut from Host only and close gap* (explicitly labelled as moving later Host audio out of sync — new `cutRange(…, { unsynced: true })`), cut/delete on all tracks, split at the edges, loop, clear. Right-click a clip: split here, select as range, delete (gap), ripple delete. Selection chip in the transport with the same actions.
- **Delete keys swapped** (Tyler): **Delete / Backspace = delete, leave gap**; **Shift+Delete = ripple delete** (close the gap on every track).
- **Loop (C)**: loops the selection, gapless — the player schedules the next pass ahead on the audio clock (`setLoop`, segmenting the lookahead window) with a 4 ms de-click at the seam. Verified: 40 samples over 6 s stayed inside 5–7 s and wrapped 3×.
- **Crossfades**: drag a clip over its neighbour (or trim into it) → the overlap is a crossfade. Model allows two clips to overlap (never three, never one inside another — `layoutProblem`); fades are *derived* from overlaps at play/render time (`withCrossfades`), never stored, so separating the clips removes the crossfade. Linear (gains sum to 1): proven exact — a clip trimmed back over its neighbour from the same take renders identical to the original (< −100 dBFS residual). Drawn as an X. Equal-power curves not built.
- **Meters**: per-track horizontal segmented meter in the header (analyser per track bus); **master meter** column (click it or the toggle: **dBFS** peak/RMS/hold/clip with −18 reference / −9 nominal-peak zones, or **LUFS** Insight-style M/S/I bars with the −19 target line, integrated, M, S, true peak, LRA, reset). Player now routes track buses → master bus → a ScriptProcessor tap feeding the shared BS.1770 meter (ScriptProcessor is deprecated but universal; an AudioWorklet would be the upgrade). Verified: after playing the whole take, preview integrated = **−21.3 LUFS, identical to the export's own measurement of that mix**.
- **Export loudness (Stage 05 item, built early at Tyler's request)**: every WAV export is normalised — **mono −19 LUFS, stereo −16 LUFS, true peak ≤ −1 dBTP** (new Channels: Mono/Stereo; stereo = the mono mix on both channels). `packages/audio/src/loudness.ts`: BS.1770-4 K-weighting (libebur128 derivation; exact 48 kHz coefficients), gated integrated/momentary/short-term, EBU 3342 LRA, 4× true-peak estimate (own 48-tap Hann-windowed sinc, not the spec's table), lookahead true-peak limiter (5 ms, 80 ms release, ceiling target −0.3 dB margin). Render: pass 1 measures; if the gain would push peaks over the ceiling, up to 3 measuring passes with the limiter in place correct for the loudness it removes; final pass writes and **measures the delivered file**. Boost capped at +30 dB; summary says `reached: false` (and the panel warns) if the target wasn't hit. Job summary/asset meta carry integrated LUFS, dBTP, LRA, gain, limiter work; filename includes `mono-19LUFS`. **Independently verified with ffmpeg's ebur128 on downloaded exports: mono −19.0 LUFS, stereo −16.0 LUFS, TP −3.4 dBTP.** Pre-delivery parity is still tested without normalisation (unit tests); `validation/editor/export-wav.mjs` now compares against the definition × the reported gain (not re-run this session — it needs its specific tone take). Not built: MP3, loudness-target choice per show, dialogue-gated loudness.
- **Public page**: social links removed from the show page hero (footer keeps them; JSON-LD `sameAs` unchanged). Person pages keep the person's own links in their hero (they aren't in the footer).

- **Missing audio (Tyler hit "audio 404")**: his Test Episode project used a take that had been deleted from the Record screen. That screen's "Delete take" skipped the in-use check the API route had, and had no confirmation; the delete removed the row, asset and stored audio (unrecoverable). Fixed: one guard (`deleteRecordingIfUnused`) for both paths, a confirm step, and the reason shown under the take. The editor now detects sources whose audio is gone (`missingSources`), plays everything else (silence for those clips instead of stopping), and shows a banner with **Remove those clips** (`removeSource`, undoable). Saves are refused while a missing source is in the document (existing `checkSources`), which the banner says. Tyler's project: the broken clip was removed via the banner at 09:12 (rev 60); it saves again.
- **Track volume**: `Track.gainDb` (−60…+12 dB, 0.1 dB steps, absent = 0) applied after clip gain/fades in the shared render and on the player's per-track bus (fader moves don't restart playback). Fader in each track header (when ≥ 90 px tall; shadcn `Slider`, fader-law spacing, double-click = 0 dB, arrows ±0.5 dB, Home/End go to the transport) and in Inspector → Track. FX (noise cleanup/EQ/compression, Stage 05) are meant to sit per track *before* this fader. Verified: −12 dB on the fader = −11.5 LU on the master meter; export parity with track gains < −100 dBFS.
- **Wheel reversed (Tyler)**: wheel = scroll the tracks up/down (native), **Shift+wheel = timeline sideways**, Ctrl/⌘+wheel or pinch = zoom at the pointer. `wheel-lanes-sliders.mjs` updated and passing.
- **Simple editor + Advanced switch (Tyler: "more simple… Hindenburg Pro is a clean interface I LOVE")**. Reference screenshots: Hindenburg Pro's own marketing images. **Simple (default)**: one 52 px toolbar of small icon+label buttons (Undo · Redo | Split · Delete · Ripple | Import · Library · Retakes, workflow tabs, Advanced switch, save status, Export); track headers = name, ⋯, M · S · inline fader; clips drawn Hindenburg-style (body tinted with the track colour, name strip on top); retake/chapter marks as flags on the ruler (no separate lane); right side = **Library sidebar** (the "Clipboard": Music / Sound effects groups, search, preview, + adds at the playhead on a new track, **drag an item onto any track to drop it there**); bottom transport = big clock + **horizontal master meter** (click: dBFS ⇄ LUFS M/S/I with the −19 line). **Advanced** (switch in the toolbar, remembered per browser): Range tool button, lock button, per-track meters and the header fader row, the Retakes & chapters lane, the full master meter column and the Inspector (Clip / Marks / Ducking). The Toolbar "Library" button opens the sidebar in Simple, the dialog in Advanced. Initial zoom-to-fit accounts for whichever side panel is showing. Regression scripts default to Advanced (`lib.mjs` init script); `simple.mjs` covers Simple.
- **Master meter is L/R (Tyler)**: the player's master bus is now stereo (mono track buses up-mix to both sides) and its tap is 2-channel, so the dBFS master meter shows **left and right** (transport: two stacked bars; Advanced column: two vertical bars). With today's all-mono material the two read the same (verified equal within 0.01); they'll differ once stereo sources exist. Loudness (LUFS) is still measured on the mono mix to match the mono −19 target. Track meters stay single (tracks are mono). `lr.mjs` covers it.
- **Not built / open**: stereo. Every source is decoded to mono at import, so tracks, meters and the mix are mono; a stereo export is dual-mono. Real stereo needs stereo sources, pan, a stereo bus, stereo peaks/meters and render — Tyler's call (see question in chat). 

### Validation checklist for Tyler (nothing below has been confirmed by a human yet)
**State:** everything is deployed (`scripts/rebuild.sh` web + worker) but **uncommitted** (~53 changed files; Tyler said not to commit until he has reviewed). Stage 04 stays "built, awaiting review" in `docs/design/STATUS.md`; Stage 05 not started. Test data was cleaned; Tyler's own "Test Episode" (b9af96ec) still has a leftover import job, left alone on purpose.

Try, in the editor at `https://studio.tylerwoodward.me/studio/editor?episode=<id>`:
1. **Trackpad scrolling / dragging a clip**: lines should no longer swim or jump (only unit-tested; headless Chromium can't reproduce fractional scroll).
2. **Wheel**: wheel = tracks up/down, Shift+wheel = sideways, Ctrl/pinch = zoom at the pointer.
3. **Rename**: click "Host"/"Sfx" in a track header, type, Enter.
4. **Fades**: drag a clip's top-left / top-right corner inward; undo/redo.
5. **Ducking** (Inspector → Ducking): add a rule with a music track under host + guest, then **listen** to the preview and an export. Ear check is the main unverified item; tune default amount/attack/release if it sounds off.
6. **Library** (`/studio/library`): upload a jingle and a sound effect, rename, preview, then use the editor's Library button; try deleting one that's in use (should be refused).
7. **Upload audio** to a track, and **Retake cleanup** on a real take with K marks.
8. **Round 2**: Add track → from the library; right-click a track header (colour, delete); drag on the Host lane to select, right-click → *Delete from Host only*; press C to loop it; drag a clip into its neighbour and listen to the crossfade; watch the track meters and click the master meter for LUFS; export mono and stereo and check the LUFS line under each export.

Decisions awaiting Tyler: own canvas timeline instead of `waveform-playlist` (reasons above); whether hatched in-timeline retake regions are required before sign-off (bottom transport is now built); crossfade curve (linear now — equal-power option?); whether a show should be able to pick its own loudness target; PREBUILD budgets (none recorded).

Regression scripts (`validation/editor/README.md`): `fades-and-ducking.mjs`, `ducking-playback.mjs`, `library.mjs`, `drag-and-scroll.mjs`, `wheel-lanes-sliders.mjs`, `rename-track.mjs`, `retake-cleanup.mjs`, `export-wav.mjs`, `import-audio.mjs`, `conflict.mjs`. Run `scripts/verify-studio-auth.sh` after adding any route.

## Docker disk cleanup (2026-10-25)
Every rebuild leaves ~1 GB of build cache and superseded layers; after a long build session this had grown to ~100 GB (disk 85% full; cleaned back to 38%). **`scripts/rebuild.sh [web|worker]`** now rebuilds *and* runs **`scripts/docker-cleanup.sh`**, which keeps the most recent 8 GB of build cache and removes dangling images — never containers, volumes or tagged/in-use images (`KEEP_GB=` overrides). The same script runs **weekly from the user crontab** (Sundays 04:15, log: `~/.local/state/podstudio/docker-cleanup.log`; `crontab -l` to see or remove it). Plain `docker compose up --build` still works but skips the tidy-up. If space gets tight again: `docker system df` shows where it is. Never run `docker system prune --volumes` here (it would delete the Podstudio data volumes).
