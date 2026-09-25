# Podstudio

A free, self-hosted, multi-device teleprompter for audio podcasts. Voice follow scrolls the script as you talk, and any signed-in device can be a prompter screen or a WAV recorder. Chrome-based browsers only.

Every screen from the Claude Design handoff is built with Astro and Tailwind. **Recording, voice follow and exports work in the browser now**; everything that needs the server (sign-in, 2FA, syncing across devices, remote guests, Whisper transcripts) still runs on mock data.

## Run it

Needs Node 22.12 or later.

```sh
npm install
npm run dev        # http://localhost:4321
npm run build      # type-check, then build the static site into dist/
npm run preview
npm test           # unit tests: WAV encoder, assembled edit, voice-follow matcher, zip writer
```

Open `/screens` to see every screen, listed by its id from the design file. Links there with `?demo` show the design's example content; the "Try it live" list uses real recording.

## What works now

- **Recording** (`/episodes/142/recording`): mono or stereo WAV at 16 or 24-bit, recorded losslessly through MediaRecorder (PCM) on the mic's own clock and at its own rate (44.1 or 48 kHz setting is used when the device matches; nothing is resampled). Web Audio only drives the meters: it runs on the output device's clock, and with an interface in and other speakers out Chrome dropped or repeated samples, which sounded like distortion. Browser echo cancellation, noise suppression and auto gain are turned off. Audio is saved to the browser's private file system every 5 seconds.
- **Microphone choice** (Settings → Recording, or the mic check): "System default" follows the computer's sound settings; anything else is used no matter what the OS default is. Recording, the meters and voice follow all use the same input. In mono, one input is recorded, input 1 unless you pick another ("MOTU M2 · Input 2"), or all inputs averaged ("all inputs mixed"; averaging, so a mono source that Chrome delivers as two identical channels isn't doubled into clipping); in stereo, inputs 1 and 2 become left and right (a one-input mic goes to both sides). A saved mic that's unplugged falls back to the system default and says so.
- **Levels**: Podstudio reads the interface's inputs itself instead of taking Chrome's mono downmix (which averaged them and read a mic on Input 1 of a two-input interface 6 dB low). The main meter is exactly what's recorded; CLIP also lights when any input feeding the recording clips at the converter. Checked with test tones: mic check, recording screen and WAV agree to 0.1 dB for every input choice.
- **Crash recovery**: if the tab closes mid-session, the next visit to the studio, library or sessions page opens the recovered-session screen (every speaker track together). At most the last 5 seconds are lost.
- **Mic check**: one column, kept simple: the mic, one meter with the **sweet spot** marked (speech peaking at −18 to −12 dBFS, green; amber to −2, red above), a plain-language line saying where you are and what to turn, the test recording, what voice follow heard (or what's wrong with it), and Start session. The checks and the numbers (peak / RMS, highest peak, per-input meters, what the browser opened) are under Advanced details; a 10-second **test recording** through the same path as a session, played back on the page with the file's own peak and any full-scale samples; the recorded level with a live peak / RMS readout in dBFS and the highest peak since Reset; one meter per input of an interface (to compare with its own meters, marking inputs that aren't recorded); what the browser actually opened (device, inputs, sample rate, and whether any of its voice processing is on); clipping, noise floor, free space, and what voice follow heard. Checked with a calibrated test tone: the mic check, the recording screen and the saved WAV read the same to 0.1 dB.
- **Wrapping up** (after Stop session): each speaker's track is listed as saved, on a shared mic, not recorded, or waiting for upload. Export opens once every track is in, or on purpose without the missing ones. Until the server takes uploads, a guest's WAV (any rate; other formats are decoded) can be added here and lines up with the session's start. The sessions list and export screen say when someone's track is still missing.
- **Recording sessions** (8a, the only recording mode): the whole script scrolls with the reader, word by word, on the recording screen. Every speaker records their own track for the whole session, on one clock: pick a mic on this computer for each speaker (same-room, several mics) or leave them as remote (needs the server). The speaker whose line it is shows as "Talking now". **R** marks a retake on every track (the beep isn't recorded) and rolls every screen back to the start of the line; **P** marks a pause while recording keeps running. **Ad-libs** (anyone going off script) don't move the reader: after about six words that aren't in the script, voice follow holds your place, marks an ad-lib, and picks up again when it hears script words in order. **A** (or the Ad-lib button) marks one by hand. Ad-libs stay in the edit and show as blue markers, Audacity labels and WAV cues. Click a line or use ← → to move the reader by hand; with Manual speed the prompter advances on its own. A "Heard:" line shows what voice follow is picking up.
- **Solo reads**: a script without `NAME:` lines (or with one speaker) records one track and hides all speaker labels and controls.
- **Your own script**: on the script page, **Import or paste** takes pasted text or a .txt/.md file (`NAME:` lines become speakers, `## Heading` lines become sections). Every screen uses it; lines can be edited in place. **Use example script** brings back the example episode.
- **Session export** (8b): each track's raw WAV with its markers embedded, plus Audacity labels and a CSV. An optional assembled edit keeps the last attempt of each line and makes the same cuts on every track, with pauses cut, kept (and marked), or split into separate files.
- **Sessions list** (`/episodes/142/sessions`): each session once, with all its speaker tracks, length, retakes and pauses. Play it, open it to export, download the raw WAVs, or delete it. Separate takes recorded by older versions still show here so you can download them.
- **Voice follow**: Chrome speech recognition, matched word by word against the script. It ignores ad-libs, shows "Lost your place" with tap-to-jump lines, and has **J** to jump to the last match. Manual mode scrolls at a set speed, with Space to pause and ↑ ↓ to change it.
- **Screens in the same browser stay in sync**: open the monitor (second display), the phone prompter or the producer remote in other tabs or windows and they follow the recording tab. The remote can pause, change lines and jump sections.
- **Settings are saved**: recording format, mic, the mic-check toggle, scrolling mode, and the prompter font, size, spacing, reading line, theme and mirror.

## Stack

- **Astro 7**, static output. Interactive parts are small vanilla TypeScript `<script>` modules, not framework islands.
- **Tailwind CSS 4** via `@tailwindcss/vite`. The design tokens are in `src/styles/global.css`.
- **Fonts** (Geist, Geist Mono, Atkinson Hyperlegible) are self-hosted from `@fontsource`, so nothing loads from Google.

## Layout

```
src/
  styles/global.css     design tokens (@theme), base styles, the eyebrow/meta utilities
  data/mock.ts          all mock content: episode, script, cast, transcript, package, settings
  data/waveforms.ts     waveform bar heights taken from the design
  lib/
    audio/capture.ts    mic capture (AudioWorklet in public/worklets/recorder.js), levels
    audio/devices.ts    input choices: system default, devices, each input of an interface
    audio/wav.ts        16/24-bit WAV encoding, cue markers, tone
    audio/assemble.ts   continuous sessions: assembled edit, pause handling, Audacity labels
    audio/takes.ts      track storage in OPFS (5 s segments, Web Lock crash detection), WAV assembly
    voice/match.ts      fuzzy alignment of heard words against the script
    voice/follow.ts     Chrome speech recognition wrapper: word, lost and found events
    prompter.ts         reading-line scroll + word highlight; the ?demo driver
    prompter-live.ts    runs a prompter screen: follow the recorder, own voice follow, or manual
    session.ts          screen-to-screen messages (BroadcastChannel now, WebSocket later)
    settings.ts         saved settings and prompter themes
    zip.ts              stored zip writer for multi-file downloads
    speakers.ts         speaker color presets, custom colors, contrast check, persistence
    script-parser.ts    "NAME:" speakers and "## Heading" sections for script import
    script-store.ts     the episode script every screen uses (the user's own or the example)
    states.ts           mock-state switching (?state=…) for multi-state screens
    mock-forms.ts       forms with data-next move to the next screen until the server exists
  layouts/              Base (browser gate, colors), AppShell (top bar), Phone, Setup
  components/ui/        Button, Field, Select, Segmented, Switch, Checkbox, OtpInput, Callout, …
  components/app/       TopBar, CastPanel, ImportDialog, MicCheck, PreviewStates, JoinCode
  components/settings/  one component per settings section
  pages/                routes (below)
project/                the Claude Design handoff (HANDOFF.md, prototypes, archive)
chats/                  the design conversation
```

## Screens

| Design id | Route | Notes |
|---|---|---|
| 1a | `/signin` | |
| 2b | `/signin/verify` | 2FA code, phone layout |
| 2a, 5j | `/setup/two-factor`, `/setup/domain` | First-run wizard. Only the steps the design covers are built. |
| 1h | `/unsupported` | Non-Chromium browsers are sent here automatically |
| 5a, 5b | `/` | Library. **Import script** opens the import dialog, which parses pasted text and .txt/.md files. |
| 3a | `/episodes/142/script` | Cast colors are saved and recolor every screen |
| 1b | `/join` | Phone |
| 1c | `/episodes/142/studio` | Pick recorder, format and scrolling mode. The ⋯ menu links to the other episode screens. |
| 7c | `/episodes/142/mic-check`, `/invite/8f2k-q7mz` | Host and remote-guest versions |
| 7d | `/episodes/142/prompter` | Phone prompter. `?demo&state=read\|lost\|off\|up` shows the design states. |
| 1e | `/episodes/142/monitor` | Mirrored by default; press **M** to toggle |
| 5i | `/episodes/142/remote` | Producer remote |
| — | `/episodes/142/sessions` | Recorded sessions |
| 5f | `/episodes/142/recovered` | |
| 8a | `/episodes/142/recording` | One track per speaker; R retake, P pause |
| 8b | `/episodes/142/session` | Export after a session |
| 2d | `/episodes/142/transcribing` | Simulated progress, then opens the package |
| 2e | `/episodes/142/package` | Tabs, editable chapter/soundbite titles with live 45/128 counters |
| 3c | `/episodes/142/transcript` | Speaker review with "Who said this?" |
| 7a | `/settings/<section>` | Nine sections. Domain & HTTPS has `?state=ok\|warn\|local`. |

In `npm run dev`, screens with several states show a small switcher in the bottom-right corner. It's not included in production builds.

## Placeholders and gaps

- **Sessions live in this browser** until the server exists. Podstudio asks Chrome for persistent storage, but clearing the site's data deletes them. Download sessions you want to keep.
- **Voice follow uses Google's speech service** through Chrome, so it needs an internet connection. How well it keeps up is worth testing with real scripts.
- **Tracks from separate mics** start together but run on separate audio clocks, so very long sessions can drift by a few milliseconds; the server's clock alignment will correct this.
- **Sync is same-browser only.** Phones and other computers need the server's WebSocket, which will carry the same messages as `lib/session.ts`.
- **Needs the server:** sign-in and 2FA, remote guest tracks and uploads, Whisper transcripts, titles/chapters/soundbites, and the transcript, chapter and soundbite exports. Those screens still show mock data.
- **Zips** are limited to 4 GB.
- **Setup wizard:** the Server check, Admin account, OpenAI key and Done steps have no designs yet, so "Verify and continue" goes straight to the Domain step.
- **OpenDyslexic** is listed as a prompter font, but the font isn't bundled yet, so it falls back to Atkinson Hyperlegible.
- **Mock values:** model names, versions, the installer URL and the QR code are all placeholders, as noted in the design chat.
- **Superseded screens:** the ones the design faded out (1d, 1f, 1g, 2c, 3b, 4a–4c, 5c, 5e, 5g, 5h, 5k–5o, 6a, 6c, 6d) were not built. The merged turn-7 screens replace them.
