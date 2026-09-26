# Developing Podstudio

How the code is laid out, how to run it, and where each design screen lives.
Follow [ui-framework.md](ui-framework.md) for every screen (see also
`CLAUDE.md`).

## Commands

Needs Node 22.18 or later (Node 24 LTS on a server): the server runs its TypeScript directly and uses the built-in SQLite.

```sh
npm install
npm run dev        # https://localhost:4321 (self-signed certificate), with the server's API and live room
npm run dev:phone  # the same, reachable from phones and other computers on your network
npm run build      # type-check, then build the static site into dist/
npm start          # the production server (after npm run build): http on 127.0.0.1:4321, Caddy in front
npm run preview    # the production server over https with a self-signed certificate, on the network
npm test           # unit and server tests (accounts, 2FA, live sessions, audio, exports)
npm run reset-password -- tyler   # on the server: a new password for an account
npm run reset-2fa -- tyler        # on the server: turn two-factor off, to set it up again
```

Open `/screens` to see every screen, listed by its id from the design file. Links there with `?demo` show the design's example content; the "Try it live" list uses real recording.

## Stack

- **Astro 7** with the Node adapter: pages are built ahead of time, and `server/main.ts` serves them with the API. **node:sqlite** (built into Node 22.13+) for the database, **ws** for the live room: the only runtime dependencies besides Astro and Tailwind. Interactive parts are small vanilla TypeScript `<script>` modules, not framework islands.
- **Tailwind CSS 4** via `@tailwindcss/vite`. The design tokens are in `src/styles/global.css`.
- **UI framework:** every screen follows [docs/ui-framework.md](ui-framework.md) (tokens, components, type, writing); the full reference is `docs/design/Podstudio_UI_Framework.dc.html`.
- **Fonts:** the system sans and mono stacks for the app; the prompter's Atkinson Hyperlegible is self-hosted from `@fontsource`, so nothing loads from Google.

## Layout

```
server/
  main.ts                   npm start: the API and live room in front of Astro's pages (one Node process)
  api.ts                    the /api/ router; the same handler runs under npm run dev
  context.ts, config.ts     config from the environment, the database and live rooms, shared with Astro
  db.ts, migrations.ts      node:sqlite, WAL, numbered migrations
  live.ts, live-store.ts    sessions with a guest and a producer (docs/server-api.md), stored in SQLite
  http.ts                   JSON, size-limited and streamed bodies, cookies, rate limits
  accounts.ts, auth.ts      setup, sign-in, TOTP 2FA, recovery codes, trusted devices (node:crypto only)
  guard.ts                  which pages need an account (they're static files, so it runs in front of them)
  cli.ts                    reset-password, reset-2fa
  library.ts                episodes, scripts (versioned), show setup, pads, the sound library (media/)
  takes.ts                  host recordings uploaded as they're made (takes/<id>/seg-*.pcm + meta.json)
  testing.ts                test helper: the API on a random port, signed in
dev/server-plugin.ts        mounts server/api.ts in npm run dev
docs/server-api.md          the API for guests and producers
src/
  styles/global.css     design tokens (@theme), base styles, the eyebrow/meta utilities
  data/mock.ts          all mock content: episode, script, transcript, package, settings
  data/waveforms.ts     waveform bar heights taken from the design
  lib/api.ts, sync.ts   calls to the server; saves go to this browser first, then the server (unsent ones retried)
  lib/episode-page.ts   episode pages read their data from the server as they render (EpisodeData)
  lib/
    audio/capture.ts    mic capture: MediaRecorder PCM, or the AudioWorklet (public/worklets/recorder.js) on iOS; levels
    audio/webm-pcm.ts   reads the samples out of Chrome's PCM WebM as it arrives
    audio/meter.ts      meter scale, dBFS zones and what to tell the person at the mic
    audio/devices.ts    input choices: system default, devices, each input of an interface
    audio/wav.ts        16/24-bit WAV encoding, cue markers, tone
    audio/assemble.ts   the assembled edit: retakes, pauses, gaps, cough mutes; Audacity labels
    audio/mute.ts       silencing a cough in the edit, with a 10 ms fade each side
    audio/denoise*.ts   noise suppression: the fader, framing and resampling around DeepFilterNet3, its worker
    audio/takes.ts      track storage in OPFS (5 s segments, Web Lock crash detection), WAV assembly
    voice/match.ts      fuzzy alignment of heard words against the script
    voice/follow.ts     speech recognition wrapper: word, lost and found events; mute() for coughs
    prompter.ts         reading-line scroll + word highlight; the ?demo driver
    settings.ts         saved settings and prompter themes
    zip.ts              stored zip writer for multi-file downloads
    script-parser.ts    "## Heading" sections for script import
    markers.ts          marker names and counts ("3 retakes · 2 coughs · 1 ad-lib")
    room.ts             guests and producer: server API calls, the live room, the server-clock offset
    show.ts             per-episode show setup: solo or with a guest, script mode, producer
    upload.ts           sends a recording's 5 s segments to the server in order, with retries
    audio/align.ts      lines a guest's track up with the host's
    platform.ts         iPhone/iPad, Android, touch
    script-store.ts     the episode script every screen uses (the user's own or the example)
    states.ts           mock-state switching (?state=…) for multi-state screens
    mock-forms.ts       forms with data-next move to the next screen until the server exists
  layouts/              Base (browser gate), AppShell (top bar), Phone, Setup
  components/ui/        Button, Field, Select, Segmented, Switch, Checkbox, OtpInput, Callout, …
  components/app/       TopBar, ImportDialog, MicCheck, PreviewStates
  components/settings/  one component per settings section
  pages/                routes (below)
project/                the Claude Design handoff (HANDOFF.md, prototypes, archive)
chats/                  the design conversation
```

## Screens

| Design id | Route | Notes |
|---|---|---|
| 1a–1g, 2a–2b | `/episodes/142/recording` | Ready, recording, cough, retake, ad-lib, More, paused. `?demo&state=ready\|rec\|cough\|retake\|adlib\|more\|paused\|mic` shows each design state. |
| 1h | `/episodes/142/recording?demo&state=mic` | Warnings above the script |
| 1i | `/episodes/142/saved` | Session saved |
| 3a | `/settings/controls` | The controls and keys |
| — | `/signin`, `/signin/verify` | Sign-in and 2FA |
| — | `/setup/two-factor`, `/setup/domain` | First-run wizard (only the designed steps) |
| — | `/unsupported` | Firefox, Safari on the Mac, and iOS 16 or earlier |
| — | `/` | Library, with **Import script** |
| — | `/episodes/142/script` | Script editor |
| — | `/episodes/142/studio` | Format and scrolling mode, then Start session |
| — | `/episodes/142/mic-check` | Mic check before recording |
| — | `/episodes/142/sessions` | Recorded sessions |
| — | `/episodes/142/recovered` | After a crash |
| — | `/join` | Enter a 6-digit guest or producer code |
| 6a | `/guest` | The guest: green room, waiting, recording and upload |
| — | `/producer` | The producer: live script, session controls, the guest |
| — | `/episodes/142/wrap` | Waiting for the guest's track before export |
| 8b | `/episodes/142/session` | Export |
| 2d, 2e | `/episodes/142/transcribing`, `/episodes/142/package` | Transcript and episode package (mock data) |
| 7a | `/settings/<section>` | Nine sections, including About & credits. Domain & HTTPS has `?state=ok\|warn\|local`. |

In `npm run dev`, screens with several states show a small switcher in the bottom-right corner. It's not included in production builds.
