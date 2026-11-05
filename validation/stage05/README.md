# Stage 05 validation

Real-browser scripts against the deployed studio. They use `../editor/lib.mjs` (copy it next to them, with
`playwright-core` installed, as described in `../editor/README.md`) and an `epid.txt` throwaway episode
from `../editor/record-take.mjs`.

| Script | What it proves |
|---|---|
| `parity.mjs` + `parity-compare.test.ts` | The deployed preview FX (AudioWorklet in Chromium, OfflineAudioContext) vs the export's `FxChain` (Node) on the same fixture: residual must be < −60 dBFS. Last run: 287,488 / 288,000 samples bit-identical, −300 dBFS. Run `parity.mjs` (writes `apps/web/parity-browser.json`), then copy `parity-compare.test.ts` into `apps/web/app/lib/project/` and `npx vitest run` it; delete both afterwards. |
| `fx-ui.mjs` | FX popover from the track header (chain switches, compressor readout, EQ curve shows the filters, knob by keyboard, playback through the FX, per-control undo), the LUFS tab; MP3 128 stereo and 64 mono exports decoded with ffmpeg: format, bitrate, −16 / −19 LUFS ±0.5, true peak ≤ −1 dBTP. |
| `audiocn-screens.mjs` | Recorder live waveform (audiocn LiveWaveform) + retake tally, take player, studio Library previews, public inline player (audiocn AudioPlayer over the site-wide player). Plays Tyler's library item; changes nothing. |
| `../editor/stereo.mjs` | Stereo import → stereo source/peaks, L/R meters, pan, stereo export with different L/R content at −16 LUFS. |

## Review round (2026-11-02, Tyler's feedback)
Run against the live site, from the same folder as `lib.mjs` (copy `../editor/lib.mjs` here or run from the editor folder) with `epid.txt` from `../editor/record-take.mjs`:
- `review-fx-meters-embed.mjs` — FX popover size/accent/one-effect-at-a-time, stock audiocn meters, audiocn embed (single + playlist, CSP, embed.js resize + events), recorder mic setup.
- `review-waveform-public.mjs` — public list on audiocn TrackList, grid play buttons, editor screenshot (audiocn waveform bars).
- `review-one-editor.mjs` — no Advanced switch, right panel tabs, bigger knobs, podcast presets, per-track ducking in FX.

**Rewritten 2026-11-05** for the one-editor layout and re-run green against the live studio: `editor/lr.mjs`, `meters.mjs`, `layout.mjs` (was `simple.mjs`), `meter-centre.mjs` (was `center-simple.mjs`), `ducking-playback.mjs`, `fades-and-ducking.mjs`, `stereo.mjs`, `track-menus.mjs` and `stage05/fx-ui.mjs`. `editor/center.mjs` was removed (the master-meter column is gone).
- `recorder-live-waveform.mjs` — the recorder's live waveform scrolls left from the right edge (newest on the right), not out of the center (Tyler's screen recording, 2026-11-02).
- `embed-sandboxed.mjs` — the embed plays inside a sandboxed iframe (origin "null") and a plain one.
- `palette.mjs` — Brand & theme shows the six palette accents; a saved #BEFF00 reads as Lime; embed accents render.
- `public-player.mjs` — public inline (full), sticky (compact) and embed players in audiocn's AudioPlayer layouts; play, +30, speed, mute.
- `public-waveform-player.mjs` — redesigned public player: waveform.json (1,000 peaks, cached, 404 for non-public), waveform drawn inline/sticky/embed, click-to-seek lands where clicked.
