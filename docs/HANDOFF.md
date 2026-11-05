# Podstudio — ongoing handoff

This is the "what's actually true right now" doc. It gets **updated in place**
each session, not appended to — history lives in `git log` and
`docs/design/CHANGELOG.md`; the stage-by-stage plan lives in
`docs/design/STATUS.md` and `docs/design/BUILD_PLAN.md`. Read this one first.

**Last updated:** 2026-11-05 — **Planning only (docs): new Stage 06b, host publishing (Buzzsprout first, then RSS.com/Transistor), added after Release 1; no code changed.** Earlier, 2026-11-04 — **Stage 05 passed (Tyler).** DeepFilterNet noise reduction, the expander, the new FX order and export → publish are merged to `main` and deployed (see "Noise reduction is now DeepFilterNet" and the sections after it). **Stage 06 is next and not started — wait for Tyler's go.**
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
| 08 Editor | **Real (Stage 04, merged)**, full-screen at `/studio/editor?episode=<id>` (chooser without it; Episode details and the Episodes row menu have **Edit**). One Hindenburg-style layout (the Advanced switch was removed 2026-11-02); multitrack canvas timeline, split/trim/move/ripple, range cuts per track, crossfades, gain/fades/track volume, colours, loop, track + L/R master meters (dBFS/LUFS), ducking, library sidebar, retake + chapter marks, undo/redo, autosave revisions with conflict detection, audio upload, export. Track FX, stereo and MP3 came in Stage 05 (see "Stereo + Stage 05"); video, shots, branding and the transcript lane are **not built**. |
| 09 Retake cleanup | **Real (Stage 04)** as a docked panel inside the editor (`/studio/editor/retakes?episode=` opens it). Proposes one cut per retake mark from the tone + pauses in the audio, audition (join / removed part), ±0.1 s nudge, checkbox per cut, "Apply N cuts" = one undoable edit across all tracks. No transcript refinement (Stage 07) |
| 12 Export | **Half real (Stage 04)**: a dialog over the editor (`/studio/export?episode=` opens it). Audio tab only: WAV 16/24-bit × 44.1/48 kHz, mono or stereo (dual-mono), **loudness-normalised to −19 LUFS mono / −16 LUFS stereo, ≤ −1 dBTP**, rendered by the **worker** from an exact saved revision, read back + SHA-256 verified, downloadable, cancellable; shows the delivered LUFS/dBTP/LRA. MP3 (Stage 05), Video (10a) and Editor-project (10d) tabs are disabled |
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

**Next:** **Stage 05 is passed (Tyler, 2026-11-04).** Only on his go, Stage 06 (existing-show import, feed publish, protected sharing). **Planned, core to the build (2026-11-05):** Stage 06b, host publishing, right after Release 1 and before Stage 07 — see `docs/design/stages/STAGE-06b.md` (Buzzsprout adapter first, then RSS.com and Transistor; push chapters/transcripts/contributors/soundbites/podroll/verification/fan mail; pull host stats; self-hosted S3 + our feed stays an equal per-show option). Also planned: Stage 10c makes a 16:9 full-episode YouTube video (see STAGE-10c.md). Not started; don't build 06b before Release 1 passes and Tyler says go. Keep Stage 06's `publications` table and publish jobs adapter-friendly. The screens that don't need new infrastructure are done. What's left is
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
0. ~~Stage 05 review~~ — passed 2026-11-04. Still open from Stage 04/05: hatched retake regions, PREBUILD performance budgets, lint/e2e/CI.
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
cold start, no `lint` / `e2e` task and no CI (browser scripts are committed under `validation/editor/`), no off-site backup,
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

## Editor (Stage 04) — passed 2026-11-02 (Tyler; merged in PR #1)

