# Browser tests

End-to-end tests in real Chromium (Playwright). They record from a fake mic,
click through the screens, download the zip and check the files in it.

```sh
npm run build                          # the server serves dist/, so build what you want to test
npm run test:browser                   # all of them, about 15 minutes
npm run test:browser -- flow publish   # some of them, by name
```

- **The runner** (`run.mjs`) starts the built server with empty data on
  `https://localhost:4400`, runs the tests one after another, and stops it.
  - The first test makes the account (with 2FA). `auth.mjs` signs every new
    browser context in and resets Ep. 142 to how it ships.
  - A single test can run on its own with `node tests/browser/flow.test.mjs`
    while a server is up on `:4400`.
- **Where things go:** logs, downloads and screenshots go to
  `tests/browser/.out/` (not in git). The logs are in `.out/logs/`, one per test
  plus the server's.
- **Needs:** Node 22.18+, `python3` (the `tools/` scripts measure the WAVs
  independently of the app), and Chromium. The runner uses
  `/opt/pw-browsers/chromium-1194` when it's there; otherwise set `PS_CHROME`
  to a Chromium binary.
- **Settings are per account on the server**, so one test's settings carry into
  the next. Start a test with `resetSettings(page, change, { clear })` from
  `steps.mjs` rather than editing `localStorage`.

## The tests

| Name | What it covers |
|---|---|
| `import` | Script import steps: paste, rename and reorder sections, review |
| `mic` | Mic check steps: input, level, test recording, noise |
| `saved` | Session saved, and the marker tones settings card |
| `flow` | The Export step flow: tabs, noise reaching the Tone and Loudness previews, the file picker, the zip, and the saved selection on the server |
| `publish` | Episode loudness (stereo, mono, off), MP3 and ID3, the levelled copies |
| `tones` | Marker tones in the export, with ducking |
| `pads` | The pad editor, pads while recording, the Pads track and rough mix |
| `ns` | Noise suppression in the export: the `_clean` copies and how much they remove |
| `ns-player` | The Original/Cleaned toggle on the sessions player |
| `solo` | A whole solo session: recording, retake, cough, ad-lib, then export (`node tests/browser/solo.test.mjs phone` for a phone) |
| `uploads` | Segments uploaded as they're recorded; the export is the whole recording |
| `guest` | Host, guest and producer: codes, green room, recording, wrap-up, the offset nudge, the export |
| `guest-sync` | A drifting guest clock, corrected at export; Broadcast WAV timecode. Sometimes reports "no measurable drift"; rerun it |

## Fixtures

- `fixtures/`:
  - `mono11.wav`: a 10 s mono test signal;
  - `voice-like.wav`: 40 s of voice-like sound;
  - `noisy-guest.wav`: 10.6 s of sound with noise under it (the noise suppression tests, and the guest's mic);
  - `sting.wav` and `bed.wav`: pad sounds.
- `voice-noisy.wav` (voice-like with a −42 dBFS hiss) is made from
  `voice-like.wav` by `tools/noisy.py` the first time it's needed.
