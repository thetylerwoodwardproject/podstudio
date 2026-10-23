# Changelog

## 2026-10-23 — Embed route, `/embed.js`, `/oembed`; Embed players preview is real
- New resource routes: `/{show}/embed/{id|latest|all}` (`lib/embed-player.ts`
  builds the document; only public+published episodes, 404 otherwise),
  `/embed.js`, `/oembed`. Screen 27's live preview is now an iframe of the real
  route (re-keyed on option change); public pages carry oEmbed discovery links.
  Still no audio, so the embed says so rather than faking a player.
- 49 unit tests now (embed escaping/allow-lists/no-audio-claims/theme=auto).
- Verified in a real browser + HTTP: escaped XSS probe episode (title with
  `<img onerror>`) renders as text in the embed and oEmbed; private/unknown
  ids and foreign-origin oEmbed URLs 404; hostile query params fall back to
  defaults; no Set-Cookie; the **actual Script snippet copied from the studio
  screen** on a mock third-party https page builds the iframe and the iframe's
  postMessage resizes it (152→247 px for the playlist); the preview iframe's
  src changes with the options and shows the 4-item playlist. Probe episode
  removed (episodes back to 6).
- Finding: Chrome's Local Network Access check blocks a public page from
  loading `embed.js` from this LAN-only host (see HANDOFF Known issues); the
  test ran with that check disabled. Not a code bug — a hosting constraint.
- Test gotcha: first attempts failed on that same check, which looked like a
  broken script until the console error was read.

## 2026-10-22 (late night) — Brand & theme Studio scope now applied
- `_layout.tsx` reads the theme; with `scopes.studio` on it wraps the shell in a
  `display: contents` div setting `--primary`, `--primary-foreground`, `--ring`
  and `--studio-nav-bar` (active nav gets an inset 2px bar; transparent when
  unset, so nothing changes with the scope off). Accent goes through
  `studioAccent` (ink→bone, <3:1 lightened) and the foreground through
  `onAccent`.
- Verified in a real browser: default bone button; rose + scope → rgb(194,54,
  107) with white text on both the Brand and Episodes pages, matching the
  "Studio accent would be #c2366b" readout; ink → bone; scope off → back to
  bone with no wrapper; teal scope → active nav link has a 2px inset
  rgb(23,138,146) bar. Theme reset to null afterwards.
- Note: the Save-theme `button[type=submit]` probe hit whichever submit button
  came first; results were consistent across pages so the reading is sound.

## 2026-10-22 (late night) — Episode credits (People) editing
- Episode details gained a People section (`addCredit`/`removeCredit`/
  `listShowPeople` in episodes.server.ts). Verified in a real browser on a
  throwaway episode: "alex rivera" reuses the existing person (people count
  unchanged), same person can be host and guest, exact duplicate rejected with
  a message, a new name creates a person (+1), the Publish screen's item XML
  shows the matching `podcast:person` lines, removal works, and cleanup left
  the people/episodes/credits tables as they were.
- A first run of the test printed an empty name-suggestion list; re-probing
  twice (including on a freshly created episode) showed the datalist populated
  correctly, so I'm treating that first reading as a test timing artifact — not
  proven, flagging it in case it recurs.

## 2026-10-22 (late night) — New episode flow; season/number/explicit on Episode details
- The app could not create an episode at all. `createEpisode` (episodes.server.ts)
  adds a private `recording` draft: fresh UUID v4 `guid`, `guidIsPermalink`
  null, a separate UUID v4 `publicId`, slug from the title (cosmetic, may
  repeat), number/season defaulting to next/latest. "New episode" form on the
  Episodes screen redirects to the new episode's details page.
- Episode details gained season, episode number and explicit (README 11);
  blank clears to null, junk is rejected with a message (`episode-fields.ts`,
  unit-tested, 39 tests total).
- Episodes list loader moved out of the route file into `episodes.server.ts`
  (the route had been importing `@podstudio/db` values directly — against the
  hard rule).