**State.** Everything below is committed (`c295488`, merged as `69cc289`, PR https://github.com/thetylerwoodwardproject/podstudio/pull/1) and deployed (`scripts/rebuild.sh` web + worker). Tyler has been using it daily and asked for the merge ("That looks fantastic"), and **passed it** the same day. The PREBUILD proofs are still outstanding. Built and verified in headless Chromium against the live Docker build, with scripts in `validation/editor/`; things nobody has *listened to* are called out below.

### What Tyler sees

> **Superseded 2026-11-02:** the Simple/Advanced split below no longer exists — it's one editor now. See "Stereo + Stage 05 → Editor". Kept for history.

**Simple (default)** — modelled on Hindenburg Pro (Tyler: "a clean interface that I LOVE"; standing preference: simple by default, extras behind Advanced):
- One 52 px toolbar of small icon+label buttons: Undo · Redo | Split · Delete · Ripple | Import · Library · Retakes, the Edit / Transcript / Publish tabs, the **Advanced** switch, save status, Export.
- Track headers: colour bar, name (click to rename), ⋯ (colour, delete), M · S · volume fader. Right-click a header for rename / colour / mute / solo / lock / delete.
- Clips drawn Hindenburg-style: body tinted with the track colour, the source's name on a strip along the top, waveform below. Crossfades drawn as an X.
- Retake and chapter marks are flags on the ruler.
- Right: **Library sidebar** (the "Clipboard") — Music / Sound effects groups, search, preview, **+** adds at the playhead on a new track, **drag an item onto any track** to drop it at that spot. `I` hides/shows it.
- Bottom transport: shortcuts popover, selection chip (when a range is selected), ⏮ ▶ ⏭, loop, big clock, and a **horizontal master meter — L/R dBFS, click for LUFS (M/S/I + integrated, −19 target line)**, zoom.

**Advanced** (toolbar switch, remembered per browser) adds: Range tool, lock buttons, per-track meters and a fader row in tall headers, the separate "Retakes & chapters" lane, the full **master meter column** (L/R dBFS with −18 ref / −9 nominal-peak zones, peak hold, clip LED; or LUFS M/S/I bars, integrated, M, S, TP, LRA, reset), and the **Inspector** (Clip: gain, fades, track name/volume/height · Marks: chapters · Ducking). The inspector collapses to an icon rail.

**Keys:** Space play · X split · **Delete = delete, leave gap** · **Shift+Delete = ripple delete** (all tracks) · C loop selection · R range tool · I side panel · M/S/L mute/solo/lock · ↑↓ track · +/− height · ←/→ nudge (Shift = 10 s) · Home/End · Ctrl+Z / Ctrl+Shift+Z. **Wheel = scroll tracks up/down, Shift+wheel = timeline sideways, Ctrl/⌘+wheel or pinch = zoom at the pointer.** Nothing fires while typing in a field; arrow keys on a focused fader move the fader, Home/End still go to the transport.

**Editing:** drag a clip to move (onto its neighbour = **crossfade**), drag edges to trim, drag a clip's top corners inward for fades. **Select a section**: drag on a track's empty space, Shift+drag anywhere, or Range tool; drag up/down to include more tracks; the ruler selects all tracks. **Right-click a selection**: *Delete from Host only* (leaves silence, stays in sync), *Cut from Host only, close gap* (labelled: puts that track out of sync — for music beds), cut/delete on all tracks, split at the edges, loop, clear. Right-click a clip: split here, select as range, delete, ripple delete.

### How it works

- **Project document** (`packages/audio/src/document.ts`, shared by web and worker; re-exported via `apps/web/app/lib/project/*`): tracks (host/guest/music/sfx; mute/solo/lock/height; optional `color` `#rrggbb` and `gainDb` −60…+12), clips in integer source samples (`srcStart`, `length`, `start`, `gainDb`, linear fades), annotations anchored to *source* samples (retakes, chapters), optional `ducking` rules. Pure edits return a new doc or an error. `cutRange(…, { ripple, trackIds, unsynced })` — ripple refuses to desync tracks unless `unsynced` is asked for explicitly. **Crossfades**: two clips on a track may overlap (never three, never one inside another — `layoutProblem`); fades over the overlap are *derived* at play/render time (`withCrossfades`), never stored. `removeSource` drops a source with its clips/marks. `parseProject` validates untrusted JSON. Undo/redo 200 steps, same-group edits merge (fader drags, renames, colour).
- **Persistence**: `projects` + `project_revisions` (migration 0012); every autosave is an immutable revision whose parent must be current; stale tabs get 409 + the current revision (Load newer / Keep mine banner). `checkSources` re-checks every source server-side.
- **We don't use `@waveform-playlist/browser`** (BUILD_PLAN names it): it decodes whole files into AudioBuffers (~1.4 GB per 2-hour source). Instead: canvas timeline drawn into a 3-viewport tile (native scrolling), and a Web Audio player (`lib/project/player.ts`) that streams 10 s windows by HTTP Range and schedules pieces on the audio clock from the same plan the export uses (`plan.ts`). Gapless **loop** by scheduling the next pass ahead (4 ms de-click at the seam). Audio graph: piece → clip gain/fades → ducking → **track bus** (track volume + analyser for the track meter) → **stereo master bus** → speakers, plus a 2-channel tap feeding the master meter.
- **Waveforms**: peaks cached beside each WAV (`<key>.peaks1`, 2.6 MB per 2 h).
- **Upload/import**: original kept privately; the worker's ffmpeg converts to **48 kHz mono 24-bit**, read-back + SHA-256 verified; placed at the playhead. **Library** (`library_items`, migration 0014): show-wide music/SFX, same decode; delete refused while any project uses an item.
- **Retake cleanup** (`lib/project/retake.ts`): finds the 1 kHz tone near each K mark and the pauses around the flub; panel with audition, ±0.1 s nudge, one undoable apply.
- **Ducking** (`packages/audio/src/duck.ts`): peak follower on the trigger tracks with ~80 ms hold, attack/release smoothing on the targets; same code for preview and export.
- **Meters** (`components/editor/meters.tsx`): track meters from each bus's analyser; master L/R peak/RMS and BS.1770 loudness from the tap (loudness measured on the mono mix, matching the mono −19 target). Reuses the recorder's `LevelMeter`.
- **Export** (`render_jobs`, migration 0013; worker `render-jobs.ts`; shared `packages/audio/src/render.ts`): WAV 16/24-bit, 44.1/48 kHz, **Mono or Stereo** (stereo = the mono mix on both channels), mute/solo, clip + track gain, fades, crossfades, ducking. **Always loudness-normalised: mono −19 LUFS, stereo −16 LUFS, true peak ≤ −1 dBTP** (`packages/audio/src/loudness.ts`: BS.1770-4 K-weighting, gated integrated/momentary/short-term, EBU 3342 LRA, 4× true-peak estimate, 5 ms lookahead true-peak limiter). Pass 1 measures; if the limiter would have to work, up to 3 measuring passes correct for the loudness it removes; the final pass writes the file and measures what was delivered. Boost capped at +30 dB; `summary.normalise.reached` is false (and the panel warns) when the target wasn't hit. 16-bit is TPDF-dithered (seeded, byte-identical reruns). Read-back + SHA-256 verified, then downloadable. Filename e.g. `episode-r12-mono-19LUFS-24bit-48k.wav`.
- **Data safety**: a take used by a project **can't be deleted** (`deleteRecordingIfUnused` — the Record screen's "Delete take" used to skip this and had no confirmation, which is how Tyler's project lost a take's audio on 2026-11-02); the Record screen now asks first and shows the reason. If a source's audio is missing anyway, the editor plays everything else and shows a banner with **Remove those clips** (saves are refused until then).
- **UI kit**: shadcn primitives (added via the CLI: popover, context-menu, switch, toggle, toggle-group, tabs, slider, tooltip — tooltip unused so far). Standing rule from Tyler: always use shadcn where a primitive exists.
- **Garage quirk**: it reports a wrong `x-amz-checksum-crc32` for whole multipart objects; both `clientFor`s set `responseChecksumValidation: "WHEN_REQUIRED"`; integrity is our own SHA-256.

