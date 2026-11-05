# Stage 06b: Host publishing (Buzzsprout first)

**Goal:** A show can be set to "Hosted on Buzzsprout" (then RSS.com and Transistor) and Podstudio uploads, schedules and updates episodes there, pushes the rich metadata, and pulls the host's stats. Self-hosted (S3 + our own feed) stays an equal, per-show choice.

**Placement:** a core part of the build. Follows the Release 1 review, ahead of Stage 07. Release 1 itself stays scoped to the self-hosted feed.

At the end of this stage the app must still deploy and everything from earlier stages must keep working.

## Screens (ids from the mockup)
- Settings → Hosting (new): connect a host, test the token, choose the destination per show
- 14 Publish to feed (extended): host status per episode (uploading, processing, published with link, failed with Retry)
- 31 Analytics (extended in Stage 11 with host stats; this stage only stores them)

## Build
- [ ] `HostAdapter` interface in `packages/integrations/`: publish, update, schedule, unpublish, status, list existing episodes for import/sync, stats, capability matrix
- [ ] Per-show destination: Self-hosted or Hosted on X; secrets encrypted at rest, server-side only, never in logs or the browser; feature flag, off by default
- [ ] Buzzsprout adapter (reference): API token + podcast ID; create/update episodes (audio, title, description, artwork, publish date, private/draft), draft-then-publish, list for import/sync
- [ ] Rich metadata pushed where the host supports it: chapters, transcripts, contributors, soundbites; per-show podroll, feed verification and fan mail. Capability matrix per host; unsupported items warn, never silently dropped
- [ ] Host publishing runs on the Stage 06 durable jobs and idempotent `publications` rows (add `host`, `external_id`): verified MP3 rendition in, no transaction held during uploads, failed upload leaves the previous state intact, retries never duplicate an episode
- [ ] Stats pull: scheduled worker job, backoff, per-host rate limits; stored in `analytics_daily` with `source` extended (`op3 | local | buzzsprout | ...`); host-reported and OP3 numbers labeled, never merged
- [ ] Import an existing host feed/episodes with GUID preservation and an identity diff (same rules as Stage 06 import)
- [ ] Podcast Index and OP3 adapt to the host's feed URL (OP3 prefix only where the host allows it)
- [ ] RSS.com adapter (v4 multipart asset upload, then episode)
- [ ] Transistor adapter (authorize upload URL, upload, create and publish)
- [ ] Each additional host from the evaluation list is added only after its API is checked

## Decisions to settle at the start of the stage
- Who owns the canonical feed (host's or ours). The feed URL must never change except through 17b Move podcast.
- Which stats and metadata fields each host's API really exposes (check the current docs first; they change).
- Per-host file size and length limits, API rate limits.

## Docs to check first
- Buzzsprout: https://github.com/Buzzsprout/buzzsprout-api
- RSS.com: https://api.rss.com/v4/docs
- Transistor: https://developers.transistor.fm/
- Podcast Index: https://podcastindex-org.github.io/docs-api/#overview--example-code
- OP3: https://op3.dev/api/docs
- To evaluate: Podbean, Captivate, Libsyn, Spreaker, Acast, Spotify for Creators (open API?). Fallback for any host: export RSS + media zip.

## Out of scope
Analytics screens for host stats (Stage 11). Anything in a later stage. Leave stub routes, not half-built features.

## Done when
- [ ] A test episode publishes to Buzzsprout from Podstudio, and a retry after a forced failure creates no duplicate
- [ ] Draft, scheduled and published states match what Buzzsprout shows
- [ ] Chapters, transcript, contributors and soundbites appear in the host feed where supported; unsupported ones are reported
- [ ] Host stats sync into local tables and are labeled separately from OP3
- [ ] Tokens never appear in the browser, logs or DB backups in the clear
- [ ] Self-hosted publishing still works unchanged
- [ ] lint, typecheck, unit and e2e tests pass in CI
- [ ] CHANGELOG.md has an entry for this stage

## Demo for review
Connect Buzzsprout, publish a private draft, schedule one, publish one, show the chapters/transcript in the host, then sync stats.

## Then
Update `STATUS.md`, write a short summary of what changed and anything that was skipped, and **stop**. Don't start the next stage until Tyler says go.
