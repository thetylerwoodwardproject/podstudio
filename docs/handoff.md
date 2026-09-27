# Handoff: where Podstudio is, and what's next

Updated 27 September 2026 against `ed89995` on `main`. Read this first, then
[README.md](../README.md), [development.md](development.md) (commands and
layout), [features.md](features.md) (what each screen does) and
[ui-framework.md](ui-framework.md) (the rules every screen follows).

## Where it stands

Recording, voice follow, guests and producers, uploads, and export all work
end to end locally and in Linux CI. It hasn't run on a real server yet: that's
the next stage (see [Next steps](#next-steps)). Version `0.1.0`, schema 3
(three migrations).

**Recently landed**, newest first:

| Commit | What |
|---|---|
| `ed89995` | **Export completion.** Actual zip count and size, “Your export is ready”, Back to sessions, Download again (the same zip), and Adjust export settings. Keeps the finished measurements and sync report. Browser coverage includes failure and raw-only exports, focus, scrolling and phone layouts. |
| `722803e`, `e15794a` | **CI checks.** GitHub Actions runs unit/server tests, both type checks, the build and all 13 browser tests. Saves logs and screenshots for seven days. The upload test selects the raw WAV explicitly instead of relying on filesystem order. |
| `d6abc49` | **Export: pick the files that go in the zip.** A Choose files sheet with every file in four groups, each with a line saying what it is and its size; quick picks (Everything, To publish, For my DAW); "Use this selection every time" saves the *kinds* of file, so the selection carries across episodes, guests and split parts. |
| `50f0385` | **Steady noise suppression.** The flutter on EQ and compression came from DeepFilterNet's gain jumping frame to frame. `GainSmoother` (`lib/audio/denoise-core.ts`) holds the model's gain per frequency (instant rise, 80 ms fall). At 70 %: jitter 1.36 → 0.48 dB, speech loss 3.8 → 1.3 dB. Cleaned copies are cached as `ns2-*`, so old `ns-*` ones are made again. **Settings are kept on the server** (per account, migration 3) and follow you to any device; the chosen microphone stays per device. |
| `e714bc5` … `dd95765` | **The step flow** (design handoff in `design/step-flow/`): Export, Mic check, Wrapping up (with a guest offset nudge), Script import, Session saved and marker tones. Noise now comes before Tone, and each step's preview plays the chain up to that step. |

## Architecture pointers

- **One Node process** (`server/main.ts`): the API (`server/api.ts`) in front
  of Astro's built pages, SQLite through `node:sqlite`, and the live room over
  `ws`. Caddy terminates HTTPS in production (`deploy/`).
- **Database:** numbered migrations in `server/migrations.ts`. Only ever add
  one; never edit a released one.
- **Browser:** Astro pages with Svelte 5 (runes) for stateful panels. See
  [development.md](development.md) for the current stack and layout.
  - **Step flow:** `components/steps/` (StepTabs, StepPlayer, StepPage,
    ToneStep, LoudnessGraph). Export owns its flow in Svelte; Mic check,
    Wrapping up and Script import still use `lib/step-shell.svelte.ts`.
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
  - The microphone choice is `recording.deviceId`; that field never leaves
    the device. Recording and prompter settings sync; the recording screen’s
    separate `podstudio:text-size` zoom key also stays local.

## Tests

- **Checks:** `npm test` (232 unit and server tests), `npx astro check`,
  `npx svelte-check` and `npm run build`. All pass at `ed89995`, locally and in CI.
- **Browser tests:** `npm run build`, then `npm run test:browser` (about
  15 minutes). They run in real Chromium with a fake mic and check the files in
  each downloaded zip. They live in [`tests/browser/`](../tests/browser/README.md):
  - `run.mjs` starts the built server with empty data on `:4400`, runs each
    test and stops the server;
  - `steps.mjs` has the shared helpers. `resetSettings(page, change, {clear})`
    puts known settings on the server first. Settings are per account on the
    server, so without it one test's settings leak into the next.

The [CI workflow](../.github/workflows/checks.yml) also runs the full browser
suite on pushes and pull requests. It uses Playwright Chromium via `PS_CHROME`
and retains diagnostics for seven days, without automatic retries.

## Known issues

- **`guest-sync` has a known intermittent failure:** it can report “no
  measurable drift” for the simulated clock skew. Recent local and CI runs
  passed, but the test has not been made deterministic. Investigate failures
  using the logs; a passing rerun alone does not establish the cause.
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
else. Pages and layouts remain predominantly Astro.

**At a glance:**

- **Svelte, already:**
  - the Export flow, with the file picker and the Tone and Loudness steps;
  - the step tabs and bottom player;
  - the marker tones card and the Saved player.
- **Svelte, when next changed:**
  - Mic check, Wrapping up and Script import;
  - Recording, in pieces;
  - Guest, Producer and the pad editor.
- **Astro:**
  - Studio, Sessions, the script editor, and Settings → Recording and the other
    settings pages;
  - the library, sign-in, two-factor setup, Saved and the package screen;
  - the voice test page and `session.astro` (the shell around the Svelte Export
    flow).

Svelte is for screens where many things change at once while you use them.
Astro is for pages that mostly show things and save a form.

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
- **Then, each when it next needs real changes** (same rule, same checks):

  | Screen | Why | Browser tests |
  |---|---|---|
  | Recording (`pages/episodes/[id]/recording.astro`, about 1,600 lines of script) | The REC clock, saved indicator, ad-lib/cut pill, warnings, undo toast, pause countdown, More sheet, and guest and producer panels are all state shown in several places. **Move it in pieces** (warnings, header, More sheet first), never in one go. The prompter scroll, level meter and mic capture stay plain TypeScript that Svelte only hosts: they're timing-critical. | `solo pads tones uploads guest` |
  | Guest (`pages/guest.astro`) | States the host drives: green room, waiting, recording, uploading | `guest guest-sync` |
  | Producer (`pages/producer.astro`) | Live script position, session state, the guest and the controls, all from the live room | `guest guest-sync` |
  | Pad editor (`components/settings/Pads.astro`) | A list with a selected pad and its fields, plus show and episode overrides | `pads` |

  Studio, Sessions, the script editor and Settings → Recording have moderate
  state, so they stay Astro. Move one only when a change to it turns out hard
  to do cleanly as written. The signs:
  - one choice has to update several places on the screen;
  - labels and controls start showing things out of step because an update
    was missed;
  - the change adds new states, such as loading, empty, error or a new mode;
  - the change is a redesign, so most of the screen is being rewritten anyway.

  Small changes (wording, a field that only saves a value, a style fix) stay
  in Astro.
- **Leave as they are:**
  - `session.astro`: its screen is already Svelte, and its script loads data
    and writes the zip, which stays plain TypeScript;
  - Saved, two-factor setup, the library and sign-in: small or mostly static;
  - the package screen: still mock data;
  - `voice.astro`: a test page for voice follow.

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

1. **The lab VPS** ([roadmap](roadmap.md#next-stage-a-lab-environment-on-a-real-vps)):
   - install with `deploy/install.sh` on a real domain;
   - tag `v0.2.0` with a `CHANGELOG.md`;
   - test upgrades from each released schema, not only from an empty
     database;
   - make the server refuse to start on a database newer than it knows.
2. **Real devices:** the iPhone mic and background behaviour, and phones as
   guests over a real network.
3. **Screens to Svelte, as they next change:** Mic check and Wrapping up
   first, then Recording (in pieces), Guest, Producer and the pad editor (see
   [Svelte or Astro](#svelte-or-astro-the-rule)).
4. **Calibration** (mockup 1d, [roadmap](roadmap.md#calibration-step-flow-mockup-1d)).
   It needs a monitor path that Podstudio doesn't have yet.
5. **Small clean-ups:** clear stale OPFS noise variants and investigate the
   intermittent guest-sync test.