### Verified (numbers)

- Export vs the sample-by-sample definition of the edit: −163 dBFS residual (24-bit); with fades + ducking −149 dBFS after dividing out the normalisation gain; crossfade of a clip trimmed back over its neighbour reproduces the original exactly (< −100 dBFS); track volume < −100 dBFS.
- Loudness: EBU Tech 3341 case 1 reads −23.0 LUFS (48 and 44.1 kHz); **exports measured with ffmpeg `ebur128`: mono −19.0 LUFS, stereo −16.0 LUFS, TP −3.4 dBTP**; the editor's live integrated reading after playing a take equals the export's measurement of the same mix (−21.3); −12 dB on a fader = −12.0 LU.
- 2-hour synthetic project, 8 tracks × 1,166 clips: opens and paints in 0.4 s, edits 60–120 ms, export 57 s at ~312 MiB (measured before normalisation; a normalised export does 2–4 mixing passes, so expect roughly 2–4× — **not re-measured**).
- `pnpm test`: 27 files / 236 tests. Browser scripts passing against the live build: `track-menus`, `range-loop`, `crossfade`, `fades-and-ducking`, `rename-track`, `meters`, `fader`, `wheel-lanes-sliders`, `simple`, `lr`, `guard`, `loud-export`, `center`, `center-simple` (see `validation/editor/README.md`; they default to the Advanced layout).

### Not done / caveats

- ~~Mono only~~ — stereo built afterwards (see "Stereo + Stage 05").
- **No `pnpm lint` or `pnpm e2e`** exist (CLAUDE.md requires both for every PR); no CI on GitHub. The browser scripts are the stand-in.
- Not verified by ear: loop seam, crossfades, ducking feel, limiter on real programme. Preview↔export parity is by shared code + clock checks, never by capturing the browser's output.
- `export-wav.mjs` was updated for normalisation but not re-run (needs its specific tone take). 2-hour export time with normalisation not re-measured.
- Crossfades are linear (equal-power not built). Fades are linear. No ducking lookahead.
- Master meter uses a ScriptProcessor tap (deprecated, but works everywhere); an AudioWorklet is the upgrade.
- Mockup gaps: retake cleanup is a panel, not hatched regions with a popover; no whole-episode overview strip; no guest status / "Script & prep"; not pixel-compared at 1440×900.
- Not built: FX (noise reduction, EQ, compression — Stage 05; planned per track, *before* the fader), MP3 export, transcript lane, video, per-show loudness target.
- Unplaced imports finished while the editor was closed are placed automatically on next open; there's no "discard". Deleting an episode while its export is running can leave one orphan object.
- Tyler's own "Test Episode" (b9af96ec) is his scratch project — tests only ever opened it view-only.

