# Stage 09: Public site & embeds

**Goal:** Listeners get a real website and players.

At the end of this stage the app must still deploy and everything from earlier stages must keep working.

## Screens (ids from the mockup)
- 25 Public show page
- 26 Episode page on a phone
- 27 Embed players
- 28 Player themes
- 29 Public page links
- 29b Brand & theme (accent, appearance, corners, scopes)
- 30 Public episode page + transcript dialog

## Build
- [ ] Server-rendered public routes `/{show}` and `/{show}/episodes/{public-id}/{slug}`; immutable public-id lookup, canonical-slug redirects, Open Graph, JSON-LD and sitemap; episode numbering is not identity
- [ ] Website + social links (sortable, platform picker, rel="me"); people with websites
- [ ] Episode page: chapters with art, soundbites, links, people, support card, up next; transcript dialog with search, Follow along, speaker filters, #transcript deep link
- [ ] packages/embed player (Preact, < 30 KB gz), dark/light/auto, accent, Media Session
- [ ] Embed admin: iframe (default), Script (embed.js auto-resize + events), Paste a link (oEmbed endpoint + discovery link)
- [ ] Per-show theme as CSS variables; accent presets + custom hex; light/dark/auto; corners; scopes for public site, embeds and studio; automatic contrast fixes
- [ ] Complete paper/dark theme tokens for dialogs/popovers and public controls; use pinned/self-hosted fonts and validated accent variables
- [ ] Keep Stage-06 protected episodes/media excluded from public pages, transcript search, feeds, sitemap and all embed/oEmbed scopes
- [ ] Validate postMessage origin/source and allowed messages; transcript UI shares the page media clock instead of playing a second audio element

## Out of scope
Video playback controls/renditions activate only when Stage 10 provides verified media. Analytics and podroll sections wait for Stage 11; no fake counts. Mobile listening layout is in scope, mobile host recording is not.

## Done when
- [ ] Every accent preset and a random custom hex pass WCAG AA for buttons and links (unit test on the contrast function)
- [ ] Lighthouse ≥ 95 performance and SEO on show + episode pages
- [ ] Embed works on a foreign origin in a sandboxed iframe
- [ ] No cookies set on public routes (test)
- [ ] Repeated season episode numbers, unnumbered episodes and trailers have distinct stable public URLs; protected episodes cannot appear through any public discovery/player endpoint
- [ ] Screens match the mockup at 1440×900 (and 390×844 for phone screens)
- [ ] lint, typecheck, unit and e2e tests pass in CI
- [ ] CHANGELOG.md has an entry for this stage

## Demo for review
Open the public page, paste the iframe into a plain HTML file, toggle dark/light.

## Then
Update `STATUS.md`, write a short summary of what changed and anything that was skipped, and **stop**. Don't start the next stage until Tyler says go.
