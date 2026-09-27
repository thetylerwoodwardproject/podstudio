# Handoff: where Podstudio is, and what's next

Written 27 September 2026, at `d6abc49` on `main`. Read this first, then
[README.md](../README.md), [development.md](development.md) (commands and
layout), [features.md](features.md) (what each screen does) and
[ui-framework.md](ui-framework.md) (the rules every screen follows).

## Where it stands

Recording, voice follow, guests and producers, uploads, and export all work
end to end in this dev container. It hasn't run on a real server yet: that's
the next stage (see [Next steps](#next-steps)). Version `0.1.0`, schema 3
(three migrations).

**Recently landed**, newest first:

| Commit | What |
|---|---|
| `d6abc49` | **Export: pick the files that go in the zip.** A Choose files sheet with every file in four groups, each with a line saying what it is and its size; quick picks (Everything, To publish, For my DAW); "Use this selection every time" saves the *kinds* of file, so the selection carries across episodes, guests and split parts. |
| `50f0385` | **Steady noise suppression.** The flutter on EQ and compression came from DeepFilterNet's gain jumping frame to frame. `GainSmoother` (`lib/audio/denoise-core.ts`) holds the model's gain per frequency (instant rise, 80 ms fall). At 70 %: jitter 1.36 → 0.48 dB, speech loss 3.8 → 1.3 dB. Cleaned copies are cached as `ns2-*`, so old `ns-*` ones are made again. **Settings are kept on the server** (per account, migration 3) and follow you to any device; the chosen microphone stays per device. |
| `e714bc5` … `dd95765` | **The step flow** (design handoff in `design/step-flow/`): Export, Mic check, Wrapping up (with a guest offset nudge), Script import, Session saved and marker tones. Noise now comes before Tone, and each step's preview plays the chain up to that step. |

## Architecture pointers

- **One Node process** (`server/main.ts`): the API (`server/api.ts`) in front
  of Astro's built pages, SQLite through `node:sqlite`, and the live room over
  `ws`. Caddy terminates HTTPS in production (`deploy/`).
- **Database:** numbered migrations in `server/migrations.ts`. Only ever add
  one; never edit a released one.
- **Browser:** Astro pages. The newer screens are Svelte 5 (runes). Note that
  `development.md` still says "vanilla TypeScript, not framework islands";
  that's out of date.
  - **Step flow:** `components/steps/` (StepTabs, StepPlayer, StepPage,
    ToneStep, LoudnessGraph). Astro pages drive them through
    `lib/step-shell.svelte.ts`.
  - **Preview player:** `lib/audio/preview-player.ts` swaps A/B at the same
    playhead.
  - **Chain preview:** `lib/audio/chain-preview.ts` builds the preview stage by
    stage (Raw → Edit → Noise → Tone → Loudness), caching each stage.
- **Export:** `src/pages/episodes/[id]/session.astro` does the loading and
  writes the zip. `ExportFlow.svelte` is the steps and `ExportPicker.svelte`
  the file sheet.
  - `lib/export-files.ts` plans the files. Its one list drives both the picker
    and the zip, so the count on the button is always what's in the zip.
  - The file names have to match the zip writer's naming. A test checks that
    the default case gives exactly 11 files.
- **Noise suppression:** DeepFilterNet3 runs in a worker
  (`lib/audio/denoise.worker.ts`): resample to 48 kHz, the model, then
  `GainSmoother`, then resample back. Cleaned copies are cached in OPFS by
  `variantName`. Bump its prefix whenever the processing changes.
- **Settings:** `lib/settings.ts` is the store.
  - Every save goes to `localStorage` at once and is PUT to `/api/me/settings`
    400 ms later.
  - Every page pulls the settings on load (`syncSettings()` in `Base.astro`).
    If the server copy is newer it replaces the local one and fires
    `podstudio:settings`.
  - The key is `deviceId`, and it never leaves the device.

## Tests

- **In the repo:** `npm test` (232 unit and server tests), `npx astro check`,
  `npx svelte-check` and `npm run build`. All pass at `d6abc49`.
- **Browser tests (Playwright) are *not* in the repo.** They live in this
  session's scratchpad and are lost when the container goes.
  - They cover the whole product: `flow/e2e`, saved, mic and import; then
    publish, tones, pads, ns, `ns/player`, `e2e-solo`, uploads,
    `guest/e2e` and `guest/sync`.
  - They run against a test server on `:4400` over https (`srv.sh`, with
    `srv.sh fresh` to wipe its data).
  - Shared helpers are in `flow/steps.mjs`. `resetSettings(page, change,
    {clear})` puts known settings on the server before a test. Because
    settings are now per account on the server, one test's settings leak into
    the next unless it resets them.

  Moving them into the repo is the first next step.

## Known issues

- **`guest/sync` is flaky:** it sometimes reports "no measurable drift" and
  passes on a rerun. The test simulates drift; the app is fine.
- **Old test scripts:** `e2e-session.mjs`, `flow.mjs` and `testrec.mjs`
  (scratchpad) still use plain http:// and fail for that reason only.
- **Settings pages reload on first sync.** A settings page you haven't touched
  reloads when newer settings arrive from the server. That's harmless, but
  visible on a slow connection.
- **Left-over cleaned copies:** old `ns-*` copies stay in OPFS after the
  switch to `ns2-*`, and nothing clears them. A clean-up of unknown variants
  would free the space.
- **Mock data** is listed in [features.md → Known gaps](features.md#known-gaps).
  It covers transcripts, the package screen and the Domain checks.

## Deliberate departures from the design handoffs

- **Export page:** it's `session.astro`, not `package.astro`.
- **Fonts:** system fonts, not Geist (the UI framework says so).
- **Kept although the designs drop them:**
  - the Tone graph's voice curves and Match to target;
  - the loudness-over-time graph;
  - the full compressor controls, under More.
- **Export files:** the Episode file and MP3 switches left Settings → Recording.
  The zip now holds what the picker ticks, and a saved selection shows there as
  "Files in the zip".

## Next steps

1. **Put the browser tests in the repo**, for example as `tests/browser/` with
   an `npm run test:browser` that starts its own server. Paths are hard-coded
   to the scratchpad today.
2. **The lab VPS** ([roadmap](roadmap.md#next-stage-a-lab-environment-on-a-real-vps)):
   - install with `deploy/install.sh` on a real domain;
   - tag `v0.2.0` with a `CHANGELOG.md`;
   - test upgrades from each released schema, not only from an empty
     database;
   - make the server refuse to start on a database newer than it knows.
3. **Real devices:** the iPhone mic and background behaviour, and phones as
   guests over a real network.
4. **Calibration** (mockup 1d, [roadmap](roadmap.md#calibration-step-flow-mockup-1d)).
   It needs a monitor path that Podstudio doesn't have yet.
5. **Small clean-ups:**
   - bring `development.md`'s stack and layout up to date (Svelte, `steps/`,
     `export-files.ts`, `user-settings.ts`);
   - clear stale OPFS noise variants;
   - fix or delete the old http:// scripts.
