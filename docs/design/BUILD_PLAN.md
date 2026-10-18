# Podstudio: build plan for Claude Code

Read this file first, then `STATUS.md`, the current stage checklist, and the matching sections of `README.md`. Open `Podstudio v2.dc.html` for visual reference. There are 36 screens: 01–32 plus 13b, 16b, 17b and 29b. Library chips describe intended components, not verified integration contracts.

**Plan revised with Tyler's answers on 2026-10-17.** Confirmed scope and behaviour in this plan and README take precedence over older mockup copy. The HTML remains the visual reference. No implementation stage has passed yet.

---

## 1. What we're building
Podstudio is a single-tenant, self-hosted podcast studio deployed on Tyler's **home/local server** behind Caddy. Its eventual scope covers:
- **Record:** solo with a voice-following prompter, or with remote guests over LiveKit.
- **Edit:** a multitrack editor with FX, loudness, video shots and branding slots.
- **Finish:** transcribe, clip, export.
- **Host:** RSS with Podcasting 2.0, a public show site, embeddable players, OP3 analytics, and a podroll from Podcast Index.

The mobile host PWA is deferred. Responsive public listening pages are separate from mobile recording.

### Confirmed release decisions
| Area | Decision |
|---|---|
| First usable release | Desktop solo audio: record → recover → edit → export → publish; complete through Stage 06 |
| Existing show | Import an existing podcast, preserving GUIDs and metadata |
| Editing | Core multitrack operations, synchronized cuts, fades, gain, mute/solo, undo/redo and autosave |
| Audio finish | Filters, EQ, compression, loudness normalization and working noise reduction are required in the first release |
| Retakes | K saves an annotation **and injects a detectable tone into the recording**; cleanup is reviewed before applying |
| Sharing | Password-protected episode links, revocable and optionally expiring; not merely unlisted URLs |
| Validation | A bounded PREBUILD stage precedes Foundation |
| Capacity baseline | Up to 2 hours, 4 participants and approximately 8 audio tracks; remote-participant support arrives later |
| Remote sessions | Optional live guest video with an audio-only mode; originals recorded locally |
| Invitations | Six-digit, single-use codes expire after 24 hours; separate credentials support rejoining/recovery |
| Video exports | Finished media first; Final Cut Pro, Premiere Pro and DaVinci Resolve project interchange in later, reviewed checkpoints |
| Short-video colours | Follow the show brand by default; retain presets and independent custom highlight/glow colours |
| AI | Configurable server-side remote transcription and LLM endpoints in a later stage |
| Mobile | Deferred until after the desktop/audio and video work |

The first release does not depend on transcription, AI suggestions, remote guests, the full public show site, embeds, video, editor-project interchange or the mobile host app. Its protected-listening page is a small Stage-06 feature, not the full Stage-09 site.

## 2. Architecture
```
podstudio/
  apps/
    web/          React Router v7 (framework mode) + Vite + React 19.2+ + TS
                  /studio/*  → studio app (client-rendered, auth required)
                  /{show}/*  → public site (server-rendered for SEO)
                  /share/*   → password-protected listening and authorized media access
                  /api/*     → JSON API (resource routes)
                  /feed/*    → RSS, /embed/*, /oembed, /embed.js
    worker/       Node job runner (SQLite jobs table): ffmpeg, Whisper, OP3 sync, podping, exports
  packages/
    ui/           shadcn/ui + audiocn + ElevenLabs UI components, theme (globals.css)
    db/           Drizzle ORM schema + migrations (SQLite via better-sqlite3)
    feed/         RSS 2.0 + iTunes + Podcasting 2.0 writer/parser/validator, GUID rules
    embed/        Standalone player (Preact, < 30 KB gz), built to /embed.js + /embed/[...]
    audio/        Versioned edit model, capture/recovery, shared DSP, LUFS and retake detector
    integrations/ OP3 client, Podcast Index client, S3 client, LiveKit token service, LLM/Whisper clients
  deploy/
    docker-compose.yml   caddy, web, worker, litestream (+ minio as needed; livekit in Stage 08)
    Caddyfile
```
- **Language:** TypeScript everywhere, with `strict` on. Package manager: pnpm workspaces + Turborepo.
- **Auth:** Better Auth email/password; server admin/editor roles plus per-show owner/editor membership. Email delivery is needed for invites, password resets and owner verification. OIDC is optional later polish. Guests redeem 24-hour, single-use codes for scoped session/recovery credentials rather than accounts.
- **Database:** one SQLite file on a local server volume (`/data/podstudio.db`), not a network filesystem. WAL, `busy_timeout=5000`, `foreign_keys=ON`, `synchronous=NORMAL`. Web and worker share the file; no media work inside write transactions. Episode/transcript search uses FTS5. Litestream replicates the database off-site; configuration, secret recovery and media protection also belong in the restore plan.
- **Jobs:** SQLite-backed claims using `BEGIN IMMEDIATE` and `UPDATE … RETURNING`; leases, heartbeats, abandoned-job recovery, idempotency keys, bounded concurrency, cancellation and backoff. Publishing/notifications use durable, deduplicated work. Do not hold a transaction during ffmpeg, API calls or uploads. No Redis or Postgres.
- **Future SaaS:** deferred. Reassess isolation, authentication, storage, jobs and SQL semantics before any migration; Drizzle does not make a database switch automatically mechanical.
- **Storage:** AWS S3 SDK v3 against S3-compatible storage, either a local MinIO service or an external provider. Confirm the actual target before Stage 02. Separate private raw/project assets from public feed media; backups must be independent of the home server. Storage routing is screen 17.
- **Media:**
  - ffmpeg in the worker for MP3/AAC encodes, loudness normalisation, video render with shots + branding slots, and 9:16 clips.
  - Later: configurable remote transcription and LLM endpoints, with adapters for provider capabilities. Never assume every Whisper-compatible endpoint supports word timings, diarization or streaming.
