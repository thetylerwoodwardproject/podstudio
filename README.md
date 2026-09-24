# Podstudio

A free, self-hosted, multi-device teleprompter for audio podcasts. Voice follow scrolls the script as you talk, and any signed-in device can be a prompter screen or a WAV recorder. Chrome-based browsers only.

This is the **UI build**: every screen from the Claude Design handoff, built with Astro and Tailwind, running on mock data. There's no server yet, so sign-in, recording, sync and transcription are stubbed.

## Run it

Needs Node 22.12 or later.

```sh
npm install
npm run dev        # http://localhost:4321
npm run build      # type-check, then build the static site into dist/
npm run preview
```

Open `/screens` to see every screen, listed by its id from the design file.

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
    prompter.ts         reading-line scroll + word highlight; demo driver in place of speech recognition
    speakers.ts         speaker color presets, custom colors, contrast check, persistence
    script-parser.ts    "NAME:" speakers and "## Heading" sections for script import
    states.ts           mock-state switching (?state=…) for multi-state screens
    audio.ts            WAV size math
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
| 7d | `/episodes/142/prompter?state=read\|lost\|off\|up` | Phone prompter with the voice-follow demo |
| 1e | `/episodes/142/monitor` | Mirrored by default; press **M** to toggle |
| 5i | `/episodes/142/remote` | Producer remote |
| 5d | `/episodes/142/takes` | Punch-in; press **R** |
| 5f | `/episodes/142/recovered` | |
| 2d | `/episodes/142/transcribing` | Simulated progress, then opens the package |
| 2e | `/episodes/142/package` | Tabs, editable chapter/soundbite titles with live 45/128 counters |
| 3c | `/episodes/142/transcript` | Speaker review with "Who said this?" |
| 7b | `/episodes/142/export` | |
| 7a | `/settings/<section>` | Nine sections. Domain & HTTPS has `?state=ok\|warn\|local`. |

In `npm run dev`, screens with several states show a small switcher in the bottom-right corner. It's not included in production builds.

## Placeholders and gaps

- **Voice follow is simulated.** `lib/prompter.ts` advances one word every 330 ms. Chrome speech recognition should call `Prompter.setWord()` instead.
- **Stubbed server features:** WAV capture, WebSocket sync, chunked uploads, auth/2FA, Whisper and OpenAI calls. Buttons for these either go to the next screen in the flow or do nothing.
- **Setup wizard:** the Server check, Admin account, OpenAI key and Done steps have no designs yet, so "Verify and continue" goes straight to the Domain step.
- **OpenDyslexic** is listed as a prompter font, but the font isn't bundled yet, so the preview falls back to Atkinson Hyperlegible.
- **Mock values:** model names, versions, the installer URL and the QR code are all placeholders, as noted in the design chat.
- **Superseded screens:** the ones the design faded out (1d, 1f, 1g, 2c, 3b, 4a–4c, 5c, 5e, 5g, 5h, 5k–5o, 6a, 6c, 6d) were not built. The merged turn-7 screens replace them.
