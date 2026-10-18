# Stage 06: Existing-show import, feed publish & protected sharing

**Goal:** Podstudio is now a working audio podcast host.

**Release 1 gate:** this stage completes the first solo-audio release, including existing-show import and password-protected listening. AI, remote guests, the full public site and video are later stages.

At the end of this stage the app must still deploy and everything from earlier stages must keep working.

## Screens (ids from the mockup)
- 14 Publish to feed
- 15 Feed overview
- 16 Show tags
- 16b Lock & verify (podcast:locked with owner-consent unlock, podcast:txt records)
- 11 Episode details (manual fields, no AI yet)
- Password-protected share settings/listening page (new behaviour extending screen 14; not the full public site)

## Build
- [ ] packages/feed: RSS 2.0 + iTunes + Podcasting 2.0 writer, parser and validator
- [ ] GUID rules: immutable exact identifier values plus original absent/true/false isPermaLink, retained source feed and round-trip diff; no automatic fixes for missing/duplicate item GUIDs
- [ ] Import Tyler's existing RSS: inventory episodes/media/namespace metadata, preserve identities/dates/metadata and review missing show GUID or non-MP3 archival media before cutover; retain import evidence and report unsupported metadata rather than silently dropping it
- [ ] Publish now / schedule / **password-protected link**; item XML preview and manual chapters.json
- [ ] Feed served at a stable URL, cached, with ETag
- [ ] Verified immutable renditions and feed revisions; atomically activate validated publication only after assets are ready, retain last valid feed on failure and deduplicate publication/notification jobs
- [ ] Schedule UTC instants with explicit show timezone; restart catch-up exactly once and observable job failures
- [ ] Feed lock: locked by default, unlock only via an owner email code, timed auto re-lock, audit log
- [ ] podcast:txt records at show and episode level (applepodcastsverify, verify, ai-content, custom) with length validation
- [ ] Hosted audio MP3 only: presets from Stage 05, 44.1 kHz CBR, −16 LUFS stereo / −19 mono, approved post-encode true peak and ID3 chapters; originals private, no public WAV alternate
- [ ] Protected share password hash, optional expiry, revocation/password versioning, scoped access sessions and private-media/range authorization; record maximum signed-URL lifetime if used
- [ ] Minimal `/share/*` listening page; exclude protected media/artwork/transcripts from public buckets, RSS, search/sitemap, oEmbed and OP3; only necessary access-session cookies on protected routes
- [ ] Basic rate limits and audit events for password/code verification, feed imports and publishing; validate imported XML/URLs and sanitize descriptions at their feature boundary

## Out of scope
Transcription/AI, remote guests, full public show site/embeds, video and mobile recording. Do not invent advanced-tag editors or live analytics for integrations that arrive later; preserve imported metadata.

## Done when
- [ ] Uploading a WAV to the feed results in an MP3 enclosure; the validator rejects any non-MP3 enclosure (test)
- [ ] Unlocking without the emailed code is impossible (API test); the feed shows <podcast:locked>no</podcast:locked> only while unlocked
- [ ] Feed validates (Podcasting 2.0 + Apple requirements)
- [ ] Import → export → diff preserves every item/show identity, isPermaLink semantics and reviewed metadata; unresolved import/media issues block cutover
- [ ] Scheduled episode appears at the right minute; restart/retry does not duplicate it, and failed replacement renders leave the prior valid feed/media live
- [ ] Wrong/missing passwords, expired/revoked sessions and direct unauthenticated media/range requests cannot access a protected rendition; public discovery endpoints exclude it
- [ ] Record → forced interruption/recovery → linked edit/retake cleanup → real noise reduction/voice FX → WAV/MP3 export → publish demo passes on the configured home server
- [ ] Off-site restore exercise recovers database/configuration/required secret material and verifies access to the imported/published media assets
- [ ] Screens match the mockup at 1440×900 (and 390×844 for phone screens)
- [ ] lint, typecheck, unit and e2e tests pass in CI
- [ ] CHANGELOG.md has an entry for this stage

## Demo for review
Import the existing show into a test environment, compare identities/metadata, finish and publish a new solo episode, subscribe in a podcast app, and demonstrate a protected share plus revoke/expiry. Do not switch the production feed until the release review.

## Then
Update `STATUS.md`, mark the Release 1 review current, report the checks/limitations using `RELEASE-01.md`, and **stop for the solo-audio release review**. Do not start Stage 07 or switch the production feed until Tyler says go.