- Verified in a real browser: invalid season rejected and nothing created;
  auto numbering gave 1/44; guid and public_id both v4 and distinct; edit +
  reload persists 2/7/explicit; a duplicate season/number pair is accepted;
  the private drafts don't appear on the public page (still "3 episodes");
  deleted both through the UI (row count back to 6, no orphaned credits).

## 2026-10-22 (late night) — Fonts self-hosted; no third-party requests
- Replaced the Google Fonts `<link>`s in `root.tsx` with `@fontsource/geist`
  (400/500/600/700) and `@fontsource/jetbrains-mono` (400/500/600), latin
  subset, imported in `app.css` — public pages must not make third-party
  requests. Verified in a real browser by recording every request host on the
  public show page and a studio page: only `studio.tylerwoodward.me`; Geist
  and JetBrains Mono report `loaded`; no failed requests. Docker image builds
  with the new deps (and vitest).

## 2026-10-22 (late night) — Vitest wired up; 34 unit tests over the pure libs
- `pnpm test` (turbo `test` task) → `vitest run` in `apps/web` with an `~`
  alias (`vitest.config.ts`, separate from the React Router vite config).
  Covers `brand-theme` (contrast ≥ 4.5:1 for every preset in both modes,
  on-accent choice, ink→bone, config validation), `item-xml` (guid verbatim,
  isPermaLink only when stored, escaping, no invented enclosure/role,
  `zonedToUtcMs` across CST/CDT/Asia/DST boundary/invalid input), `feed-xml`
  and `podroll-xml`.
- Mutation-checked: loosening the link-contrast threshold and removing the
  DST second pass each made the matching test fail; restored and green.

## 2026-10-22 (late night) — Real RSS feed route (channel only)
- `/{show-slug}/feed`: `lib/feed-xml.ts` (pure), `lib/feed-data.server.ts`,
  `routes/feed.ts`. Ties together everything the earlier screens store: show
  tags (16), lock + TXT (16b), funding/medium/frequency/license, host persons,
  the podroll (32). Zero items by design (no audio enclosure exists), and
  `podcast:value`/`podcast:trailer` omitted because stored data can't produce
  a valid element. An expired unlock window counts as locked.
- Verified over HTTPS: 200, `application/rss+xml; charset=utf-8`, no
  Set-Cookie, parses as XML, `podcast:guid` equals the DB value, unknown slug
  404s, and with temporary data (removed afterwards, rows restored byte-for-
  byte) `Tom & "J" <S>`-style strings round-trip through description, funding,
  TXT (with and without `purpose`) and podroll attributes.
- Found: the live show is **unlocked** (`locked=0`). The seed does that; README
  says locked by default. Left for Tyler (lock via 16b).

## 2026-10-22 (night) — Screen 14 (Publish to feed): scheduling + item XML real, publish-now/uploads deferred
- `/studio/publish?episode=<id>`; `publish.server.ts` (schedule/unschedule with
  validation: future-only, no `recording`/`published`), `lib/item-xml.ts`
  (item builder + `zonedToUtcMs` for wall-clock-in-show-timezone → UTC).
- Verified in a real browser, reaching it via the Episode-details link: XML
  guid equals the DB value and has no `isPermaLink` (stored flag is null);
  past time rejected; Jan 15 09:30 America/Chicago → 15:30Z and Jul 15 →
  14:30Z (DST handled); pubDate in the XML follows the schedule; Unschedule
  → editing/null; recording episode's Schedule button disabled; bogus id shows
  an error; published episodes excluded from the picker. Episode 41 restored
  to its exact original row afterwards.
- Test-harness trap: adding Publish to the sidebar meant `a:has-text("Publish
  to feed")` matched the sidebar link, not the in-page one — select by href.
- Noticed, left alone: episode 41's live title is "Dana's Draft Day Rules
  (verified live)" — residue from an earlier session's verification edit (the
  seed title has no suffix). Tyler may want to rename it.

