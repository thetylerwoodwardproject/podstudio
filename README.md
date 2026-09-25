# Podstudio

A free, self-hosted teleprompter and recorder for podcasts, audio only. Record solo, or with **one guest** and an optional **producer**: everyone talks on their usual call (Zoom, Teams…) and Podstudio records each person on their own device, losslessly, with the script kept in step. Voice follow scrolls the script as you talk, and the recording is a lossless WAV with retakes, coughs, pauses and ad-libs as markers.

Every screen from the Claude Design handoff (`Single Host.dc.html`, screens 1a–1i, 2a–2b and 3a) is built with Astro and Tailwind. **Recording, voice follow and exports work in the browser now.** Guests and producers connect through the Podstudio server; until it exists, `npm run dev` and `npm run preview` include a stand-in that speaks its API (`docs/server-api.md`). Sign-in, 2FA and Whisper transcripts still run on mock data.

## Run it

Needs Node 22.12 or later.

```sh
npm install
npm run dev        # https://localhost:4321 (self-signed certificate), with the dev relay for guests
npm run dev:phone  # the same, reachable from phones and other computers on your network
npm run build      # type-check, then build the static site into dist/
npm run preview    # serves dist/ over https with the dev relay
npm test           # unit tests: WAV encoder, assembled edit, voice-follow matcher, noise suppression, zip writer
```

Open `/screens` to see every screen, listed by its id from the design file. Links there with `?demo` show the design's example content; the "Try it live" list uses real recording.

## Browsers

