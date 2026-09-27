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

- **Checks:** `npm test` (232 unit and server tests), `npx astro check`,
  `npx svelte-check` and `npm run build`. All pass at `d6abc49`.
- **Browser tests:** `npm run build`, then `npm run test:browser` (about
  15 minutes). They run in real Chromium with a fake mic and check the files in
  each downloaded zip. They live in [`tests/browser/`](../tests/browser/README.md):
  - `run.mjs` starts the built server with empty data on `:4400`, runs each
    test and stops the server;
  - `steps.mjs` has the shared helpers. `resetSettings(page, change, {clear})`
    puts known settings on the server first. Settings are per account on the
    server, so without it one test's settings leak into the next.

## Known issues

- **`guest/sync` is flaky:** it sometimes reports "no measurable drift" and
  passes on a rerun. The test simulates drift; the app is fine.
- **Settings pages reload on first sync.** A settings page you haven't touched
  reloads when newer settings arrive from the server. That's harmless, but
  visible on a slow connection.
- **Left-over cleaned copies:** old `ns-*` copies stay in OPFS after the
  switch to `ns2-*`, and nothing clears them. A clean-up of unknown variants
  would free the space.
- **Mock data** is listed in [features.md → Known gaps](features.md#known-gaps).
  It covers transcripts, the package screen and the Domain checks.

## Svelte or Astro: the rule

Svelte is used where a screen holds a lot of connected state, and nowhere
else. It's 13 files (about 1,800 lines) against about 10,300 lines of Astro.

- **Why it's worth having:**
  - **It's cheap to load:** about 19 KB compressed, loaded only on the pages
    that use it.
  - **It doesn't change speed:** the audio work, which is where time goes, is
    plain TypeScript either way.
  - **It makes busy screens easier to write and change:** each piece of state
    is declared once and the screen follows it. The Export flow and the file
    picker would need many hand-written DOM updates in Astro, and missing one
    leaves a screen out of step.
- **Use Svelte** for:
  - screens with steps, live previews, pickers and sheets;
  - anything where one choice changes several parts of the screen.
- **Stay with Astro** for:
  - pages that are mostly static, such as the library, sign-in, setup and most
    settings sections;
  - server-rendered pages.
  - Don't convert a working Astro page just to convert it.
- **Next to move:** Mic check (`components/app/MicCheck.astro`) and Wrapping
  up (`pages/episodes/[id]/wrap.astro`).
  - Both are step flows written as Astro with a lot of hand-written update
    code. They reach the Svelte step tabs and player through
    `lib/step-shell.svelte.ts`.
  - Move each one the next time it needs real changes, following
    `ExportFlow.svelte`: the page loads the data and mounts one Svelte
    component that owns the steps.
  - Once both have moved, only Script import (`ImportDialog.astro`) still uses
    `step-shell`. Move it too, then delete `step-shell`.
  - The `data-*` hooks the browser tests use must stay the same. Run
    `npm run test:browser -- mic` (or `guest guest-sync` for Wrapping up)
    before and after.

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

1. **Run the browser tests in CI** (GitHub Actions: build, then
   `npm run test:browser`, with Chromium from Playwright and `PS_CHROME`).
2. **The lab VPS** ([roadmap](roadmap.md#next-stage-a-lab-environment-on-a-real-vps)):
   - install with `deploy/install.sh` on a real domain;
   - tag `v0.2.0` with a `CHANGELOG.md`;
   - test upgrades from each released schema, not only from an empty
     database;
   - make the server refuse to start on a database newer than it knows.
3. **Real devices:** the iPhone mic and background behaviour, and phones as
   guests over a real network.
4. **Mic check and Wrapping up in Svelte**, the next time either needs real
   changes (see [Svelte or Astro](#svelte-or-astro-the-rule)).
5. **Calibration** (mockup 1d, [roadmap](roadmap.md#calibration-step-flow-mockup-1d)).
   It needs a monitor path that Podstudio doesn't have yet.
6. **Small clean-ups:**
   - bring `development.md`'s stack and layout up to date (Svelte, `steps/`,
     `export-files.ts`, `user-settings.ts`);
   - clear stale OPFS noise variants.