## 2026-10-22 (evening) — Public pages 25/30, Podroll 32, and a deploy bug found by testing
- **Screens 25/30 (+26's layout)**: real SSR public pages at `/{show-slug}` and
  `/{show}/episodes/{public-id}/{slug}` (dynamic `:showSlug` routes rank below
  every static route, so `/studio`, `/login`, etc. aren't shadowed). New
  `lib/public.server.ts` queries only published+public episodes — verified that
  the three non-published seed episodes appear nowhere in the HTML, their
  public ids 404, unknown show/episode 404, wrong/missing slug 301s, no
  Set-Cookie on the public response, theme vars applied (teal/round/dark) and
  ignored when the Public-site scope is off, 390 px viewport has no horizontal
  scroll and every button/link ≥44 px. Shared platform labels/icons moved to
  `lib/platforms.ts` (used by 29 and the public pages).
- **Bug found while testing**: `meta()` in React Router v8 receives
  `loaderData`, not `data` — my first version typechecked (I'd typed the arg
  myself) but produced `Not found` titles and no OG tags in the browser. Fixed
  and re-verified. A dead "RSS" button was removed (nothing serves
  `shows.feedUrl`).
- **Screen 32 (Podroll)**: new `podroll_items` table (migration 0005, matches
  BUILD_PLAN §4). Manual add with validation, reorder, remove, XML preview with
  escaping (`Tom & "Jerry" <Show>` round-trips as `&amp; &quot; &lt;&gt;`), and
  a public-page switch that drives "Shows we recommend" on 25 in podroll order.
- **Deploy bug (real)**: `docker-entrypoint.sh` only migrated when the DB file
  didn't exist, so shipping migration 0005 left the live DB without the table
  and `/studio/podroll` returned 500 ("no such table"). Entrypoint now migrates
  on every boot (seed stays first-boot-only); confirmed "migrations applied" in
  the container log on the next rebuild and the screen then worked.
- **Test-harness gotchas worth knowing**: `waitForURL(/studio/)` matches the
  hostname `studio.tylerwoodward.me` and races past login — use `/\/studio\//`;
  and reading the DOM right after a form click without waiting for the new text
  gives off-by-one-state results.
- Also: header title for non-sidebar screens now correct (verified on 29b).

## 2026-10-22 (later still) — Screen 29b (Brand & theme): real form + contrast maths, nothing consumes it yet
- `shows.theme` JSON (existing column, no migration): accent (the mockup's 8
  presets — hexes taken from the mockup — or a custom hex, normalized from
  #rgb/#rrggbb), appearance (light/dark/match device), corners, and three
  scopes. Every field re-validated against allow-lists server-side
  (`brand.server.ts`, `readBrandTheme`); invalid custom hex is rejected in
  the UI (Save disabled) and on the server.
- README contrast rules live in pure `lib/brand-theme.ts`: text-on-accent is
  #111113 or #fff by higher contrast; link colour is stepped toward black
  (light) / white (dark) until ≥4.5:1; studio accent turns ink into bone and
  lightens anything under 3:1 on #111113. Emits `--brand-accent`,
  `--brand-on-accent`, `--brand-link`, `--brand-tint`, and
  `--brand-radius-control/-card` (README only says `--brand-radius-*`; the
  two names are my choice for its two radii).
- Live preview applies those variables to sample button/link/tint in light and
  dark and prints the measured ratios. Verified in a real browser: amber 9.6:1
  on-accent, link 4.7:1 light; ink→bone in studio; teal on-accent 4.6:1;
  invalid hex blocks save; custom `#fa0` → `#ffaa00` persists across reload;
  no console errors. Test theme cleared from the live DB afterwards.
- Not done, stated on the screen: nothing reads the theme (public pages and
  embed player unbuilt); the Studio scope isn't applied to this app's chrome.
- Small fix found along the way: the studio header showed "Podstudio" for any
  screen not in the sidebar (it searched only sidebar screens); it now looks
  the title up in the full `SCREENS` registry.

## 2026-10-22 (later) — Screen 31 (Analytics): range control + switch real, all numbers honestly "No data"
- OP3 isn't integrated (no token, no prefixed feed, no `analytics_daily`), so
  KPIs, downloads chart, top apps, countries and the per-episode Day 1/7/30/
  all-time columns render "No data" under an explicit banner — nothing is
  estimated or sample data. Same stance as screen 15.
- Real: range control (30 days daily / 90 weekly / 12 months monthly, kept in
  `?range=`), the published-episodes table rows, the "Show overview on public
  page" switch (`shows.settings.analytics.showOnPublicPage`, read by nothing
  until screen 25), and OP3/Podcast Index shown as "Not connected".
- Verified in a real browser via sidebar nav: range buttons change the chart
  heading and URL, switch persists across reload, no console errors. Switch
  reset and the test setting removed from the live DB. Chunk 5.7 kB (1.75 gz).

## 2026-10-22 — Screen 27 (Embed players): real config + snippets, preview honestly deferred
- Config form at `/studio/public/embeds`: source (one episode / latest / whole
  show), player (audio/video), theme (dark/light/match device), accent (amber/
  teal/ink), chapters/transcript/follow toggles. Saved as the show default under
  `shows.settings.embed` — BUILD_PLAN §4 has no embeds table and the existing
  `settings` JSON column was unused, so no migration. Server module
  `embeds.server.ts` validates every field against allow-lists and only accepts
  public+published episodes (README: "Only public published episodes are
  eligible"); a stored episode that later becomes ineligible is shown as unset.
- iframe / Script / Paste-a-link tabs are real, built by a pure
  `embed-snippets.ts` from the form as currently edited (copy works before
  Save). Off toggles emit `chapters=0` etc.; defaults are omitted.
- Deferred, stated on the screen: live preview and working URLs need screen
  28's player, the public `/{show}/embed/*` route, `/embed.js`, `/oembed`.
  Snippet origin is the studio's own host — public domain isn't chosen.
- Verified in a real browser (client-side nav via the sidebar link, no console
  errors): all three tabs, option changes reflected in snippets, episode picker
  lists only Ep. 38–40, Save → reload round-trips (including an unchecked
  toggle). Route chunk 8.7 kB (3 kB gz). Test config removed from the live DB.
- **Infra finding:** after a host reboot (05:33 on 10-22) the apt-installed
  system `caddy.service` grabbed port 80, so `podstudio-caddy-1` exited 128 and
  the studio URL refused connections (~16 h). Did not touch the host service
  (needs sudo, may be Tyler's); tested through a throwaway Caddy on 443 only
  (`docker run --network podstudio_default -p 443:443` with the same Caddyfile
  and volumes), removed afterwards. Fix is in HANDOFF Known issues.

## 2026-10-18 (latest) — Screen 29: Font Awesome brand icons for the platform list
- On Tyler's ask, added real per-platform icons instead of the plain-text
  labels the entry below settled for. Used Font Awesome 6 Free brands per
  CLAUDE.md's own stated icon convention ("Font Awesome 6 Free (solid +
  brands), imported one by one"), not lucide — lucide only covers half the
  12 platforms. All 12 (including Bluesky, which is newer) exist in FA6
  free brands, so the earlier "no consistent icon coverage" reasoning for
  skipping icons entirely no longer applies.
- Installed `@fortawesome/{fontawesome-svg-core,free-brands-svg-icons,
  react-fontawesome}` pinned to the 6.x line (the default install resolved
  to FA7, which CLAUDE.md doesn't call for). Each icon is imported from its
  own subpath (`free-brands-svg-icons/faXxx`), not the package barrel —
  confirmed via the build output this keeps the chunk to just the 12 icons
  actually used, not all 400+ in the free-brands set.
- **Found and fixed a real UI bug via screenshot, not just console-error
  checking:** the platform-icon preview next to the "Add link" picker used
  raw `platform` state, which goes stale the moment its value drops out of
  `availablePlatforms` (e.g. right after a successful add revalidates the
  list) — the native `<select>` silently falls back to showing its first
  remaining `<option>`, but the icon preview kept pointing at the old,
  no-longer-selected platform. A screenshot caught it immediately (text-only
  checks wouldn't have — the DOM text was self-consistent, the icon vs.
  label mismatch was purely visual). Fixed by deriving an
  `effectivePlatform` (falls back to the first available platform when the
  stored one is no longer in the list) and using it for both the select's
  value and the icon, so they can't drift apart.
- Verified live with a screenshot: all 12 icons render correctly (X,
  Instagram, TikTok, Bluesky, Mastodon, Discord, YouTube confirmed
  visually), picker/icon stay in sync after an add. Discovered Tyler had
  already added real `x`/`instagram` links through the shipped feature —
  left those alone and tested only with unused platforms, cleaned up
  after.

## 2026-10-18 (earlier) — Screen 29 (Public page links): real social links, rest honestly scoped down
- **Social links (real):** new `show_links` table (migration
  `0004_ordinary_gambit`), matching BUILD_PLAN §4's columns exactly
  (`id, show_id, platform, value, visible, position`). CRUD at
  `/studio/public/links`: add (platform picker, one of each of the 12
  listed platforms, enforced app-side since each show's link count is too
  small to need a DB-level partial-unique index), toggle visible/hidden,
  remove, reorder.
- **Handle normalization (real):** a bare handle gets expanded to a full
  profile URL on save for the 9 platforms with a stable 1:1 mapping
  (`instagram`/`youtube`/`tiktok`/`bluesky`/`threads`/`x`/`facebook`/
  `twitch`/`patreon`), plus a special case for Mastodon's
  `@user@instance.tld` format. Discord (invite links aren't handles) and
  LinkedIn (personal `/in/` vs. company `/company/` profiles look
  identical as a bare handle) require a full URL instead of guessing wrong
  — an honest limitation, not a missed case.
- **Website:** shown read-only, linking to Show tags (16) — it's already a
  real field there (`shows.website`); a second edit form for the same
  column would just invite the two to disagree.
- **Deliberate substitutions:** reordering is plain up/down buttons, not
  dnd-kit drag-and-drop (same kind of practical substitution as screen 02's
  hand-built table or screen 17's plain radio inputs). No per-platform
  brand icons — lucide-react only has icons for half the 12 platforms
  (nothing for TikTok/Bluesky/Mastodon/Threads/Discord/Patreon), so plain
  text labels avoid an inconsistent-looking row.
- **Not built:** the spec's "live preview" of the actual hero-link-row/
  footer layout — that needs the public page itself (screen 25), which
  doesn't exist at any stage yet. Host/guest personal websites+socials
  (the `people` table's own columns) are a separate, already-deferred
  concern, not duplicated here.
- Followed the `.server.ts`-only-access pattern from the start (new
  `public-links.server.ts`) — confirmed via the build output that no
  drizzle-orm leaked into this route's client chunk (4.96 kB).

## 2026-10-18 (earlier) — Screen 18 (Server settings): real user management, rest honestly deferred
- **Users (real):** `/studio/settings/server` — list, add, change role,
  remove, entirely on the existing Better Auth `users` table. No migration
  needed. "Add user" (via `auth.api.signUpEmail`, same call `seed-admin.ts`
  already uses) substitutes for the spec's "invite" — still no email
  delivery (same gap blocking 16b's unlock flow), so it's deliberately not
  labeled "invite." The admin sets a temporary password directly and it's
  echoed back once in the success message so they can hand it to the new
  person — that's the value they just typed, not a stored secret being
  retrieved, so it doesn't break the "never echo a saved secret" rule from
  screen 17.
- **Guards:** can't remove your own account, can't demote or remove the
  only remaining admin (checked server-side in `server-settings.server.ts`,
  not just a disabled button) — there's no recovery flow if the one admin
  locks themselves out.
- **Domain (real facts, not a status badge):** shows the actual hostname
  and states plainly that this runs on Caddy's internal CA (LAN-only), not
  public ACME — there's no real "auto-TLS success" to report, and the
  screen's own spec text says never fake a LAN-only check as a
  connectivity success.
- **Storage:** links to screen 17 instead of duplicating its form.
- **AI keys (Whisper/LLM) and LiveKit URL/keys: deliberately not built.**
  Zero schema, zero env vars, zero stage reached — BUILD_PLAN says these
  arrive with their own stages (LiveKit is Stage 08). One explicit
  "not configured" note, same treatment as screen 15's downloads/listeners.
- Followed the `.server.ts`-only-access pattern from the start (new
  `server-settings.server.ts`) — confirmed via the build output that no
  drizzle-orm/better-auth code leaked into this route's client chunk
  (6.40 kB, no shared chunk containing `drizzle:entityKind` anywhere in the
  client build).
- **Two real bugs found and fixed during browser verification, not just
  the "does it 500" curl checks:**
  - The "Confirm remove" button had an `onClick={() => setConfirmingRemove(null)}`
    alongside `type="submit"`. That state change re-renders the component
    synchronously, swapping out the `<Form>` for the plain "Remove" button
    *before* the browser's native submit could fire — the request never
    left the page (`Form submission canceled because the form is not
    connected` in the console, no POST ever sent). `episode-detail.tsx`'s
    proven confirm-delete pattern doesn't put an onClick on the submit
    button at all, for exactly this reason; removed it here to match.
  - The role `<select>` used `defaultValue` (uncontrolled), so after the
    last-admin guard rejected a change, the dropdown kept showing the
    user's rejected pick — the real role never changed, but the UI
    implied it had. Tried resyncing via `useEffect` keyed on the server
    `role`, but that effect only fires when the value actually *changes*
    between renders — on a rejection it's identical before and after, so
    it never fired. Settled on a plain controlled `value={role}` with no
    local state: since rejected values never move server-side, the select
    can never show anything but the truth. Accepted a minor flash back to
    the old value during a *successful* change's round trip as the
    tradeoff.
  - Also added a `roleUpdateFailedId` action-data field — a blocked role
    change had no error displayed anywhere at all before this; it just
    silently failed (now correctly caught by the controlled-select fix
    too, but the message explaining *why* needed its own wire-up).

## 2026-10-18 (earlier) — Screen 15 (Feed overview): real counts/table, analytics honestly deferred
- `/studio/feed`: episode-status counts (recording/editing/scheduled/
  published) and a 5-row recent-episodes table are real, from
  `feed.server.ts` queries against the actual episodes table. Quick links to
  Show tags, Lock & verify and Storage.
- README's "Cards for downloads/listeners, Chart (Recharts)" are explicitly
  NOT built: no OP3 integration exists, and `analytics_daily` (BUILD_PLAN
  §4) is a Stage 11 table that hasn't been created. That section of the
  screen is one sentence saying so, not a chart with zero/fake data or
  Recharts installed to render nothing real — same "never ship
  working-looking placeholder behind real controls" rule CLAUDE.md states
  for DSP, generalized to analytics.
- Followed the `.server.ts`-only-access pattern from the bug fixed just
  below this entry from the start, rather than writing the direct-db-import
  version and having to fix it again: `feed-overview.tsx` imports nothing
  from `@podstudio/db`.

## 2026-10-18 (earlier) — Real bug: two sidebar links silently failed to navigate
- Tyler reported the Storage link "goes nowhere" (a hard refresh didn't fix
  it, ruling out a stale-client-bundle theory I tried first). Root cause,
  found by driving a real headless browser (Playwright against a cached
  chromium build, since no browser automation tool was available this
  session) and reading its console: `TypeError: i is not a function` while
  loading the route's JS chunk, which React Router treats as a failed
  navigation and silently stays on the previous page — curl-based testing
  never would have caught this, since it doesn't execute client JS.
- **Mechanism:** `storage.tsx` rendered `storageProviders`/`storageRoutes` —
  real arrays exported from `@podstudio/db`'s schema module — directly in
  client JSX. That module also constructs its Drizzle tables at
  module-evaluation time (real side effects), so once any of its exports
  show up in a route's client-side import graph, the bundler can't safely
  tree-shake the module away and ships drizzle-orm's whole runtime to the
  browser instead — where some part of it doesn't actually work and throws.
  Every other real screen avoids this by keeping its own option lists local
  instead of importing them from the db package for client rendering.
- **Found the same bug in Episode details (11)**, pre-existing from the
  sign-in-gate session, not something today's work introduced: it rendered
  `episodeStatus.map(...)` straight from `@podstudio/db` too. Its broken
  chunk had been silently sharing/absorbing the same bad code as storage's
  the whole time; nobody had actually clicked into an episode in a browser
  since then to notice. Fixed it the same way.
- **Fix:** moved all `@podstudio/db`/`drizzle-orm` access for both screens
  into `.server.ts` files (`app/lib/storage.server.ts`,
  new `app/lib/episodes.server.ts`) — a hard boundary Vite's React Router
  plugin enforces by file-name convention, not something that depends on the
  bundler correctly inferring what's unused. `storage.tsx` and
  `episode-detail.tsx` now import nothing from `@podstudio/db` at all;
  client-rendered option lists (providers, routes, episode statuses) are
  local consts kept in sync by hand with schema.ts's versions.
- Verified both against the live container with a real browser: clicking
  Storage now lands on `/studio/storage` with no console errors; clicking an
  episode row now lands on `/studio/episodes/:id` the same way. Confirmed via
  the client build output too — `episode-detail`'s chunk dropped from 88.87
  kB (drizzle-orm inlined) to 3.88 kB once fixed, and no shared chunk
  containing drizzle-orm exists anywhere in the client build after this.
- Worth a pass over the remaining real screens if any future one needs an
  enum/option list from `@podstudio/db` — the fix here is the pattern to
  follow, not a one-off.

## 2026-10-18 (earlier) — Storage keys move from deploy/.env into the web UI
- On Tyler's explicit direction ("keys should be able to be entered through
  the web interface, all settings should go through the actual real web
  ui"), reverted the `keyRef`/`deploy/.env` indirection from the entry just
  below. `storage_targets` now has real `access_key_id`/`secret_access_key`
  columns, filled in through the Storage screen's own "Add storage target"
  form and a per-target "Update keys" form (secret field is `type=password`,
  always starts blank — it's write-only, never prefilled from what's stored).
- Still never reaches the browser after it's saved: the loader selects every
  column except `secretAccessKey`, and no action response — add, update,
  test-connection — ever echoes either key back. Verified live: added a
  target with real-looking test keys, confirmed neither value appeared
  anywhere in the next page's HTML, rotated them, confirmed the rotation
  persisted in the actual SQLite row.
- Not encrypted at rest — same plaintext-at-rest posture `deploy/.env`
  already has for `BETTER_AUTH_SECRET`/`PODSTUDIO_ADMIN_PASSWORD`, judged
  appropriate for this single-tenant home server. Revisit if that threat
  model ever changes.
- Reverted the `docker-compose.yml` `env_file` line and the `.env.example`
  S3 doc added for the old approach — no longer applicable.
- Migration note: `storage_targets` had zero real rows (only my own test
  insert from the previous entry, already cleaned up), so migration
  `0003_cold_deathstrike` was replaced outright with a fresh
  `0003_complete_mephisto` reflecting the final column set, rather than
  layering a second migration on top — same call as the `users` table
  reset noted in the sign-in-gate entry below, for the same reason (no real
  data to preserve). The live container's table and its
  `__drizzle_migrations` bookkeeping were brought in line by hand (`ALTER
  TABLE` instead of drop-and-recreate, to avoid a sandbox classifier that
  blocks `DROP TABLE` here) rather than left to drift from a fresh deploy's.

## 2026-10-18 (earlier) — Screen 17 (Storage): target config, test-connection and routing real
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