| Device | Browser | Voice follow | Recording |
|---|---|---|---|
| Laptop or desktop | Chrome, Edge, Arc (Chromium) | Chrome speech recognition | MediaRecorder PCM |
| Android phone | Chrome | Chrome speech recognition | MediaRecorder PCM |
| iPhone or iPad, iOS 17+ | Any (they're all WebKit) | Manual scroll by default; Siri voice follow is an opt-in experiment in More | AudioWorklet PCM |

Firefox and Safari on the Mac go to `/unsupported`, and so does any page opened over plain `http://` from another device: browsers only allow the mic, recording storage and audio processing on `https://` or `localhost`. iPhones are judged on features, not the version in the user agent (Safari has reported iOS 18.6 since iOS 26); a WebKit without AudioWorklet or OPFS gets "Update iOS". The unsupported page has a **Details** panel listing exactly what's missing, with **Copy details**. Safari before 26 has no `createWritable()`, so recordings are written from a worker there (`lib/audio/opfs-write.worker.ts`).

**HTTPS is the default.** Podstudio always serves `https://`, with a self-signed certificate until the real server sets one up with Caddy or Nginx + Certbot. Each device shows a certificate warning the first time; accept it once. On a phone or a guest's computer, open the `https://` Network address that `npm run dev:phone` prints, on the same Wi-Fi.

## What works now

- **Recording** (`/episodes/142/recording`, 1a–1g and 2a–2b): the script gets the whole width, and one control bar works the same on a phone and a laptop.
  - **Level meter**, always on, even before you start, so the ready screen doubles as a mic check. Same zones and numbers as the mic check: green below −18 dBFS (low), amber −18 to −6 (the target), red above −6 or when clipping. Click it for peak, RMS and each input.
  - **Cough** (hold the button, or hold **C**): mutes your track in the edit for that moment, padded 150 ms each side, with a 10 ms fade in and out. Nothing is cut, so the edit keeps its length and every other track (a guest's, the pads) stays in sync and isn't touched. Recording keeps going, the script doesn't move, voice follow ignores what it hears, and the other buttons dim. The raw WAV stays whole.
  - **Retake** (button, **R**, or double-tap/double-click the script): a tone you hear but isn't recorded, a marker, and back to the start of the line.
  - **Ad-lib** (button or **A**): off-script talk that stays in the edit. Voice follow also marks one after about six words that aren't in the script, and ends it when it hears the script again. The script holds your place meanwhile.
  - **Undo** (**U** or ⌘Z) for 4 s after a retake, cough or ad-lib.
  - **More** (`···` or **M**): a bottom sheet on a phone, a popover on a laptop, with Pause (**P**; Resume counts down 3-2-1), text size 80–160 % (⌘+ ⌘−, saved per device), jump to section (**1–9** while it's open), the mic (changeable before you start), how much is saved, marker counts, the retake tone, and End session.
  - Tap or click a line to move there, drag or scroll to look around, **← →** or a page turner's PageUp/PageDown change lines.
  - The laptop shows markers on a thin timeline above the bar: amber retakes, grey coughs, blue ad-libs, red gaps, and pad presses in their colours.
- **Warnings** (1h), one at a time, the most serious first. None stop the recording.
  - **Mic stopped**: audio stops arriving while the clock runs on (an iPhone leaving the screen, the mic taken away). The gap is marked, not filled with silence: its length is measured from the samples that did arrive, and markers after it are moved back by that much when they're mapped onto the audio. **Resume recording** restarts the mic into the same file.
  - Clipping, a Bluetooth mic (call quality; tap to switch to the built-in mic before you start), battery at 20 % and 10 % (where the browser reports it), and less than 30 minutes of space left.
  - The screen stays awake while recording.
- **Session saved** (1i, `/episodes/142/saved`): length, markers, size and format, how long the assembled edit is, then Transcribe, Listen or Record another. Export is linked from there.
- **Voice follow keeps going**: after a network error it keeps reconnecting (waiting up to 30 s between tries), a failed start is retried, and a watchdog restarts recognition when the meter hears you talking but no words come back for 10 s (Chrome sometimes stalls silently). A ring next to REC shows its state (green listening, amber reconnecting, red stopped), More shows it with the restart count, and a warning with **Restart voice follow** appears if it stays down. Every restart, error and stall goes into the session's voice log: **Copy diagnostics** in More, and `…_voice-log.txt` in the export.
- **Marker tones** (export switch, set up in Settings → Recording): a short beep mixed into the full recording at each retake, and optionally coughs (yours only), ad-libs, pauses and mic stops, each at its own pitch. The tones are ducked under your voice (default 12 dB) with an adjustable attack (how fast they drop when you start talking, default 10 ms) and release (how fast they come back, default 150 ms). The edit stays clean, and only the moments around the tones are re-encoded.
- **Lossless audio**: mono or stereo WAV at 16 or 24-bit, recorded through MediaRecorder PCM on the mic's own clock and at its own rate (nothing is resampled). Web Audio only drives the meters, because it runs on the output device's clock, and with an interface in and other speakers out Chrome dropped or repeated samples. Browser echo cancellation, noise suppression and auto gain are off. Audio is saved to the browser's private file system every 5 seconds.
- **Microphone choice** (Settings → Recording, the mic check, or More before you start): "System default" follows the computer's sound settings; anything else is used whatever the OS default is. In mono, input 1 is recorded unless you pick another input or "all inputs mixed" (averaged); in stereo, inputs 1 and 2 become left and right. A saved mic that's unplugged falls back to the system default and says so.
- **Levels**: Podstudio reads the interface's inputs itself instead of Chrome's mono downmix (which read a mic on Input 1 of a two-input interface 6 dB low). Checked with test tones: mic check, recording screen and WAV agree to 0.1 dB.
- **Mic check** (`/episodes/142/mic-check`): one meter in the traffic-light zones, a plain-language line saying what to turn, a 10-second test recording to play back, a line to read for voice follow, and the numbers under Advanced details. It can be switched off in Settings → Recording.
- **Crash recovery**: if the tab closes mid-session, the next visit to the studio, library or sessions page opens the recovered-session screen. At most the last 5 seconds are lost.
- **Your own script**: on the script page, **Import or paste** takes pasted text or a .txt/.md file (`## Heading` lines become sections). Every screen uses it, and lines can be edited in place.
- **Session export** (8b): the raw WAV with its markers embedded as cues, Audacity labels and a CSV, plus an optional assembled edit that keeps the last attempt of each line, mutes coughs on the cougher's track, and cuts, keeps or splits at pauses.
- **Noise suppression**, like Waves NS1: one fader, adaptive, no noise print to capture. It uses [DeepFilterNet3](https://github.com/Rikorose/DeepFilterNet) (MIT/Apache), built to WebAssembly and served from `public/vendor/deepfilter`, so nothing leaves the browser. The fader sets how much the model may take away (halfway allows 20 dB; the top takes all it can), and your voice is left alone. The raw WAV is never changed: a cleaned copy is kept beside the recording and reused.
  - **Export**: the fader, **Preview 30 s** with an Original / Cleaned switch and an attenuation meter ("Background −24 dB"). With it on, the zip has both versions: the unprocessed WAV and edit, plus `_clean.wav` and `_edit_clean.wav`, cut the same way from the cleaned audio so the markers line up in both.
  - **Credits**: Settings → About & credits lists DeepFilterNet3 and everything else Podstudio ships, with licences.
  - **Listen** (Session saved and every card on the Sessions list): a **Noise suppression** switch. It plays a cleaned 12 s from where you are within a few seconds, cleans the whole session in the background, then carries on with it from the same moment. The cleaned copy is kept and shared with Export.
  - **Mic check**: after the test recording, **Hear it cleaned**, with a setting suggested from the room's noise floor (quieter than −60 dBFS: not needed; −60 to −45: 40 %; louder: 70 %). **Use this setting** makes it the export default, also in Settings → Recording.
  - Cost: about 19 MB downloaded once (the 11 MB engine, 2 MB gzipped, and the 8 MB model), then cached. It runs at 2–4× real time on a laptop, so a 30-minute episode takes around 10 minutes to clean, and longer on a phone. Once the server exists, it could run the native `deep-filter` binary instead, which is much faster.
  - `scripts/build-deepfilter.sh` rebuilds the engine from a pinned upstream commit.
- **Sessions list** (`/episodes/142/sessions`): play, open to export, download or delete.
- **Settings are saved**: recording format, mic, the mic-check toggle, scrolling mode, and the prompter font.

## With a guest and a producer

- **Set it up** in the studio's **Show** panel: Solo or **With a guest**, the script mode, and whether there's a **producer**. It's saved per episode. The panel shows two **6-digit codes** (guest and producer), with Copy link, New code and Revoke; revoking signs that person out.
- **Script modes**, chosen by the host:
  - **Speaker lines**: each line is the host's or the guest's (tap HOST/GUEST on the script page, or import a script with `NAME:` lines: the first name is the host, anyone else the guest). Each screen highlights its own lines, and on the guest's lines their own voice follow moves the reader.
  - **Host script, guest free**: the guest sees a recording light and their level, no script.
  - **Talking points**: bullets (the script page's Talking points tab). Everyone sees them; the host's ← →, a tap, or the producer moves the current one. No voice follow.
  - **Ad-lib**: no script; markers work as usual. On a laptop the host's screen becomes the **mixer view** (Mixer View 1b): a lane per person with the last 60 s of level coloured by zone, a segmented meter, the level in dB with HOT / IN TARGET / LOW / IDLE, and **talk time** ("Tyler 58% · Sam 42%") counted while recording. The guest's level comes from their page about twice a second. The bar's meter gives way to a line naming your mic, since the levels are in the lanes.
- **Joining** (`/join`): their name and the code (or a `/join?code=123456` link). Then they wait, like Zoom's waiting room, until **you let them in**: a card on your studio or recording screen says "Sam wants to join as your guest" with **Let in** and **Deny**. Nothing about the show reaches them before that, and a denied code-holder is shut out. A guest can check their mic while they wait.
  - **Guest** (`/guest`), on a laptop or phone (iPhone too): a green room (name, mic, level in the usual zones, "on the call with headphones"), then waiting for the host. When the session starts, their device records their mic losslessly and **uploads 5 s pieces as it goes**, retrying when the network drops. Cough (hold) on their screen mutes their own track in the edit for that moment; yours isn't touched. At the end: "All sent", and **Download my recording** as a backup. Only one guest can be connected at a time.
  - **Producer** (`/producer`), any browser, never asks for a mic: the live script (edit any line and everyone gets it), Start / Pause / End for everyone, Retake and Ad-lib, ← → and sections (no cough button: a cough is marked by whoever coughs), and the guest's level, upload progress and code.
- **The host's recording screen** is in charge: it records your track, shares the session state, and applies the producer's and guest's actions. A chip in the header shows the guest's level and uploads, with a warning if they stop recording or drop off.
- **Wrapping up** (`/episodes/142/wrap`): after End, it waits for the guest's last pieces, brings their track into this browser, then opens Export. If an upload failed, **Add the guest's file** takes the WAV they downloaded. **Export waits for the guest's track** wherever you open it from: the export page and the Sessions list both send you to the wrap-up until it's in, with "Export without them" as a deliberate, confirmed choice.
- **Export** has a raw WAV and an edit for each person, lined up: each track records when it started on the server's clock, so the guest's is padded or trimmed to match yours, and both edits get the same cuts, so they're the same length. Each person's coughs are muted in their own edit only. Noise suppression makes cleaned copies of both; marker tones go on your track only.
- **The server API** is in `docs/server-api.md`. `dev/relay.ts` implements it for testing (sessions in memory, tracks in `.podstudio-dev/`), and the real server replaces it without app changes.

## Hotkey pads

Nine sounds on the number keys: soundbites, clips, music and sound effects (Hotkey Pads 1a–1c, 2a–2b).

- **Set them up** in Settings → **Hotkey pads**, or **Edit** on the pads. There's a **show set** for every episode, and an episode can override single pads (shown with a dot). Drag to swap keys. Each pad has:
  - a sound: an upload (WAV, MP3, M4A or FLAC, converted to 48 kHz), a **soundbite** from the episode package or a **clip** (any range of a saved session), or anything already in the library;
  - a Syntax colour, **One-shot / Loop / Hold**, volume (−24 to +6 dB), fades, trim, and **duck under your voice** with its own amount.
  - The kind sets the defaults: music loops, ducks and fades out over 2 s; a sound effect plays once with no fade and no ducking; soundbites and clips play once with a 150 ms fade.
  - **Ducking** for every pad is set there too: attack (default 80 ms), release (default 400 ms) and the voice threshold.
- **On a laptop** (mouse, 1024 px or wider): a rail beside the script with the 3×3 grid, Stop all / Fade all, what's playing and time left, pads volume and ducking. The bar's meter gets a **PADS** row under MIC. **1–9** fire pads while you rehearse or record, not while paused, typing, or with More open (there 1–9 still jump to sections). **0** stops everything; **Shift+0** fades everything over 2 s.
- **On a phone or tablet**: a swipeable strip above the control bar. Tap a pad to fire it. Pull the strip up (or tap its handle) for all nine pads, laid out 1–9 like the rail. Firing a one-shot there, or swiping down, drops back to the strip.
- **What a press does**: a one-shot restarts, a loop fades out, a hold plays only while you hold it. Several can play at once. Pads play in your headphones only and never touch the mic. If the output looks like laptop speakers, the rail says so.
- **Recording**: every press is a marker ("Pad 3 · Four pallets bite") on the timeline, in the pad's colour. The export has a stereo **Pads track** the same length as your mic, rebuilt from the press log so each press lands exactly where it was fired, and ducked the same way you heard it. It also has a **Pads edit** with the same cuts as your mic edit. A cough mutes only the mic of whoever coughed; the Pads track is never muted. **Rough mix** (off by default) sums mic and pads with a limiter at −1 dBFS.
- **Script cues**: a line of only `[pad 3]` (or `[pad 3 · note]`) shows as a chip in the pad's colour and isn't read aloud. Cues never fire anything.
- Pads and their sounds are kept in this browser (OPFS `pads/`) until the server exists. Clearing a pad keeps its sound in the library.

## Keys (laptop)

| Key | What it does |
|---|---|
| hold **C** | Cough: mutes your mic in the edit while held |
| **R** | Retake the line |
| **A** | Start or end an ad-lib |
| **M** | More |
| **P** | Pause / resume (3-2-1) |
| **U**, ⌘Z | Undo the last retake, cough or ad-lib (within 4 s) |
| **← →**, PageUp/PageDown | Previous / next line |
| **1–9** | Fire a hotkey pad; jump to a section while More is open |
| **0**, Shift+**0** | Stop all pads / fade all pads over 2 s |
| ⌘+ ⌘− | Text size |
| Esc | Close More |

## Stack

- **Astro 7**, static output. Interactive parts are small vanilla TypeScript `<script>` modules, not framework islands.
- **Tailwind CSS 4** via `@tailwindcss/vite`. The design tokens are in `src/styles/global.css`.
- **Fonts** (Geist, Geist Mono, Atkinson Hyperlegible) are self-hosted from `@fontsource`, so nothing loads from Google.

## Layout

```
dev/
  relay.ts, relay-core.ts   stand-in for the Podstudio server (docs/server-api.md), in npm run dev / preview
  serve.ts                  npm run preview: dist/ over https, with the relay
docs/server-api.md          what the server needs to provide for guests and producers
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

## Placeholders and gaps

- **Sessions live in this browser** until the server exists, so the design's "Saved to server" reads "Saved in this browser", and the Offline warning (uploads falling behind) isn't shown. Podstudio asks for persistent storage, but clearing the site's data deletes sessions. Download the ones you want to keep.
- **Server upload** (5 s segments to `PUT /api/sessions/:id/segments/:n`, approved in the handoff) is waiting for the server.
- **Voice follow uses Google's speech service** through Chrome, so it needs an internet connection; if the connection drops it reconnects on its own. On an iPhone it uses Siri, off by default; if it errors or stops more than 3 times in a minute it turns itself off and says so.
- **iPhone**: the mic stops as soon as Safari leaves the screen, so expect the "Mic stopped" warning there. This needs testing on a real iPhone.
- **Needs the server:** sign-in and 2FA, Whisper transcripts, titles/chapters/soundbites (those screens show mock data), and a real home for guest sessions: the dev relay keeps sessions in memory, so restarting it forgets codes (the studio makes a new session).
- **Host tracks don't upload yet**: yours is saved in this browser. The same segment upload will send it to the server once it exists.
- **Zips** are limited to 4 GB.
- **Setup wizard:** the Server check, Admin account, OpenAI key and Done steps have no designs yet, so "Verify and continue" goes straight to the Domain step.
- **OpenDyslexic** is listed as a prompter font, but the font isn't bundled yet, so it falls back to Atkinson Hyperlegible.
- **Mock values:** model names, versions and the installer URL are placeholders.
- **Planned next** (designs in hand, not built yet): see `docs/roadmap.md`. It covers the mixer view on a phone (Mixer View 2a–2b) and riding a pad's level by pressing and sliding it (Hotkey Pads 2c).
- **One guest per session**, by design. Video isn't part of it: the call app carries video if you want it.