- **Realtime:** self-hosted single-node LiveKit for audio-first calls with optional live video. Local AudioWorklet PCM capture is the WAV-quality audio path. Camera recording/ingest is Stage 10a. The LiveKit stream is not the source master.
- **Home deployment:** document CPU/RAM/disk, OS, usable upload bandwidth, domain/DNS, public ingress and CGNAT status before validating capacity. Configure HTTPS and, before remote guests, LiveKit ICE/UDP/TCP and TURN reachability from outside the LAN. An HTTPS proxy alone does not carry all WebRTC traffic. Set worker limits from measured hardware; keep recording/upload responsive during renders.
- **Tests:** Vitest and Playwright; browser viewports test layout, not physical mobile recording or real-device background behaviour. Separate deterministic CI fixtures from long-session and real-device qualification runs.

### Recording and project contracts (decide in PREBUILD, implement early)
- Persist captured chunks in OPFS or IndexedDB before treating them as locally saved. PREBUILD chooses the supported implementation/fallback using real browser results. Journal recording id, sequence, sample count, format, checksum and upload acknowledgement. Explicitly report quota/write failures.
- Upload idempotently, verify on the server, reconcile manifests after reopening, and retain local data until verified finalization. Recovery restores committed audio; it cannot recreate audio captured after a device/tab stopped. Measure the uncommitted tail and make gaps visible.
- Keep capture chunks separate from S3 multipart parts: 5 seconds of mono 48 kHz/24-bit PCM is about 720 KB, below the usual 5 MiB minimum non-final multipart part. Use independent objects or aggregate parts; never accumulate an entire session in RAM.
- Store actual input/context sample rates and channel counts. Use sample counts/monotonic timestamps, not upload timers, as the recording clock; resample explicitly when delivering 48 kHz WAV. An exported 24-bit container is not a promise of 24-bit microphone hardware resolution.
- Show **saved locally / uploading / server verified / needs recovery** separately from call quality. Finalize only after validating order, completeness and checksums; never silently concatenate across missing chunks.
- Own a versioned, non-destructive project document independent of waveform-playlist state. Use source sample positions and explicit rational/frame timebases for video. Include linked clips, track locks, ripple versus non-ripple edits, fades, undo/redo, autosave and revision conflict detection.
- Keep original-to-edited time mappings. Linked audio/video cuts preserve sync. Transcripts, chapters, captions, shots and renders reference a project revision and are remapped or marked stale after edits.
- PREBUILD benchmarks a 2-hour, 8-track project and records load/seek/interaction and memory budgets on the target machine/browser. Precomputed peaks alone do not reduce decoded-audio memory; select a bounded decode/cache/proxy strategy before committing to the timeline engine.