### Validation checklist for Tyler (human checks still outstanding)
1. **Listen**: loop a selection (C), drag a clip into its neighbour (crossfade), a ducking rule under music — do they sound right?
2. **Export** mono and stereo of a real episode; check the LUFS line under each and play the file.
3. **Trackpad**: scrolling/dragging smoothness (headless can't reproduce fractional scrolling).
4. **Library drag**: drag a sidebar item onto a track; right-click a selection → *Delete from Host only*.
5. **Retake cleanup** on a real take with K marks.

### Decisions awaiting Tyler
- ~~Stereo~~ — yes (built; see "Stereo + Stage 05"). ~~Pass Stage 04~~ — passed 2026-11-02.
- Crossfade curve (linear now; equal-power option?), per-show loudness target, whether hatched retake regions are needed, PREBUILD performance budgets (none recorded), adding real `lint`/`e2e`/CI.

## Page polish (2026-11-03)
Tyler: "polish up the pages we have now, don't touch editor." Editor and its components were not changed.
- **Layout:** every studio page renders inside `Page`/`PageHeader` (`components/layout/page.tsx`). New pages should use them: `width="form"` (max-w-3xl) for settings-style pages, `"wide"` (max-w-6xl) for tables/dashboards; eyebrow = sidebar section.
- **Phones:** below 768 px the sidebar becomes a top bar + drawer (shadcn Sheet; one `<main>`, CSS-only switch). Studio pages fit at 390 px with no sideways scroll (the recorder and editor were not checked on phones).
- **Controls:** no native `<select>`/checkbox/radio left in studio pages. `FormSelect` (`components/ui/form-select.tsx`) wraps shadcn Select and submits through a hidden input, so `""` options ("Not set") work; `ChoiceCards` (`components/ui/choice-cards.tsx`) is the radio-card row. Added shadcn `checkbox`, `radio-group`, `sheet`.
- **Copy:** user-facing text no longer mentions stages/screens/STATUS.md. Convention: describe what's missing in listener/host terms ("comes in a later release").
- **Public:** show-note lists have markers again; snippets come from `htmlToSnippet` (`lib/rich-text.server.ts`: lead paragraphs only — the feed's `itunes:summary` still uses the full `htmlToText`); embed text-accent uses `--emb-link` (accent stepped to 4.5:1). Light theme of the public site and embed was checked this time.
- **Test data:** a throwaway episode (created/deleted) and Brand/podroll/analytics toggles during the form test; the `shows` row was backed up and restored exactly (theme still `custom #beff00`).
- Not done: the recorder page wasn't restyled; Episodes has no bulk actions (the checkbox column was removed because it did nothing).

 (noise reduction, voice FX, loudness, MP3) + Tyler's review rounds — built 2026-11-02, awaiting review

Tyler passed Stage 04, said yes to stereo, and started Stage 05. Stage 05 was built, then reworked through a long afternoon of Tyler's feedback (FX layout, accent consistency, audiocn everywhere, one editor instead of Simple/Advanced, presets, ducking in FX, palette, public player redesign). Everything below is **deployed, browser-verified and merged** (PR #3, 2026-11-03). Unit tests **261** pass; typecheck clean; browser scripts in `validation/editor/` and `validation/stage05/` (README there lists which are current and which are stale).

### Noise reduction is now DeepFilterNet (2026-11-04, after Tyler's review)
- **What**: the per-track NR is DeepFilterNet3 (MIT/Apache), built from upstream commit `d375b2d` + `df-free.patch` into `packages/audio/dfn/` (wasm 14.5 MB + model 8 MB, `scripts/build-dfn.sh` rebuilds). Knob 0–100 % = 0–36 dB floor on a *smoothed* model gain (`NR_SMOOTH`: 9 bins, 8 ms up / 120 ms down), added after Tyler heard flutter at 38 %; `FX_LATENCY` is now 3072. `FX_LATENCY` is now **1920** (1440 model delay + one 480-sample hop).
- **Same code both sides**: the AudioWorklet gets the compiled wasm + model from the page (`/studio/dfn/*`, `player.ts` → `audio-worklet.ts`); the export worker loads it from disk (`ensureDfnLoaded` in `render-jobs.ts`). Verified in headless Chromium vs Node: **384,000 of 384,000 samples bit-identical**.
- **Behaviours to know**: 48 kHz only (other rates pass dry); until the model loads the preview is dry (panel says so); switching NR on/off/loading mid-stream never shifts audio; mono tracks run the model once; building a model takes ~0.5 s so the worklet pre-builds a pool while idle; ≈ 4.5× real time per channel, so a 1-hour export with NR takes ~13 min per pass (loudness export = 2 passes). It removes the 1 kHz retake tone (non-speech) - retake cleanup reads the source, so unaffected.
- **Heard and approved by Tyler** ("sounds soooo much better at 38 %" after the smoothing). Listening files from the review are in `~/nr-compare/` (safe to delete). **Not measured**: live-preview CPU with several NR tracks on real hardware (≈ 4.5× real time per channel in Node; mono tracks run the model once). Export cost ≈ 13 min per pass for a 1-hour episode with NR (the loudness export makes 2 passes).
- Same session: retake tone −20 dBFS (was −6), 0–1 knobs now step 1 % (were 0/100 %), episode artwork preview works for drafts (own signed-in route), "Open in editor" after a take.

- **FX order (Tyler, 2026-11-04): high-pass → noise reduction → expander → low-pass → EQ → compressor**, same in the engine (`packages/audio/src/fx.ts`) and the FX panel list. New **downward expander** (3:1, 6 dB knee, threshold −70…−20 dB, reduction 3…30 dB, ~3 ms open / 80 ms hold / 150 ms close); its detector hears the high-passed input 40 ms ahead of the audio, so it opens before words. Built into Podcast voice (−52 dB / 12 dB) and Noisy room (−48 / 15). Old projects have no `exp` and load with it off (FX_VERSION unchanged).
- **Export → publish**: Export dialog has *Export & use for episode*; finished MP3s have *Use for episode* (copies the file into feed storage, verified like an upload); WAVs have *Convert & use* (renders an MP3 of the same revision, then uses it). Publish page has *Use my latest MP3 export*. Public episode page: platform buttons moved from the player card into the sidebar under Up next.

### Repo / environment state (2026-11-04)
- **PR #4 merged to `main`** (`90f1073`). The local checkout is on **`docs/social-posts-plan`** (merged with `main`, NOT pushed): it carries the Social mockup (`/studio/social`), which is what the live site is built from. Rebuilding from `master`/`main` would drop that mockup from the live site until the branch is merged. Decide with Tyler when to merge it.
- A Rust toolchain was installed in `~/.cargo` only to build the DeepFilterNet wasm (`rustup self uninstall` removes it; `scripts/build-dfn.sh` needs it + `wasm-bindgen-cli 0.2.92`). The built files are committed in `packages/audio/dfn/` (22 MB), so normal builds don't need Rust.
- Known gap: an episode's status stays **Recording** after the take, edit and audio are done, and the Publish page then says "Finish recording and editing before scheduling". Offer Tyler: move it to *Editing* automatically when audio is attached.
- Not screenshotted: the public episode page's sidebar "Listen in your app" block (renders; the live show has directories set).

### Start here tomorrow
1. ~~Commit → PR → merge~~ — done (PR #3 on 2026-11-03, PR #4 on 2026-11-04). GitHub's default branch is `main`; the local checkout calls it `master`, so open PRs with `--base main`.
2. ~~Tyler's by-ear checks~~ — done; he passed Stage 05 on 2026-11-04. Don't start Stage 06 without his go.
   Planning added 2026-11-05: Stage 06b (host publishing) is documented in STAGE-06b.md, BUILD_PLAN, STATUS and CHANGELOG; docs-only and uncommitted — check `git status`.
3. Open threads from today: ChannelStrip for editor track headers (from his audiocn list, not done); stale validation scripts need rewriting (list in `validation/stage05/README.md`); Soundboard block noted for future hotkeys (not Release 1).
4. Rebuild with `scripts/rebuild.sh` **in the background**, and when waiting for it, watch the log for `free space on` — don't `pgrep -f rebuild.sh` (the waiting loop matches itself and never exits).

### Audio engine
**Stereo.** Imports keep stereo files stereo (≤ 2 ch; wider is folded down; recordings stay mono): `Source.channels` (1|2), interleaved 24-bit WAV, `assets.channels`, stereo peaks (`PSK2`: L and R kept separately, drawn as two halves of the clip). `Track.pan` (−1…+1, **balance law**: centre = 0 dB both sides, so centred mono mixes exactly as before; panning turns the far side down). The mix is stereo internally: per track clips → ducking → **FX** → fader → pan → sum. Mono export = (L+R)/2 (identical to before for mono material); stereo export = real L/R with true 2-channel loudness measurement. Player: stereo source windows; per-track bus input → FX worklet → fader → pan → L/R analysers → stereo master. Track meters go L/R when a track is stereo or panned. Verified: a stereo bed exported 10.5 dB louder on the left exactly as the source, −16.0 LUFS by ffmpeg (`editor/stereo.mjs`); render vs an independent stereo/pan reference < −100 dBFS.

**Track FX — `packages/audio/src/fx.ts` (this is PREBUILD's DSP decision, recorded in the file header).** Order **HPF (20–300 Hz) → noise reduction → expander → LPF (4–20 kHz) → EQ (low shelf 60–400 Hz, mid bell 300 Hz–6 kHz Q 1, high shelf 4–16 kHz, ±12 dB) → compressor**. FX_VERSION 1, stored per track as `Track.fx`, validated by `normalizeFx` (clamps, never wraps). **One deterministic TypeScript implementation** runs in the export (worker) and in the preview (an **AudioWorklet** that bundles the same module: `apps/web/app/lib/project/audio-worklet.ts`). Constant latency FX_LATENCY = 3072 samples (64 ms) on every track (DeepFilterNet's 1440 + the smoother's frame; a plain delay when NR is off): the render drops it, the preview schedules audio that much early. Every stage is sample-accurate, so the output doesn't depend on block size.
- *Noise reduction:* **DeepFilterNet3** (see "Noise reduction is now DeepFilterNet" above). The model runs at full strength on 480-sample hops; our smoother measures the gain it applied per bin (1024-point STFT, hop 512), smooths it over 9 bins and over time (8 ms up / 120 ms down), floors it at the knob's cut (0–100 % = 0–36 dB) and applies it to the dry signal. Verified: browser worklet and export output bit-identical. Heard by Tyler and preferred over the old filter; flutter he heard at ~38 % is fixed by the smoothing. 48 kHz only; handles steady and non-steady noise, may remove the 1 kHz retake tone (retake cleanup reads the source, so unaffected).
- *Expander:* 3:1 downward, 6 dB soft knee, threshold −70…−20 dB, reduction 3…30 dB, ~3 ms open / 80 ms hold / 150 ms close; detector hears the high-passed input 64 ms ahead of the audio. Tyler: leave it single-band (NS1 is a multiband downward expander; make it multiband only if he asks).
- *Filters:* RBJ biquads, 12 dB/oct Butterworth (−3 dB at the corner, tested). *Compressor:* stereo-linked peak detector 5/120 ms, 6 dB soft knee; amount a → threshold −10 − 20a dBFS, ratio 1.5 + 4.5a, make-up ½·|thr|·(1 − 1/ratio); gain reduction reported to the UI.
- **Parity (Stage 05 "Done when"):** the deployed worklet run in Chromium (OfflineAudioContext) vs the Node FxChain on the same fixture: 287,488 / 288,000 samples bit-identical, max |diff| 9×10⁻¹⁹, residual **−300 dBFS** (requirement −60). Render with FX vs an independent per-track reference < −100 dBFS; a project whose FX are all neutral renders byte-for-byte as before.
- *Preview caveat:* NR is adaptive, so starting playback mid-episode gives it a fresh noise estimate while the export has the whole episode behind it; the first second or so after a seek can differ slightly (parity is measured from the start).

**MP3 delivery.** `packages/audio/src/delivery.ts`: presets **64 kbps mono (speech) · 96 stereo (speech) · 128 stereo (speech + music, default) · 192 stereo (music-heavy)**, 44.1 kHz CBR, libmp3lame. Show default in `shows.settings.delivery.preset`; per-episode choice in the project document (`delivery.preset`). Worker `renderMp3`: render the normalised mix to a temp WAV → encode → **decode the MP3 and measure it** → if it's more than 0.2 LU off or over −1 dBTP, render again with the target nudged / more limiter headroom (≤ 3 attempts) → upload, read back, SHA-256, asset `export_mp3`. Export panel: MP3 (default) / WAV, preset picker, "Use for this episode", "Make the show default", one line of explanation ("Exports your saved edit, exactly as you hear it." — Tyler asked to drop the technical paragraph), and per export: LUFS · dBTP · size plus plain-language **warnings** (silent, too short, very quiet, heavy limiting, missed target). The detailed numbers (pre-encode readings, limiter use, SHA-256, LRA) are still stored in the job summary, just not shown. Verified with ffmpeg on downloads: **128 stereo −16.0 LUFS, 64 mono −19.0 LUFS, true peak −1.7 dBTP**, codec/rate/channels/bitrate correct (`stage05/fx-ui.mjs`). Before the correction loop, encoding alone cost ≈ 0.45 LU.

**Meters.** All meters are audiocn's **LevelMeter in its stock look** (solid bars, default zones: green, amber from −20 dBFS, red from −9 dBFS; peak hold; dB scale; dB readout; clip light). LUFS mode uses the same parts on a −42…−6 LUFS range with the delivery target marked. The master meter is an **AudioWorklet** (`podstudio-meter`, BS.1770 on the audio thread). It measures both the stereo mix and its mono fold-down and shows whichever the delivery preset uses (−16 stereo / −19 mono).

### Editor (one interface — the Advanced switch is gone)
Tyler: "we can do most things from the main interface now". Track headers: name, **FX**, ⋯, M/S (audiocn ChannelToggles), volume fader, pan (tracks ≥ 90 px) and an audiocn track meter. The ruler carries retake/chapter marks; the Range tool is always in the toolbar; the transport has the master meter (dBFS ⇄ LUFS, click to switch). Right panel, tabbed: **Library** (default; drag onto a track or + to add at the playhead) · **Clip** (track name/volume/pan/height, clip gain and fades) · **Marks** (chapters) · **LUFS** (loudness LCD); collapses to a rail (I). Removed: Advanced toggle, master-meter column, Library dialog, inspector FX and Duck tabs, header lock button (lock is on right-click; a locked track shows a lock icon). Editor clips are drawn with **audiocn Waveform's bar renderer** (`drawRoundedBar`, mirror, 2 px bar + 1 px gap) inside our own virtualized canvas — the `<Waveform>` component is single-clip and can't hold 2-hour/8-track sessions or sit under fades/crossfades. Bars are on a grid anchored to each clip (no swimming; `draw.test.ts`).

**FX popover (Hindenburg-style, Tyler's reference).** The FX button opens one popover (900 × ~390 px, padded): left, the chain — Noise reduction · High-pass · Low-pass · EQ · Compressor · **Ducking** · Volume — each with its own switch and an accent dot when active; right, **only the selected effect's controls** with large audiocn **Knobs** (4 rem for single controls and EQ gain). EQ/filters show the curve over the live **Spectrum**; the compressor has a gain-reduction **LcdDisplay**. Reopens on the last effect used. Top: On/Bypass, A/B, Flat, Presets, status line. Undo: one step per control.
- **Accent consistency:** the studio sets the show accent (`--primary`) and `.dark` on `<html>`, because popovers render in a portal outside the studio wrapper (that's why the panel's switches were bone while the inspector's were lime). FX button: filled when FX or ducking change the sound, outlined while open, gray otherwise.
- **Built-in podcast presets** (`components/editor/fx-builtins.ts`), above the show's saved presets: Podcast voice · Deeper voice · Brighter voice · Broadcast voice · Noisy room · Remote guest (Zoom / phone) · Gentle cleanup · Music under voice. From common practice (high-pass 80–100 Hz, small cut at 200–400 Hz, +1–2 dB presence at 3–5 kHz, ~3:1–4:1 compression ≈ 35–55 % on our one-knob compressor); sources were tutorials (Audient, Ruah Creative House, Async, Podcastle, Cleanvoice) — starting points, tune by ear.
- **Ducking per track, in FX:** the switch turns that track down under host + guest (or picked tracks), with knobs for amount, threshold, dip speed, recovery and the envelope drawing. Still `doc.ducking` rules (≤ 8) underneath: on = reuse this track's rule or add one targeting only it; off = disable (or take this track out of an older shared rule).

**Export dialog** (Tyler: "we don't need all this"): one line ("Exports your saved edit, exactly as you hear it."); per export only LUFS · dBTP · size and plain-language warnings. Pre-encode readings, limiter use, SHA-256 and LRA are still stored in the job summary, just not shown.

### Recorder
- **Live waveform** = audiocn LiveWaveform, `bars` variant: newest on the right, scrolling left, red retake tallies overlaid, no edge fade. (The `mirror` variant mirrors the history out of the center — Tyler caught it in a screen recording; `validation/stage05/recorder-live-waveform.mjs` now checks direction.)
- **Mic setup sidebar** after audiocn's mic-setup block: AudioDeviceSelect, LevelMeter + DbReadout + clip light, and "Check my level" (3 s → good / too quiet / too loud / no signal; warnings amber, red stays for recording). Drives the recorder's own capture (the block opens its own stream and adds gain; the recorder captures raw input). Block file and its Phosphor dependency removed (Font Awesome only); the device select was adapted from Base UI's Select to this project's Radix Select.
- Take times and new clip names use the viewer's time zone (server runs in UTC; clip names used to be 6 h off). `components/local-time.tsx` renders after hydration (also fixed a hydration warning).

### Public pages and embed
- **Player redesigned around audiocn's Waveform**, laid out like Buzzsprout's episode player (Tyler's reference): big round play button beside the episode's mirrored waveform (click/drag to seek, hover shows the time, played part in the accent), then −15 / +30 / speed on the left and "elapsed | length" on the right; no box, no volume slider. **Sticky bar:** compact — play, 36 px waveform, remaining, speed (+ skips and mute on wider screens; on phones the controls get their own row). Falls back to audiocn's slider without a waveform. The site-wide player gained real volume/mute (session only, nothing stored).
- **Waveform data:** `GET /{show}/media/{public-id}/waveform.json` (public episodes only, 404 otherwise): the published MP3 streamed through ffmpeg once (mono 8 kHz, 50 ms blocks, never held whole) → 1,000 bars scaled to the loudest (`lib/waveform-peaks.ts`) → cached as `<mp3 key>.wave1.json` beside it. **The web image now includes ffmpeg** (≈100 MB).
- **Show page list view** → audiocn **TrackList** (playing bars, current row, duration, play action); grid tiles' play buttons → audiocn **AudioPlayerPlay** on the site-wide player.
- **Embed** (`/{show}/embed/*`) is now a React route (`routes/embed.tsx`, `components/embed/embed-player.tsx`) with the same player layout under its artwork/title header, and audiocn **TrackList** for the whole-show playlist. Same options (player/theme/accent/follow), Media Session, "Audio isn't available", and the same messages to embed.js. It loads the site's own JS/CSS bundle (CSP `script-src 'self' 'unsafe-inline'`, nothing from other origins, no cookies) — heavier than the old ~10 KB inline page. Starting heights 196 px audio / 400 px video (it resizes itself). **Sandboxed iframes:** `/assets/*` is served with `Access-Control-Allow-Origin: *` (public, hashed, static) and the embed page leaves out ScrollRestoration (sessionStorage is forbidden there) — found because the Embeds screen's own preview iframe didn't hydrate.
- Icons for audiocn player parts are Font Awesome (`components/ui/player-icons.tsx`: rotate arrows with 15/30, speaker following the level).

### Base palette (Tyler): #000000 · #FABF47 · #00FFF5 · #BEFF00 · #FF807F · #C7BFF6
Black, Gold, Cyan, Lime, Coral, Lavender (+ Custom) for Brand & theme accents (`BRAND_PRESETS`, default Gold), track colors (`TRACK_COLOR_PRESETS`) and embed accents (`?accent=…`, default Gold). Black shows as bone (#ecebe6) on dark backgrounds (studio, dark public pages, dark embeds, timeline); stored value stays #000000. Old data keeps working: old presets read as Custom with their exact color; a custom hex equal to a preset reads as that preset (Tyler's #BEFF00 → Lime); saved embed configs map amber→gold, teal→cyan, ink→black; pasted URLs with accent=amber/teal/ink still render. Speaker defaults (host amber, guest teal, music violet) unchanged.

### audiocn as the audio UI kit
Tyler: "needs to become a central part of this project … all audio components must pull from audiocn". In use: level-meter, knob, fader, pan-control, channel-toggle, spectrum, lcd-display, live-waveform, audio-player, track-list, volume-control, waveform, audio-device-select (+ db-readout, clip-indicator, db-scale). Added with `npx shadcn@3.5.0 add @audiocn/<name>`; pipe `yes n |` so it never overwrites existing files, and **restore `app/app.css` afterwards** (the CLI appends a duplicate `@layer base`). Small local edits to registry files are marked "Podstudio:" (ChannelToggle `accent` tone; Waveform exports `drawRoundedBar`/`WAVEFORM_BAR`; device select on Radix). Not done from his list: **ChannelStrip** (track headers). **Soundboard** is for the future hotkeys feature.

### US English
Tyler: "we are in the United States … it's color". UI text and docs are US English now (color, center, favorite, analyze, canceled). Stored values were not renamed (job status `"cancelled"`, summary `normalise`).

### Bugs found and fixed today (in this round's own code)
- Public play button rendered **disabled** (adapter said "idle"); visitors couldn't start an episode.
- After touching an audiocn fader, **every editor shortcut, Ctrl+Z included, was ignored** until clicking elsewhere.
- FX panel switches were bone, not the accent (portal outside the studio wrapper); FX button stayed gray when FX were on (shadcn outline's dark styles won).
- FX undo merged all FX changes on a track into one step; the fader's double-click-to-0 dB was lost; React #440 in the meter.
- MP3s sat 0.45 LU under target before the post-encode loop.
- Recorder live waveform grew out of the center (wrong audiocn variant).
- Embed didn't hydrate in sandboxed iframes; embed volume overflowed at 640 px.
- Clip names in UTC; a hydration warning from server-rendered local times.
- **Incident:** a rebuild under a `timeout` was killed mid-recreate and the studio was down a few minutes (recovered with `docker rm` + `docker compose up -d --no-build`). Rebuilds always run in the background now.

### Stage 05 checklist — not met / open
- `lint`, `e2e` and CI don't exist (same as Stage 04).
- Screens not pixel-compared with the mockup at 1440×900 (and the design has moved on from the mockup per Tyler's direction).
- Nobody has **listened**: noise reduction, compressor, EQ, presets, MP3 at 64 kbps. Tuning may be needed.
- Noise reduction handles stationary noise only.
- `shows.settings.fxPresets` aren't wired into "show templates" (screen 02).
- 2-hour MP3 export timing with FX not re-measured.
- Ten older browser scripts drive the removed Advanced switch / master column / Duck tab and need rewriting (listed in `validation/stage05/README.md`).

### Checks for Tyler (by ear / by hand) — all done, Stage 05 passed 2026-11-04
1. A voice track: FX → try **Podcast voice**, then **Noisy room**; switch effects on/off in the list and A/B. **Listen** — especially noise reduction at 50–80 %.
2. A music track under a voice: FX → **Ducking** on; play across a voice phrase.
3. Export **MP3 128 stereo** and **64 mono**; play them.
4. Public show page: play the latest episode from the waveform; skip, change speed; scroll down and use the sticky bar; try it on your phone.
5. Record a short take: the waveform should scroll in from the right; press K; in the sidebar pick the mic and "Check my level".
6. Brand & theme: try the six accents; check a track's color menu.

## Docker disk cleanup (2026-10-25)
Every rebuild leaves ~1 GB of build cache and superseded layers; after a long build session this had grown to ~100 GB (disk 85% full; cleaned back to 38%). **`scripts/rebuild.sh [web|worker]`** now rebuilds *and* runs **`scripts/docker-cleanup.sh`**, which keeps the most recent 8 GB of build cache and removes dangling images — never containers, volumes or tagged/in-use images (`KEEP_GB=` overrides). The same script runs **weekly from the user crontab** (Sundays 04:15, log: `~/.local/state/podstudio/docker-cleanup.log`; `crontab -l` to see or remove it). Plain `docker compose up --build` still works but skips the tidy-up. If space gets tight again: `docker system df` shows where it is. Never run `docker system prune --volumes` here (it would delete the Podstudio data volumes).
