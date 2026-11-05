# Editor validation (Stage 04)

Real-browser checks against the deployed studio (headless Chromium, fake microphone). They run on the
server, against `https://studio.tylerwoodward.me`, and create/delete their own test episodes.

Setup (once): in a scratch directory, `npm i playwright-core`, copy these files there, and put the
Chromium from `~/.cache/ms-playwright` where `lib.mjs` expects it (it globs for it). Make the fake
microphones (`mic-test.wav`: continuous tone, `mic-speech.wav`: bursts with pauses; 48 kHz mono) and
test media in `./media/` (`tone-stereo.mp3`, `music.flac`, `sfx.m4a`, `notaudio.mp3`, `notes.txt` — made
with `ffmpeg -f lavfi -i sine=...`; see `import-audio.mjs` for the names it expects).

| Script | What it proves |
|---|---|
| `record-take.mjs` | records a ~25 s take with 3 retakes (run with `MIC=…/mic-speech.wav`); writes `epid.txt` |
| `edit-basics.mjs` | split / ripple delete / undo / redo / reload / gain+fades / trim drag / lock / mute / height / chapters (expects the 21 s tone take) |
| `drag-and-scroll.mjs` | a 100 px clip drag moves exactly 100 px; a click after scrolling 3000 px lands on the right sample; fast scrolling across tile re-centres never shows an undrawn gap |
| `fades-and-ducking.mjs` | drag the top corners to fade (exact, no jump); per-track ducking from the FX popover (rule targets just that track, pick-tracks mode, amount knob); export with fades + ducking matches an independent reference to −148 dBFS |
| `ducking-playback.mjs` | playback with a per-track ducking rule active advances without errors |
| `library.mjs` | Library page (upload music/SFX, rename, preview, bad files), add from the editor (twice = one source), in-use delete protection, episode delete leaves library audio, cleanup |
| `conflict.mjs` | two tabs: stale save → banner, keep-mine, load-newer, server rejects bad documents |
| `retake-cleanup.mjs` | proposals checked against bursts found independently in the WAV; nudge, audition, apply = one undo; original byte-identical |
| `export-wav.mjs` | WAV export 24/48 and 16/44.1: residual vs the edit definition, no tone left, sha256, auth, lease recovery, failure, delete |
| `import-audio.mjs` | uploads MP3/FLAC/M4A, decode vs an independent ffmpeg decode, bad files, drag and drop, undo, export with imported tracks |
| `track-menus.mjs` | add track (empty / from library), track colour (palette swatch, default, undo, waveform drawn in it), context menu, delete track (confirm, undo, last track refused), right-panel collapse, layout at 1024/1280 px |
| `range-loop.mjs` | Shift+drag / range tool / multi-track ranges, highlight only on selected tracks, Delete (gap on that track) vs Cut (ripple), gapless loop stays inside and wraps |
| `crossfade.mjs` | dragging a clip over its neighbour saves a crossfade; drags stop at the last valid overlap; undo; Delete vs Shift+Delete |
| `meters.mjs` | track meters + the transport's master dBFS ⇄ LUFS meter (click to switch, remembered), integrated reading after a full playback agrees with the LUFS tab, reset |
| `loud-export.mjs` | mono and stereo exports through the UI, measured with ffmpeg ebur128: −19 / −16 LUFS, ≤ −1 dBTP, channel count |
| `layout.mjs` | the one editor layout (library sidebar, tabbed right panel, no Advanced switch, ruler flags, header fader + meter, transport meter), drag a library item onto a track at the drop point |
| `fader.mjs` | track volume: keyboard, Home goes to the transport, −12 dB = −12.0 LU integrated over the same stretch, double-click reset, undo |
| `guard.mjs` | a take used by a project can't be deleted (Record screen asks first, then refuses with a reason; API 409) |
| `missing.mjs` | (read-only, against Tyler's project) missing-audio banner, playback continues |
| `make-2h.mjs` | (run inside the web container) creates a synthetic 2-hour recording in storage |
| `two-hour-eight-track.mjs` | 8 tracks × ~1,170 clips on it: peaks, load, redraw, seek, playback, edit latency, export timing (`EP= REC= ASSET=` env) |
| `export-only.mjs`, `compare-2h-export.js` | re-run the 2-hour export and compare the stored file with the source at six positions |

All scripts drive the **Advanced** editor unless they set `podstudio.editor.advanced` themselves (see `lib.mjs`). Exports are loudness-normalised, so parity checks compare against the reference × `summary.normalise.gainDb`.

Order matters: verified-but-unplaced imports are placed when the editor opens, so each script clears imports
and resets the project first (`lib.mjs`).

`lr.mjs` (L and R bars on the transport meter move; a mono mix reads the same on both) and `meter-centre.mjs` (transport meter fits its box and is centred top-bottom in dBFS and LUFS; leaves the existing project alone) were rewritten for the one-editor layout on 2026-11-05. `center.mjs` was dropped with the master-meter column.