### Preview and render contract
- PREBUILD selects a shared DSP/render strategy and records the algorithms, versions, FX order and mappings for simplified controls (including compressor percentage). Browser and worker implementations are not interchangeable merely because parameters have the same names.
- The first release requires actual noise reduction, preview/bypass and export using the approved processing strategy. If it cannot meet quality/parity requirements, stop for review rather than shipping a cosmetic knob.
- Compare aligned, uncompressed PCM before delivery normalization/encoding: deterministic render fixtures must null below −60 dBFS RMS, with alignment and latency/tail rules recorded. For non-deterministic processing, agree a repeatable signal/quality acceptance test in PREBUILD instead of claiming a null match.
- Separately verify final delivery: −16 LUFS stereo / −19 LUFS mono within ±0.5 LU on suitable program material, and a proposed ≤ −1 dBTP ceiling checked after encoding. Very short/silent material must produce an explicit diagnostic rather than a false pass. Finalize DSP details and ceiling in PREBUILD.
- Video uses one versioned layout specification, pinned fonts and shared line-breaking/animation rules. Preview/export frame comparisons cover text wrapping, long labels, slot overflow and safe zones; a grid by itself does not guarantee that content fits.

## 3. Non-negotiables
1. **GUIDs** (see README "GUID rules"). Imported item/show identifier values are preserved exactly and immutable, together with original absent/true/false isPermaLink semantics. Retain source XML for evidence; XML escaping is not identifier normalization. New episodes get a UUID v4 at creation. Enforce UNIQUE(show_id, guid) and test import → export → identity diff.
2. **Design tokens:** use tokens in `globals.css` and validated per-show/per-clip CSS variables (including custom accents). Speaker colours stay fixed: host amber, guest teal, music violet. Tally red is for recording/destructive actions. No hardcoded theme hex values in components.
3. **No listener tracking:** public pages and players set no cookies or third-party trackers. OP3 is opt-in with its public-data notice; distinguish measured downloads from player events. Protected-listening routes may use a strictly necessary, scoped access session, never analytics cookies.
4. **Feed safety:** every feed change runs through `packages/feed` validation before publish. The feed URL never changes unless the user goes through 17b (Move podcast).
5. **Secrets server-side only:** OP3 token, Podcast Index key/secret, S3 keys, LLM keys and LiveKit secret never reach the browser.
6. **Accessibility:** keyboard shortcuts as listed in README. Every icon button has an `aria-label`. Contrast follows the tokens. Mobile touch targets are at least 44px.
7. **Publishing:** publish immutable renditions and atomically activate a validated feed revision only after required assets are ready. Failed jobs leave the previous valid feed live. Schedule in UTC with an explicit show timezone and restart catch-up; retries must not duplicate publication.
8. **Protected sharing:** password checks and authorization cover the page, media bytes/ranges and associated private artwork/transcripts. Keep private assets out of public buckets, RSS, search, sitemap, oEmbed and OP3. Revocation/password changes invalidate access; document the maximum lifetime of any issued media URL. Access cannot retract files already downloaded.
9. **Stage gates:** stop for Tyler's review after each stage or video substage. Marking the next stage current does not authorize starting it. PREBUILD failures are blockers, not completed checks.

