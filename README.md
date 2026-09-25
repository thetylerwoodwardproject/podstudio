# Podstudio

A free, self-hosted teleprompter and recorder for single-host podcasts. One person, one track, on a laptop or a phone: voice follow scrolls the script as you talk, and the recording is a lossless WAV with retakes, cough cuts, pauses and ad-libs as markers.

Every screen from the Claude Design handoff (`Single Host.dc.html`, screens 1a–1i, 2a–2b and 3a) is built with Astro and Tailwind. **Recording, voice follow and exports work in the browser now**; everything that needs the server (sign-in, 2FA, uploads, Whisper transcripts) still runs on mock data. Guests and multi-device recording are out of scope for now.

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

## Browsers

| Device | Browser | Voice follow | Recording |
|---|---|---|---|
| Laptop or desktop | Chrome, Edge, Arc (Chromium) | Chrome speech recognition | MediaRecorder PCM |
| Android phone | Chrome | Chrome speech recognition | MediaRecorder PCM |
| iPhone or iPad, iOS 17+ | Any (they're all WebKit) | Manual scroll by default; Siri voice follow is an opt-in experiment in More | AudioWorklet PCM |

Firefox and Safari on the Mac go to `/unsupported`. iOS 16 and earlier (or a WebKit without AudioWorklet or OPFS) get "Update iOS".

## What works now

- **Recording** (`/episodes/142/recording`, 1a–1g and 2a–2b): the script gets the whole width, and one control bar works the same on a phone and a laptop.
  - **Level meter**, always on, even before you start, so the ready screen doubles as a mic check. Same zones and numbers as the mic check: green below −18 dBFS (low), amber −18 to −6 (the target), red above −6 or when clipping. Click it for peak, RMS and each input.
  - **Cough** (hold the button, or hold **C**): marks a cut padded 150 ms each side. Recording keeps going, the script doesn't move, voice follow ignores what it hears, and the other buttons dim. Holding it for 2 s leaves a 2.3 s cut in the edit; the raw WAV stays whole.
  - **Retake** (button, **R**, or double-tap/double-click the script): a tone you hear but isn't recorded, a marker, and back to the start of the line.
  - **Ad-lib** (button or **A**): off-script talk that stays in the edit. Voice follow also marks one after about six words that aren't in the script, and ends it when it hears the script again. The script holds your place meanwhile.
  - **Undo** (**U** or ⌘Z) for 4 s after a retake, cough cut or ad-lib.
  - **More** (`···` or **M**): a bottom sheet on a phone, a popover on a laptop, with Pause (**P**; Resume counts down 3-2-1), text size 80–160 % (⌘+ ⌘−, saved per device), jump to section (**1–9** while it's open), the mic (changeable before you start), how much is saved, marker counts, the retake tone, and End session.
  - Tap or click a line to move there, drag or scroll to look around, **← →** or a page turner's PageUp/PageDown change lines.
  - The laptop shows markers on a thin timeline above the bar: amber retakes, grey cuts, blue ad-libs, red gaps.
- **Warnings** (1h), one at a time, the most serious first. None stop the recording.
  - **Mic stopped**: audio stops arriving while the clock runs on (an iPhone leaving the screen, the mic taken away). The gap is marked, not filled with silence: its length is measured from the samples that did arrive, and markers after it are moved back by that much when they're mapped onto the audio. **Resume recording** restarts the mic into the same file.
  - Clipping, a Bluetooth mic (call quality; tap to switch to the built-in mic before you start), battery at 20 % and 10 % (where the browser reports it), and less than 30 minutes of space left.
  - The screen stays awake while recording.
- **Session saved** (1i, `/episodes/142/saved`): length, markers, size and format, how long the assembled edit is, then Transcribe, Listen or Record another. Export is linked from there.
- **Lossless audio**: mono or stereo WAV at 16 or 24-bit, recorded through MediaRecorder PCM on the mic's own clock and at its own rate (nothing is resampled). Web Audio only drives the meters, because it runs on the output device's clock, and with an interface in and other speakers out Chrome dropped or repeated samples. Browser echo cancellation, noise suppression and auto gain are off. Audio is saved to the browser's private file system every 5 seconds.
- **Microphone choice** (Settings → Recording, the mic check, or More before you start): "System default" follows the computer's sound settings; anything else is used whatever the OS default is. In mono, input 1 is recorded unless you pick another input or "all inputs mixed" (averaged); in stereo, inputs 1 and 2 become left and right. A saved mic that's unplugged falls back to the system default and says so.
- **Levels**: Podstudio reads the interface's inputs itself instead of Chrome's mono downmix (which read a mic on Input 1 of a two-input interface 6 dB low). Checked with test tones: mic check, recording screen and WAV agree to 0.1 dB.
- **Mic check** (`/episodes/142/mic-check`): one meter in the traffic-light zones, a plain-language line saying what to turn, a 10-second test recording to play back, a line to read for voice follow, and the numbers under Advanced details. It can be switched off in Settings → Recording.
- **Crash recovery**: if the tab closes mid-session, the next visit to the studio, library or sessions page opens the recovered-session screen. At most the last 5 seconds are lost.
- **Your own script**: on the script page, **Import or paste** takes pasted text or a .txt/.md file (`## Heading` lines become sections). Every screen uses it, and lines can be edited in place.
- **Session export** (8b): the raw WAV with its markers embedded as cues, Audacity labels and a CSV, plus an optional assembled edit that keeps the last attempt of each line, always drops cough cuts, and cuts, keeps or splits at pauses.
- **Sessions list** (`/episodes/142/sessions`): play, open to export, download or delete.
- **Settings are saved**: recording format, mic, the mic-check toggle, scrolling mode, and the prompter font.

## Keys (laptop)

| Key | What it does |
|---|---|
| hold **C** | Cough cut |
| **R** | Retake the line |
| **A** | Start or end an ad-lib |
| **M** | More |
| **P** | Pause / resume (3-2-1) |
| **U**, ⌘Z | Undo the last retake, cut or ad-lib (within 4 s) |
| **← →**, PageUp/PageDown | Previous / next line |
| **1–9** | Jump to a section while More is open |
| ⌘+ ⌘− | Text size |
| Esc | Close More |

## Stack

- **Astro 7**, static output. Interactive parts are small vanilla TypeScript `<script>` modules, not framework islands.
- **Tailwind CSS 4** via `@tailwindcss/vite`. The design tokens are in `src/styles/global.css`.
- **Fonts** (Geist, Geist Mono, Atkinson Hyperlegible) are self-hosted from `@fontsource`, so nothing loads from Google.

## Layout

```
src/
  styles/global.css     design tokens (@theme), base styles, the eyebrow/meta utilities
  data/mock.ts          all mock content: episode, script, transcript, package, settings
  data/waveforms.ts     waveform bar heights taken from the design
  lib/
    audio/capture.ts    mic capture: MediaRecorder PCM, or the AudioWorklet (public/worklets/recorder.js) on iOS; levels
    audio/webm-pcm.ts   reads the samples out of Chrome's PCM WebM as it arrives
    audio/meter.ts      meter scale, dBFS zones and what to tell the person at the mic
    audio/devices.ts    input choices: system default, devices, each input of an interface
    audio/wav.ts        16/24-bit WAV encoding, cue markers, tone
    audio/assemble.ts   the assembled edit: retakes, cough cuts, pauses, gaps; Audacity labels
    audio/takes.ts      track storage in OPFS (5 s segments, Web Lock crash detection), WAV assembly
    voice/match.ts      fuzzy alignment of heard words against the script
    voice/follow.ts     speech recognition wrapper: word, lost and found events; mute() for coughs
    prompter.ts         reading-line scroll + word highlight; the ?demo driver
    settings.ts         saved settings and prompter themes
    zip.ts              stored zip writer for multi-file downloads
    script-parser.ts    "## Heading" sections for script import
    markers.ts          marker names and counts ("3 retakes · 2 cuts · 1 ad-lib")
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
| 8b | `/episodes/142/session` | Export |
| 2d, 2e | `/episodes/142/transcribing`, `/episodes/142/package` | Transcript and episode package (mock data) |
| 7a | `/settings/<section>` | Eight sections. Domain & HTTPS has `?state=ok\|warn\|local`. |

In `npm run dev`, screens with several states show a small switcher in the bottom-right corner. It's not included in production builds.

## Placeholders and gaps

- **Sessions live in this browser** until the server exists, so the design's "Saved to server" reads "Saved in this browser", and the Offline warning (uploads falling behind) isn't shown. Podstudio asks for persistent storage, but clearing the site's data deletes sessions. Download the ones you want to keep.
- **Server upload** (5 s segments to `PUT /api/sessions/:id/segments/:n`, approved in the handoff) is waiting for the server.
- **Voice follow uses Google's speech service** through Chrome, so it needs an internet connection. On an iPhone it uses Siri, off by default; if it errors or stops more than 3 times in a minute it turns itself off and says so.
- **iPhone**: the mic stops as soon as Safari leaves the screen, so expect the "Mic stopped" warning there. This needs testing on a real iPhone.
- **Needs the server:** sign-in and 2FA, uploads and opening a session from another device, Whisper transcripts, titles/chapters/soundbites. Those screens show mock data.
- **Zips** are limited to 4 GB.
- **Setup wizard:** the Server check, Admin account, OpenAI key and Done steps have no designs yet, so "Verify and continue" goes straight to the Domain step.
- **OpenDyslexic** is listed as a prompter font, but the font isn't bundled yet, so it falls back to Atkinson Hyperlegible.
- **Mock values:** model names, versions and the installer URL are placeholders.
- **Guests and multi-device** (remote guest tracks, phone as prompter, producer remote) were removed for now and will be revisited later.
