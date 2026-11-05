# Build status

Claude Code: work only on the stage/review gate marked **current**. When its acceptance checks pass, mark it complete, mark the next one current, and **stop for Tyler's review**. A current marker is not permission to continue automatically. Release 1 is a review-only gate with its own checklist, not another feature-building stage.

Plan revised 2026-10-17 with Tyler's answers. **No implementation or technical-validation stage has passed.** Release 1 is the solo-audio workflow through Stage 06 on the home/local server. Stage 10 is an overview split into 10a–10d; each substage has a review stop.

**2026-10-17 evening, additional note:** a compressed app shell was built tonight (see CHANGELOG) — a running React Router v8/React 19.2/Tailwind v4/shadcn/audiocn monorepo with a seeded SQLite DB and a real, data-backed Episodes screen (02). This is evidence toward PREBUILD proof #1 (dependency/UI compatibility) only. It does **not** pass PREBUILD and does not start Stage 00 or 01 — those stages' actual acceptance checks (crash-recovery drills, 2-hour/8-track memory budget, DSP null-test, durable worker, CI, off-site restore) are untouched. PREBUILD stays **current**.

**2026-10-18, additional note:** three more real pieces landed (see CHANGELOG): real sign-in gating `/studio/*` (screen 01, Better Auth, single seeded admin — not Stage 01's full scope, no email flows), screen 11 (Episode details — edit/delete, real data), and screen 16 (Show tags — RSS/iTunes + a subset of Podcasting 2.0 tags). Still not a stage pass; PREBUILD stays **current**. The `users` table changed shape (now Better Auth's own, with a `role` field) — that migration baseline was reset rather than diffed, since only fixture data existed; the later `shows` column additions were a plain additive migration.

**2026-11-01, additional note:** Stage 04 was built ahead of PREBUILD closing (Tyler asked to start the editor). The editor, retake cleanup, audio upload and WAV export exist and were verified in a real browser against the deployed build, with a 2-hour/8-track measurement; see HANDOFF.md → "Editor (Stage 04)" for what is proven and the checklist items that are **not** met (no CI/lint/e2e task, preview-vs-export parity not measured through Web Audio, mockup layout differences, no PREBUILD budgets to judge the measurements against, own timeline instead of waveform-playlist). Per the rules above this stops here for review; Stage 05 has not been started and PREBUILD stays **current** until you say otherwise.

**2026-11-04:** Tyler **passed Stage 05** (noise reduction switched to DeepFilterNet after his review; downward expander and export-to-publish added). Stage 06 is next and has **not** been started.

**2026-11-02:** Tyler formally **passed Stage 04**, said **yes to stereo** music/SFX, and started **Stage 05**. PREBUILD's proofs remain open; its DSP decision (shared deterministic TypeScript DSP incl. a spectral noise reducer, same code in browser and worker) is made as part of Stage 05 and recorded there.

| Stage | Name | Status |
|---|---|---|
| [PREBUILD](stages/STAGE-PREBUILD.md) | Technical validation | **open** — proofs not run; Tyler chose to keep building stages (04 and 05 passed; 06 is next, waiting on Tyler's go). The DSP/noise-reduction choice is recorded in Stage 05's notes |
| [00](stages/STAGE-00.md) | Foundation | not started |
| [01](stages/STAGE-01.md) | Accounts, shows, episodes | not started |
| [02](stages/STAGE-02.md) | Storage | not started |
| [03](stages/STAGE-03.md) | Solo recording | not started |
| [04](stages/STAGE-04.md) | Core editor & retake cleanup | **passed — Tyler, 2026-11-02** (merged in PR #1; accepted with the gaps listed in HANDOFF: no lint/e2e/CI task, own timeline instead of waveform-playlist) |
| [05](stages/STAGE-05.md) | Noise reduction, voice FX, loudness & MP3 | **passed — Tyler, 2026-11-04** (PRs #3 and the DeepFilterNet/expander/publish follow-up). Accepted after his listening checks: noise reduction is DeepFilterNet (same wasm in browser and export, bit-identical), ducking, brand colors, MP3 exports, public player, recording. Open and accepted: lint/e2e/CI, PREBUILD performance budgets, stale browser scripts (HANDOFF) |
| [06](stages/STAGE-06.md) | Existing-show import, feed publish & protected sharing | **next — not started; waiting for Tyler's go** |
| [Release 1](stages/RELEASE-01.md) | Solo-audio release review (after 06) | not started |
| [06b](stages/STAGE-06b.md) | Host publishing (Buzzsprout, RSS.com, Transistor) | not started — core to the build; follows Release 1, before 07 |
| [07](stages/STAGE-07.md) | Transcripts & AI help | not started |
| [08](stages/STAGE-08.md) | Remote guests & optional live video | not started |
| [09](stages/STAGE-09.md) | Public site & embeds | not started |
| [10a](stages/STAGE-10a.md) | Camera ingest, sync & basic MP4 | not started |
| [10b](stages/STAGE-10b.md) | Shots, transitions & branding | not started |
| [10c](stages/STAGE-10c.md) | Clips, captions, audiograms & custom colours | not started |
| [10d](stages/STAGE-10d.md) | Later editor-project interchange (3 editors) | not started |
| [11](stages/STAGE-11.md) | Analytics, podroll, moving | not started |
| [12](stages/STAGE-12.md) | Mobile host app (deferred; capability review first) | not started |
| [13](stages/STAGE-13.md) | Voice-following prompter & polish | not started |
| [14](stages/STAGE-14.md) | Hardening | not started |

## Tonight's shell (not a passed stage)
- Repo scaffolded at `~/podstudio` per BUILD_PLAN §2 (pnpm + Turborepo; `apps/web`, `apps/worker` stub, `packages/db`; `packages/{ui,feed,audio,integrations}` are empty placeholder dirs, not yet packages).
- Real: `packages/db` Drizzle/SQLite schema (users, shows, people, episodes, episode_people — a subset of §4) + idempotent seed matching the mockup fixtures; screen 02 (Episodes) renders that seeded data with pagination/status badges/row actions.
- Real but a deliberate deviation from spec: the Episodes table is hand-built (checkbox/badge/pagination), not TanStack Table as README names — noted so it isn't mistaken for the real thing when 15/17/etc. need the same pattern.
- Placeholder: all other 35 screen ids have routes (so nav never 404s) rendering a shared stub component — zero feature logic.
- `apps/worker` is an explicit stub (DB heartbeat only) — none of Stage 00's durable-job-runner requirements (claims, leases, idempotency, backoff) are implemented.
- `deploy/docker-compose.yml` + `Caddyfile` target `studio.tylerwoodward.me` (internal DNS only, confirmed resolves to this host) using Caddy's internal CA — no public ACME, no Litestream (no off-site target chosen yet), no MinIO/S3, no LiveKit.
- Not done: recovery/perf/DSP proofs, CI, off-site restore drill, any auth.

## Outstanding inputs (not completed work)
- PREBUILD: home-server specifications/network, supported desktop browsers, measured performance budgets and shared capture/DSP implementation choices.
- Before 00: independent off-site backup target/configuration recovery. Before 01: email delivery. Before 02: primary S3-compatible target.
- Before 06: existing RSS URL and import/media inventory.
- Before 07: remote transcription/LLM providers and endpoint capabilities.
- Before 10d: editor versions, interchange dialects and per-editor checkpoint order.