## 4. Data model (first pass; Drizzle, SQLite)
SQLite notes: store ids as text UUIDs, timestamps as integer unix ms, JSON as text (with `json_extract` where needed), booleans as integer 0/1. Enforce immutability of episode `guid`, `guid_is_permalink`, `public_id` and show `podcast_guid` with `BEFORE UPDATE` triggers as well as app code; nullable imported attributes require NULL-safe comparisons. Add foreign keys/uniqueness/check constraints during schema design. Introduce later-feature tables in their stages, not all in Foundation.
```
users(id, email, email_verified_at, name, role[admin|editor], …)
auth_*  -- Better Auth sessions/accounts/verifications per the pinned adapter schema
shows(id, slug, title, podcast_guid UNIQUE IMMUTABLE, feed_url, locked, unlocked_until,
      website, owner_email, timezone, settings json, theme json, short_style json, created_at)
show_members(show_id, user_id, role[owner|editor])
show_links(id, show_id, platform, value, visible, position)
people(id, show_id, name, role, avatar, website, socials json)             -- podcast:person
episodes(id, show_id, guid IMMUTABLE, guid_is_permalink IMMUTABLE, number, season, title,
         slug, public_id UNIQUE IMMUTABLE, status, visibility, description, explicit,
         publish_at, duration_s, has_video, branding json, created_at)    -- UNIQUE(show_id, guid)
episode_people(episode_id, person_id, role)
projects(id, episode_id, schema_version, current_revision_id)
project_revisions(id, project_id, parent_id, document json, time_map json, created_at)
-- Versioned document owns tracks/clips/links/FX/annotations; derived indexes are not a second authority.
assets(id, show_id, kind, access[private|public], storage_target_id, key, bytes, sha256,
       duration_s, sample_rate, channels, frame_rate_num, frame_rate_den, meta json)
recording_sessions(id, episode_id, status, started_at)
recording_participants(id, session_id, person_id, recovery_credential_hash, device json)
recordings(id, participant_id, kind[audio|video], sample_rate, channels, status, manifest json)
recording_chunks(id, recording_id, sequence, first_sample, sample_count, bytes, sha256,
                 asset_id, verified_at)                                -- UNIQUE(recording_id, sequence)
upload_sessions(id, asset_id, multipart_id, acknowledged_parts json, expires_at, status)
transcripts(id, episode_id, project_revision_id, vtt_asset_id, json_asset_id,
            words_asset_id, speaker_map json, language, stale, edited_at)
chapters(id, episode_id, project_revision_id, t_s, title, image_asset_id, url, stale)
soundbites(id, episode_id, project_revision_id, start_s, duration_s, title, stale)
clips_social(id, episode_id, project_revision_id, start_s, end_s, aspect, style json, render_asset_id)
renditions(id, episode_id, project_revision_id, asset_id, kind, settings json, verified_at)
feed_revisions(id, show_id, document_asset_id, validation json, activated_at)
publications(id, episode_id, rendition_id, feed_revision_id, scheduled_at, published_at, status)
protected_shares(id, episode_id, rendition_id, password_hash, expires_at, revoked_at, access_version)
share_sessions(id, share_id, token_hash, access_version, expires_at)
imports(id, show_id, source_url, source_feed_asset_id, inventory json, status)
feed_extensions(id, show_id, episode_id NULL, namespace, payload json)     -- preserve imported metadata
verification_challenges(id, user_id, show_id, purpose, code_hash, expires_at, attempts, used_at)
audit_events(id, actor_id, show_id, kind, data json, created_at)
outbox(id, kind, dedupe_key UNIQUE, payload json, delivered_at)
podroll_items(id, show_id, feed_guid, feed_url, title, author, artwork, note, position, verified_at)
templates(id, show_id, name, schema_version, tracks json, fx json, branding json)
storage_targets(id, provider, endpoint, bucket, region, key_ref, routes json)
redirects(id, show_id, new_feed_url, media_too, started_at, cancelled_at)  -- 17b
directory_pickups(id, redirect_id, app, last_seen_old_at, confirmed_at, evidence json)
analytics_daily(show_id, episode_id NULL, day, downloads, source[op3|local])
analytics_apps(show_id, period, app, share)
analytics_geo(show_id, period, country, share)
guest_codes(id, code_hash, episode_id, expires_at, used_at, revoked_at, attempts)
jobs(id, kind, dedupe_key, payload json, status, attempts, run_at, lease_owner,
     lease_expires_at, heartbeat_at, cancel_requested_at, result json, error)
search_fts  -- FTS5 over episode titles, show notes and transcripts
```

## 5. Build order and release gates
`STATUS.md` is the execution queue. Preserve stage numbers 00–14; PREBUILD is new and Stage 10 is an overview with separately gated substages 10a–10d. Do not execute the overview as one large stage.

| Stage | Deliverable |
|---|---|
| PREBUILD | Dependency compatibility, crash recovery, long-session performance and DSP/render proofs; record evidence and unresolved decisions |
| 00 | Deployable shell, durable worker skeleton, SQLite and initial off-site restore drill |
| 01 | Accounts, verified owner membership, shows, episodes and templates |
| 02 | Storage, durable upload manifests and private/public asset separation |
| 03 | Recoverable solo audio recording; annotation + recorded retake tone |
| 04 | Versioned multitrack editing, linked cuts, fades, autosave, retake cleanup and WAV |
| 05 | Required noise reduction, voice FX, loudness and MP3 delivery |
| 06 | Existing-show import, atomic feed publication, scheduling, owner verification and password-protected listening |
| **Release 1** | **End-to-end solo audio review after Stage 06; use [RELEASE-01.md](stages/RELEASE-01.md)** |
| 07 | Remote transcription/LLM adapters, word timing, revision-aware transcript and AI help |
| 08 | Remote audio and optional live video, 24-hour invites, persistent guest recovery and drift correction |
| 09 | Public SSR site, brand theme and lightweight embeds |
| 10a | Local camera capture/import, proxies, A/V sync, linked cuts and basic finished MP4 export |
| 10b | Shot switching, transitions, shared branding layout and finished video export |
| 10c | Clips, captions, audiograms, custom colours and safe-zone-aware placement |
| 10d | Later editor-project interchange for Final Cut Pro, Premiere Pro and Resolve; one editor per review checkpoint |
| 11 | OP3 analytics, podroll and evidence-based migration status |
| 12 | Deferred mobile host PWA; explicit capability review before implementation |
| 13 | Voice-following prompter, optional OIDC and polish |
| 14 | Expanded operational hardening, full restore drill, portable export and updates |

