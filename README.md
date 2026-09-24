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

- **Recording** (`/episodes/142/recording`): mono WAV at 16 or 24-bit and 44.1 or 48 kHz from an AudioWorklet, with browser echo cancellation, noise suppression and auto gain turned off. Audio is saved to the browser's private file system every 5 seconds.
- **Crash recovery**: if the tab closes mid-take, the next visit to the studio, library or takes page opens the recovered-take screen. At most the last 5 seconds are lost.
- **Mic check**: real input list, level meter, clipping, noise floor, free space, and what voice follow heard.
- **Continuous sessions** (8a, the default): the whole script scrolls with the reader, word by word, on the recording screen. Every speaker records their own track for the whole session, on one clock: pick a mic on this computer for each speaker (same-room, several mics) or leave them as remote (needs the server). The speaker whose line it is shows as "Talking now". **R** marks a retake on every track (the beep isn't recorded) and rolls every screen back to the start of the line; **P** marks a pause while recording keeps running. Click a line or use ← → to move the reader by hand; with Manual speed the prompter advances on its own. A "Heard:" line shows what voice follow is picking up.
- **Solo reads**: a script without `NAME:` lines (or with one speaker) records one track and hides all speaker labels and controls.
- **Your own script**: on the script page, **Import or paste** takes pasted text or a .txt/.md file (`NAME:` lines become speakers, `## Heading` lines become sections). Every screen uses it; lines can be edited in place. **Use example script** brings back the example episode.
- **Session export** (8b): each track's raw WAV with its markers embedded, plus Audacity labels and a CSV. An optional assembled edit keeps the last attempt of each line and makes the same cuts on every track, with pauses cut, kept (and marked), or split into separate files.
- **Takes mode** is still there as an option (the Takes / Continuous switch on the recording screen, or Mode in the studio).
- **Takes and punch-ins**: play, download or delete takes. **Record from here** (or **R**) starts a punch-in, and the prompter rolls back two lines.
- **Export**: separate WAVs, or one combined WAV per speaker with cue markers, the optional 1 kHz / −20 dBFS / 0.5 s tone, and a take list CSV. Several files download as one zip.
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
    audio/wav.ts        16/24-bit WAV encoding, cue markers, tone
    audio/assemble.ts   continuous sessions: assembled edit, pause handling, Audacity labels
    audio/takes.ts      take storage in OPFS (5 s segments, Web Lock crash detection), WAV assembly
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
| 6b | `/episodes/142/recording` | One track per speaker |
| 7d | `/episodes/142/prompter` | Phone prompter. `?demo&state=read\|lost\|off\|up` shows the design states. |
| 1e | `/episodes/142/monitor` | Mirrored by default; press **M** to toggle |
| 5i | `/episodes/142/remote` | Producer remote |
| 5d | `/episodes/142/takes` | Punch-in; press **R** |
| 5f | `/episodes/142/recovered` | |
| 8a | `/episodes/142/recording?mode=continuous` | Continuous mode; the Takes / Continuous switch is in the top bar |
| 8b | `/episodes/142/session` | Export after a continuous session |
| 2d | `/episodes/142/transcribing` | Simulated progress, then opens the package |
| 2e | `/episodes/142/package` | Tabs, editable chapter/soundbite titles with live 45/128 counters |
| 3c | `/episodes/142/transcript` | Speaker review with "Who said this?" |
| 7b | `/episodes/142/export` | |
| 7a | `/settings/<section>` | Nine sections. Domain & HTTPS has `?state=ok\|warn\|local`. |

In `npm run dev`, screens with several states show a small switcher in the bottom-right corner. It's not included in production builds.

## Placeholders and gaps

- **Takes live in this browser** until the server exists. Podstudio asks Chrome for persistent storage, but clearing the site's data deletes them. Download takes you want to keep.
- **Voice follow uses Google's speech service** through Chrome, so it needs an internet connection. How well it keeps up is worth testing with real scripts.
- **Tracks from separate mics** start together but run on separate audio clocks, so very long sessions can drift by a few milliseconds; the server's clock alignment will correct this.
- **Sync is same-browser only.** Phones and other computers need the server's WebSocket, which will carry the same messages as `lib/session.ts`.
- **Needs the server:** sign-in and 2FA, remote guest tracks and uploads, Whisper transcripts, titles/chapters/soundbites, and the transcript, chapter and soundbite exports. Those screens still show mock data.
- **Combined exports** need every take in the same format. Zips are limited to 4 GB.
- **Setup wizard:** the Server check, Admin account, OpenAI key and Done steps have no designs yet, so "Verify and continue" goes straight to the Domain step.
- **OpenDyslexic** is listed as a prompter font, but the font isn't bundled yet, so it falls back to Atkinson Hyperlegible.
- **Mock values:** model names, versions, the installer URL and the QR code are all placeholders, as noted in the design chat.
- **Superseded screens:** the ones the design faded out (1d, 1f, 1g, 2c, 3b, 4a–4c, 5c, 5e, 5g, 5h, 5k–5o, 6a, 6c, 6d) were not built. The merged turn-7 screens replace them.