Each implementation stage leaves the existing app deployable, passes relevant checks and adds a CHANGELOG entry. Stage-00 visual acceptance is the shell only, not all later placeholder screens. Release 1 requires a full record → interruption/recovery → edit → export → publish demo, an imported-feed identity diff, a protected-access check and a restore exercise on the configured home-server deployment.

For feed moves, keep at least 30 days of redirect service (90 recommended), validate destination identity/inventory and coordinate destination metadata. User-agent silence is **not** proof of migration. Show last-observed/unknown status and record affirmative evidence separately. Disabling a redirect restores the origin response but cannot reliably reverse clients' cached 301s.

## 6. Conventions
- One feature folder per screen group under `apps/web/app/routes/studio/*`. Server logic lives in `*.server.ts`.
- Keep components small and colocated. Shared ones go in `packages/ui`. Never fork shadcn primitives; wrap them instead.
- Validate every API input with Zod, and return typed errors.
- Use feature flags for OP3, Podcast Index, public page, embeds and video, all off by default per show.
- Fixtures: use the mockup data (The Mic Drop, Alex Rivera, Dana Ruiz, Ep. 38–43) for seeds and Playwright.
- When a screen is done, compare it side by side with the mockup at 1440×900 and 390×844. Spacing, type and copy should match.
- Apply the confirmed behaviour overrides in README when comparing with older mockup copy. No mobile recording qualification is required for Release 1.
- Use stable `/{show}/episodes/{public-id}/{slug}` URLs; the immutable public id is the lookup key, and the slug is descriptive. Episode numbers are metadata, not identity. Reserve infrastructure route names against show-slug collisions.

## 7. Remaining implementation confirmations
These are not reversals of the confirmed decisions above. Record answers/evidence at the indicated gate.
- PREBUILD: home-server CPU/RAM/disk/OS and network/CGNAT/domain details, supported desktop browsers and measured performance budgets.
- PREBUILD: exact dependency pins, Base UI/shadcn integration, recording persistence/fallback, noise-reduction algorithm, DSP order/control mappings and preview/render strategy.
- Before Stage 00: independent off-site backup target and recoverable configuration/secret handling. Before Stage 01: email delivery. Before Stage 02: S3-compatible primary target.
- Before Stage 06: existing feed URL and source inventory; explicitly review missing/duplicate item GUIDs, absent show GUID and any non-MP3 archival media before cutover. No silent identity fixes or historical-media replacement.
- Before Stage 07/13: remote provider/model choices and actual endpoint word-timing/streaming capabilities.
- Before Stage 10d: editor versions, interchange dialects, feature-loss rules and format checkpoint order. All three editors remain planned; none blocks initial finished-video delivery.
- Before Stage 12: mobile browser/device capability targets; reliable background/locked-screen recording has not been promised.

## 8. Upstream references checked during review
- waveform-playlist: https://github.com/naomiaro/waveform-playlist (v16 entry points and peers; package versions differ across the family).
- audiocn: https://audiocn.dev/docs/installation (React 19.2+, Base UI requirements); microphone block registry item is `@audiocn/mic-setup`.
- ElevenLabs transcript UI: https://ui.elevenlabs.io/docs/components/transcript-viewer (requires alignment adaptation and shared transport integration).
- Podcast show GUID: https://github.com/Podcastindex-org/podcast-namespace/blob/main/docs/tags/guid.md
- Feed migration: https://podcasters.apple.com/support/837-change-the-rss-feed-url
- Home-server realtime networking: https://docs.livekit.io/transport/self-hosting/ports-firewall/
