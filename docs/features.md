# Podstudio features

Everything Podstudio does today, in detail. For what's still mock data or
missing, see [Known gaps](#known-gaps); for what's next, [roadmap.md](roadmap.md).

- [Recording solo](#recording-solo)
- [With a guest and a producer](#with-a-guest-and-a-producer)
- [Keeping tracks in sync](#keeping-tracks-in-sync)
- [Exporting, step by step](#exporting-step-by-step)
- [Ready to publish](#ready-to-publish)
- [Hotkey pads](#hotkey-pads)
- [Keys (laptop)](#keys-laptop)
- [Browsers](#browsers)
- [Accounts and the server](#accounts-and-the-server)
- [Known gaps](#known-gaps)

## Recording solo

- **Recording** (`/episodes/142/recording`, 1a–1g and 2a–2b): the script gets the whole width, and one control bar works the same on a phone and a laptop.
  - **Level meter**, always on, even before you start, so the ready screen doubles as a mic check. Same zones and numbers as the mic check: green below −18 dBFS (low), amber −18 to −6 (the target), red above −6 or when clipping. Click it for peak, RMS and each input.
  - **Cough** (hold the button, or hold **C**): mutes your track in the edit for that moment, padded 150 ms each side, with a 10 ms fade in and out. Nothing is cut, so the edit keeps its length and every other track (a guest's, the pads) stays in sync and isn't touched. Recording keeps going, the script doesn't move, voice follow ignores what it hears, and the other buttons dim. The raw WAV stays whole.
  - **Retake** (button, **R**, or double-tap/double-click the script): a tone you hear but isn't recorded, a marker, and back to the start of the line.
  - **Ad-lib** (button or **A**): off-script talk that stays in the edit. Voice follow also marks one after about six words that aren't in the script, and ends it when it hears the script again. The script holds your place meanwhile.
  - **Undo** (**U** or ⌘Z) for 4 s after a retake, cough or ad-lib.
  - **More** (`···` or **M**): a bottom sheet on a phone, a popover on a laptop, with Pause (**P**; Resume counts down 3-2-1), text size 80–160 % (⌘+ ⌘−, saved per device), jump to section (**1–9** while it's open), the mic (changeable before you start), how much is saved, marker counts, the retake tone, and End session.
  - Tap or click a line to move there, drag or scroll to look around, **← →** or a page turner's PageUp/PageDown change lines.
  - **The meter** snaps up to each peak and falls 12 dB a second (like a broadcast peak meter), however often the device reports levels. A tick holds the highest peak of the last 1.5 s, which is the number beside it, so −12 dBFS sits mid-amber. If the system pauses the mic (iOS does for calls, Siri and other apps, and browsers keep audio off until you tap), a warning says so with a button to turn it back on. If a mic arrives with a silent input 1 and signal on another input, Podstudio switches to that input before you record, or warns if you're already recording. On iPhone and iPad it asks for a one-channel mic. **Copy diagnostics** in More includes the mic's settings, state and each input's level.
  - The laptop shows markers on a thin timeline above the bar: amber retakes, grey coughs, blue ad-libs, red gaps, and pad presses in their colours.
- **Warnings** (1h), one at a time, the most serious first. None stop the recording.
  - **Mic stopped**: audio stops arriving while the clock runs on (an iPhone leaving the screen, the mic taken away). The gap is marked, not filled with silence: its length is measured from the samples that did arrive, and markers after it are moved back by that much when they're mapped onto the audio. **Resume recording** restarts the mic into the same file.
  - Clipping, a Bluetooth mic (call quality; tap to switch to the built-in mic before you start), battery at 20 % and 10 % (where the browser reports it), and less than 30 minutes of space left.
  - The screen stays awake while recording.
- **Session saved** (`/episodes/142/saved`): length and markers, the raw WAV (size and format), how long the assembled edit is, and whether the server has it all; Transcribe and Record another. The bar at the bottom plays the whole recording, **Original / Cleaned**, with **Export** beside it. Cleaned is only a way of listening here; noise suppression is set for real in Export.
- **Voice follow keeps going**: after a network error it keeps reconnecting (waiting up to 30 s between tries), a failed start is retried, and a watchdog restarts recognition when the meter hears you talking but no words come back for 10 s (Chrome sometimes stalls silently). A ring next to REC shows its state (green listening, amber reconnecting, red stopped), More shows it with the restart count, and a warning with **Restart voice follow** appears if it stays down. Every restart, error and stall goes into the session's voice log: **Copy diagnostics** in More, and `…_voice-log.txt` in the export.
- **Marker tones** (export switch, set up in Settings → Recording): a short beep mixed into the full recording at each retake, and optionally coughs (yours only), ad-libs, pauses and mic stops, each at its own pitch. **Pitch** moves them all: Low (a retake at 600 Hz), 1 kHz, or High (1.6 kHz). They're ducked **under your voice** (default 12 dB); **More** has which markers beep, the tone level, and the attack (how fast they drop when you start talking, default 10 ms) and release (how fast they come back, default 150 ms). The card's player plays an 8 s sample retake **Without / With tone**, with the settings as they are. The edit stays clean, and only the moments around the tones are re-encoded.
- **Lossless audio**: mono or stereo WAV at 16 or 24-bit, recorded through MediaRecorder PCM on the mic's own clock and at its own rate (nothing is resampled). Web Audio only drives the meters, because it runs on the output device's clock, and with an interface in and other speakers out Chrome dropped or repeated samples. Browser echo cancellation, noise suppression and auto gain are off. Audio is saved to the browser's private file system every 5 seconds.
- **Microphone choice** (Settings → Recording, the mic check, or More before you start): "System default" follows the computer's sound settings; anything else is used whatever the OS default is. In mono, input 1 is recorded unless you pick another input or "all inputs mixed" (averaged); in stereo, inputs 1 and 2 become left and right. A saved mic that's unplugged falls back to the system default and says so.
- **Levels**: Podstudio reads the interface's inputs itself instead of Chrome's mono downmix (which read a mic on Input 1 of a two-input interface 6 dB low). Checked with test tones: mic check, recording screen and WAV agree to 0.1 dB.
- **Mic check** (`/episodes/142/mic-check`), four steps: **Input** (the mic, free space, and the numbers under Advanced details), **Level** (one meter in the traffic-light zones and a plain-language line saying what to turn), **Test** (a 10-second recording, and a line to read for voice follow) and **Noise** (below). The test plays in the bar at the bottom; **Start recording** is on the last step. It's a check, not a gate: every tab is open. It can be switched off in Settings → Recording.
- **Crash recovery**: if the tab closes mid-session, the next visit to the studio, library or sessions page opens the recovered-session screen. At most the last 5 seconds are lost.
- **Your own script**: on the script page, **Import or paste** opens three steps. **Paste**: pasted text or a .txt/.md file (`## Heading` lines become sections). **Sections**: each with its lines and read time at your prompter speed; click a name to rename it, drag the handle (or Alt+↑/↓) to reorder, and its lines move with it. **Review**: the script as it will read, then Import. The bar at the bottom sums it up ("4 sections · 64 lines · ~8:15 read time"). Full-screen on a phone. Every screen uses the script, and lines can be edited in place.
- **Session export** (8b): the raw WAV with its markers embedded as cues, Audacity labels and a CSV, plus an optional assembled edit that keeps the last attempt of each line, mutes coughs on the cougher's track, and cuts, keeps or splits at pauses.
- **Noise suppression**, like Waves NS1: one fader, adaptive, no noise print to capture. It uses [DeepFilterNet3](https://github.com/Rikorose/DeepFilterNet) (MIT/Apache), built to WebAssembly and served from `public/vendor/deepfilter`, so nothing leaves the browser. The fader sets how much the model may take away (halfway allows 20 dB; the top takes all it can), and your voice is left alone. The raw WAV is never changed: a cleaned copy is kept beside the recording and reused.
  - **Export** (step 02, Noise): the room's noise floor, measured in the quiet between lines, with a suggested setting ("Use 40 %"), the fader, and how far the background comes down ("Background −24 dB"). The preview plays **Original / Cleaned / Removed**; Removed is only what's being taken away, so you can hear whether it's eating into words. Tone and loudness come after it and are heard on the cleaned audio. With it on, the zip has both versions: the unprocessed WAV and edit, plus `_clean.wav` and `_edit_clean.wav`, cut the same way from the cleaned audio so the markers line up in both.
  - **Credits**: Settings → About & credits lists DeepFilterNet3 and everything else Podstudio ships, with licences.
  - **Listen** (Session saved's Cleaned, and the switch on every card on the Sessions list): it plays a cleaned 12 s from where you are within a few seconds, cleans the whole session in the background, then carries on with it from the same moment. The cleaned copy is kept and shared with Export.
  - **Mic check** (step 04, Noise): the noise floor of your test recording, a suggested setting (quieter than −60 dBFS: not needed; −60 to −45: 40 %; louder: 70 %) with **Use 40 %**, the fader and how far the background comes down. The test plays **Original / Cleaned / Removed**. The setting you pick is the export default, also in Settings → Recording.
  - Cost: about 19 MB downloaded once (the 11 MB engine, 2 MB gzipped, and the 8 MB model), then cached. It runs at 2–4× real time on a laptop, so a 30-minute episode takes around 10 minutes to clean, and longer on a phone. The server could run the native `deep-filter` binary instead, which is much faster (planned).
  - `scripts/build-deepfilter.sh` rebuilds the engine from a pinned upstream commit.
- **Sessions list** (`/episodes/142/sessions`): play, open to export, download or delete.
- **Settings are saved**: recording format, mic, the mic-check toggle, scrolling mode, and the prompter font.

## With a guest and a producer

- **Set it up** in the studio's **Show** panel: Solo or **With a guest**, the script mode, and whether there's a **producer**. It's saved per episode. The panel shows two **6-digit codes** (guest and producer), with Copy link, New code and Revoke; revoking signs that person out.
- **Script modes**, chosen by the host:
  - **Speaker lines**: each line is the host's or the guest's (tap HOST/GUEST on the script page, or import a script with `NAME:` lines: the first name is the host, anyone else the guest). Each screen highlights its own lines, and on the guest's lines their own voice follow moves the reader.
  - **Host script, guest free**: the guest sees a recording light and their level, no script.
  - **Talking points**: bullets (the script page's Talking points tab). Everyone sees them; the host's ← →, a tap, or the producer moves the current one. No voice follow.
  - **Ad-lib**: no script; markers work as usual. On a laptop the host's screen becomes the **mixer view** (Mixer View 1b): a lane per person with the last 60 s of level coloured by zone, a segmented meter, the level in dB with HOT / IN TARGET / LOW / IDLE, and **talk time** ("Tyler 58% · Sam 42%") counted while recording. The guest's level comes from their page about twice a second. The bar's meter gives way to a line naming your mic, since the levels are in the lanes. On a phone (Mixer View 2a–2b) the screen says "Just talk", and a **dock** above the control bar shows a thin meter and the dB for each person in place of the bar's meter. Tap it or drag its handle up for the full **strips**: a segmented meter per person with the 0 / −6 / −18 / −60 scale, the level and its zone (the guest's shows their uploads), and talk time. The control bar stays below it, so Cough and Retake still work; swipe down or tap above it to close.
- **Joining** (`/join`): their name and the code (or a `/join?code=123456` link). Then they wait, like Zoom's waiting room, until **you let them in**: a card on your studio or recording screen says "Sam wants to join as your guest" with **Let in** and **Deny**. Nothing about the show reaches them before that, and a denied code-holder is shut out. A guest can check their mic while they wait.
  - **Guest** (`/guest`), on a laptop or phone (iPhone too): a green room (name, mic, level in the usual zones, "on the call with headphones"), then waiting for the host. When the session starts, their device records their mic losslessly and **uploads 5 s pieces as it goes**, retrying when the network drops. Cough (hold) on their screen mutes their own track in the edit for that moment; yours isn't touched. At the end: "All sent", and **Download my recording** as a backup. Only one guest can be connected at a time.
  - **Producer** (`/producer`), any browser, never asks for a mic: the live script (edit any line and everyone gets it), Start / Pause / End for everyone, Retake and Ad-lib, ← → and sections (no cough button: a cough is marked by whoever coughs), and the guest's level, upload progress and code.
- **The host's recording screen** is in charge: it records your track, shares the session state, and applies the producer's and guest's actions. A chip in the header shows the guest's level and uploads, with a warning if they stop recording or drop off.
- **Wrapping up** (`/episodes/142/wrap`), three steps. **Uploads**: after End, it waits for the guest's last pieces and brings their track into this browser. **Line up**: both tracks' waveforms over 30 s from the middle, played **Host / Guest / Both**, and a **guest offset** to nudge them later or earlier in 5 ms steps (hold to repeat, up to ±500 ms). It says what lined them up (sync points, and how much drift was corrected, or start times), and the nudge goes on top, into every export and its report. **Review**, then Continue to export. If an upload failed, **Add the guest's file** takes the WAV they downloaded. **Export waits for the guest's track** wherever you open it from: the export page and the Sessions list both send you to the wrap-up until it's in, with "Export without them" as a deliberate, confirmed choice.
- **Export** has a raw WAV and an edit for each person, lined up on your timeline: the guest's is corrected for clock drift and gaps (see [Keeping tracks in sync](#keeping-tracks-in-sync)), and both edits get the same cuts, so they're the same length. Each person's coughs are muted in their own edit only. Noise suppression makes cleaned copies of both; marker tones go on your track only.
- **The server API** is in `docs/server-api.md`, implemented by `server/live.ts`. Sessions, codes and tokens are in SQLite, so restarting the server keeps them. Joining is limited to 20 tries per address per 10 minutes, so codes can't be guessed.

## Keeping tracks in sync

When you and a guest record on separate devices, the two recordings have to
line up in the edit, and stay lined up to the last minute. Podstudio does this
like cameras with timecode, with three things:

- **One clock for the session.** Every device in a session measures its offset
  from the server's clock (several quick pings when it joins, and again every
  minute). That's the session clock.
- **Sync points in every track.** While recording, each track notes every 5 s
  how many samples it has captured and the session-clock time they arrived.
  Audio arrives in chunks a little late, never early, so each 5 s keeps its
  least-late chunk. A 40-minute recording has about 480 of them; they travel
  with the guest's track to your browser.
- **Timecode in every file.** Each exported WAV has a Broadcast WAV (`bext`)
  start time on the session clock. Editors such as Pro Tools, Reaper, Logic,
  Cubase, Resolve and Premiere can line the files up by it on their own.
  Full-length files share one timecode; each edit starts at the timecode of
  its first kept moment, the same on every track.

  | Editor | Placing files at their timecode |
  |---|---|
  | Pro Tools | Spot mode, then the clip's **Original Time Stamp** |
  | Reaper | **Item: Move to media source preferred position (BWF start offset)** |
  | Logic Pro | **Move Region to Recorded Position** |
  | Cubase, Nuendo | **Move to Origin** |
  | DaVinci Resolve (Fairlight) | **Auto Sync Audio → Based on Timecode**, or the clip's source timecode |
  | Premiere Pro | **Synchronize → Timecode** |

  Menu names vary a little between versions. Audacity and GarageBand ignore
  the timestamp. You don't need timecode for a normal export anyway: every
  full-length file starts at the same moment and runs the same length, and
  every edit has the same cuts, so dropping them all at the start lines them
  up in any editor. Timecode helps when files have been trimmed or moved, or
  when you add audio from a camera or another recorder.

At export, Podstudio fits each device's clock from its sync points:

- **Drift.** No two audio devices run at exactly the same speed: a few tens
  of parts per million apart is normal, which is 50 to 100 ms over 40 minutes,
  enough to hear as an echo. The guest's track is corrected by slipping single
  samples (dropping or repeating one) at evenly spaced points, so it stays
  within a frame of true. Nothing is filtered or resampled, and the raw
  recordings in the browser are never changed.
- **Gaps.** If the guest's audio stopped for a while (a phone call, the mic
  taken away), that stretch comes out as silence in their track, so what
  follows still lines up. If *your* mic stopped, the guest's audio from that
  moment is left out, because your track has no time for it.
- **Only real drift.** A short recording, or a noisy one, doesn't have enough
  points to measure drift reliably, so it's lined up by its start only rather
  than "corrected" by guesswork. Drift counts only when it's clearly bigger
  than the timing jitter.

The zip has `…_export.txt` saying what was done ("Sam: 48 ms of drift corrected
(+60 ppm), 3.0 s of missing audio filled with silence"), and the export page
shows the same. Accuracy is set by the browser's timing, typically within 10
to 20 ms. Recordings made before sync points existed are lined up by their
start times only.

## Exporting, step by step

The export page is five steps, in the order the audio is processed, one
decision each: **Edit → Noise → Tone → Loudness → Export**. Tabs across the
top go back to any step you've reached; Back and Next are in the bar at the
bottom. The settings are kept for the session while the tab is open, so going
back or reloading never loses them; the defaults come from Settings →
Recording.

The bar is also the preview: 30 s of the episode through everything up to the
step you're on, with a before and after for that step (**Raw / Edit**,
**Original / Cleaned / Removed**, **Before / With tone**, **Before /
Levelled**, **Raw / Final**). It says what's playing ("Edit → Noise 40 % →
Tone → −16 LUFS"); switching keeps your place; changing a setting while it
plays updates it in a second or so. Because noise suppression comes before
tone and loudness, boosting a voice doesn't bring the room back up.

1. **Edit**: the assembled edit, marker tones, and what happens to pauses
   (cut, keep, split); with pads, the Pads track and the rough mix; the
   markers list.
2. **Noise**: see [Noise suppression](#recording-solo).
3. **Tone**: each voice's EQ and compressor (below).
4. **Loudness**: the target, and **Measured / After / True peak** for the
   preview, the loudness over those 30 s against the target, and Level each
   speaker.
5. **Export**: your chain (each stage with a Change link back to it) and what
   goes in the zip. The button says how many files it makes ("Export 11
   files"); afterwards the page shows what the finished episode measured.

## Ready to publish

Every export gives you two ways out: the files for your own post-production
(an untouched WAV and an edit per person, lined up, with timecode), and an
episode you can upload to your podcast host as is. The episode is set in the
Tone, Loudness and Export steps, with the defaults in Settings → Recording.
Each switch is independent:

- **Episode file** (on by default). Everyone's edit, and the Pads track if you
  used pads, mixed into `…_Episode.wav`. If pauses are set to split, there's
  one per part (`…_Episode_part2.wav`).
- **Loudness.** **Stereo** at −16 LUFS (the default), **Mono** at −19 LUFS
  (the same loudness heard on one channel), or **Off**. Loudness is measured to
  ITU-R BS.1770-4 / EBU R128 (K-weighted, gated), the gain is set to reach the
  target, and a true-peak limiter keeps everything under −1 dBTP so encoding
  to MP3 or AAC doesn't clip. Off mixes and limits only, with no gain. In
  stereo, voices sit in the centre and the pads keep their width. In mono,
  stereo pads are summed to one channel, (L + R) ÷ 2, so they sit at the same
  balance against the voices as in stereo; the export page says so when an
  episode has pads.
- **Level each speaker** (off by default). A slow leveler on each voice before
  the mix, so a quiet guest and a loud host come out even: it steers each
  voice toward the same speech level by up to ±12 dB, holds its gain through
  pauses (room noise and silence are never pushed up), and a gentle 3:1
  compressor catches laughs and shouts. It also puts a levelled copy of each
  person's edit in the zip (`…_edit_levelled.wav`) for your DAW. The Pads
  track isn't levelled.
- **MP3 too** (on by default). `…_Episode.mp3` beside the WAV: 192 kbps
  stereo or 128 kbps mono, with an ID3 tag carrying the episode's name.
  Encoded in the browser by LAME (lamejs, LGPL), which loads only when an MP3
  is made.

- **Tone** (per person, off until you set it). A ten-band graphic EQ (31 Hz
  to 16 kHz, ±12 dB) and a compressor for each voice, applied to their edit
  before the leveller and the mix. The graph shows a speech target, the
  voice's own long-term spectrum (measured from their take) before and with
  the EQ, and the EQ curve. Presets (Flat, Warm, Clear, De-mud, Radio; Custom
  once you move a band), and **Match to target**, which
  suggests bands that move the voice toward the target by up to 6 dB each.
  Sweep a finger or the mouse across the faders to draw the curve, or drag
  the dots on the graph; on a phone all ten fit. The compressor is **Off,
  Light, Medium or Heavy** (about 3, 6 and 10 dB off the loudest words);
  **More** opens its curve (input against output, with the voice's level
  riding on it while you preview) and its threshold, ratio, knee and make-up
  gain. Each person's tone is remembered by name (Settings →
  Recording → Tone lists them). With tone on and levelling off, the zip also
  gets a toned copy of each edit (`…_edit_toned.wav`); with levelling on, the
  levelled copy includes the tone.
- **The preview** runs the export's own chain (noise suppression, tone,
  leveller, loudness target, limiter), so what you hear is what you get. On
  the Tone step, **Before / With tone** are at the same loudness, so the
  comparison is about tone and not level.
- **Loudness graph** (on by default; Settings → Recording): short-term
  loudness over the preview against the target (green within 1 LU), and after
  an export, over the whole episode with its integrated loudness, range and
  true peak. `…_export.txt` has the same figures and each person's tone.

The episode is made from the same audio as the edits: lined up and drift
corrected, coughs muted, and cleaned when noise suppression is on. The
originals are never changed. `…_export.txt` in the zip gives the result,
for example "Episode: −16.0 LUFS integrated (−21.3 before, gain +5.3 dB),
stereo, true peak under −1 dBTP; levelling on".

It all runs in your browser, like noise suppression, so the server does no
extra work. On a recent laptop an hour with two speakers takes about 4
minutes to mix and level, and about 5 more for the MP3.

## Hotkey pads

Nine sounds on the number keys: soundbites, clips, music and sound effects (Hotkey Pads 1a–1c, 2a–2b).

- **Set them up** in Settings → **Hotkey pads**, or **Edit** on the pads. There's a **show set** for every episode, and an episode can override single pads (shown with a dot). Drag to swap keys. Each pad has:
  - a sound: an upload (WAV, MP3, M4A or FLAC, converted to 48 kHz), a **soundbite** from the episode package or a **clip** (any range of a saved session), or anything already in the library;
  - a Syntax colour, **One-shot / Loop / Hold**, volume (−24 to +6 dB), fades, trim, and **duck under your voice** with its own amount.
  - The kind sets the defaults: music loops, ducks and fades out over 2 s; a sound effect plays once with no fade and no ducking; soundbites and clips play once with a 150 ms fade.
  - **Ducking** for every pad is set there too: attack (default 80 ms), release (default 400 ms) and the voice threshold.
- **On a laptop** (mouse, 1024 px or wider): a rail beside the script with the 3×3 grid, Stop all / Fade all, what's playing and time left, pads volume and ducking. The bar's meter gets a **PADS** row under MIC. **1–9** fire pads while you rehearse or record, not while paused, typing, or with More open (there 1–9 still jump to sections). **0** stops everything; **Shift+0** fades everything over 2 s.
- **On a phone or tablet**: a swipeable strip above the control bar. Tap a pad to fire it. Pull the strip up (or tap its handle) for all nine pads, laid out 1–9 like the rail. Firing a one-shot there, or swiping down, drops back to the strip.
- **Riding a pad's level on a phone** (Hotkey Pads 2c): press and hold a playing loop or one-shot in the strip and it grows into a full-width fader. Slide left or right to set its level (−40 dB up to 0 dB, or the pad's saved level if that's higher) while you talk; it clicks into 0 dB and the saved level as you pass them (a light tick in your headphones, and a buzz on Android). **Fade out · 2 s** and **Stop** sit under it. Let go and it goes back to the strip after 2 s. The ride is recorded on the Pads track, and the next press starts from the saved level again.
- **What a press does**: a one-shot restarts, a loop fades out, a hold plays only while you hold it. Several can play at once. Pads play in your headphones only and never touch the mic. If the output looks like laptop speakers, the rail says so.
- **Recording**: every press is a marker ("Pad 3 · Four pallets bite") on the timeline, in the pad's colour. The export has a stereo **Pads track** the same length as your mic, rebuilt from the press log so each press lands exactly where it was fired, and ducked the same way you heard it. It also has a **Pads edit** with the same cuts as your mic edit. A cough mutes only the mic of whoever coughed; the Pads track is never muted. **Rough mix** (off by default) sums mic and pads with a limiter at −1 dBFS.
- **Script cues**: a line of only `[pad 3]` (or `[pad 3 · note]`) shows as a chip in the pad's colour and isn't read aloud. Cues never fire anything.
- Pads and their sounds are stored on the server, per show, and cached in this browser. Clearing a pad keeps its sound in the library.

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

## Browsers

| Device | Browser | Voice follow | Recording |
|---|---|---|---|
| Laptop or desktop | Chrome, Edge, Arc (Chromium) | Chrome speech recognition | MediaRecorder PCM |
| Android phone | Chrome | Chrome speech recognition | MediaRecorder PCM |
| iPhone or iPad, iOS 17+ | Any (they're all WebKit) | Manual scroll by default; Siri voice follow is an opt-in experiment in More | AudioWorklet PCM |

Firefox and Safari on the Mac go to `/unsupported`, and so does any page opened over plain `http://` from another device: browsers only allow the mic, recording storage and audio processing on `https://` or `localhost`. iPhones are judged on features, not the version in the user agent (Safari has reported iOS 18.6 since iOS 26); a WebKit without AudioWorklet or OPFS gets "Update iOS". The unsupported page has a **Details** panel listing exactly what's missing, with **Copy details**. Safari before 26 has no `createWritable()`, so recordings are written from a worker there (`lib/audio/opfs-write.worker.ts`).

**HTTPS is the default.** Podstudio always serves `https://`, with a self-signed certificate until the real server sets one up with Caddy or Nginx + Certbot. Each device shows a certificate warning the first time; accept it once. On a phone or a guest's computer, open the `https://` Network address that `npm run dev:phone` prints, on the same Wi-Fi.

## Accounts and the server

The first time you open it, Podstudio asks you to create the admin account and turn on two-factor
authentication (an authenticator app, plus ten one-time recovery codes). After that:

- **Sign in** with your username and password, then the 6-digit code from the app, or a recovery code.
  "Keep this device signed in" lasts 30 days (otherwise 12 hours); "Trust this device" skips the code on
  that browser for 30 days.
- **Settings → Security**: when two-factor was added, recovery codes left (and new ones), trusted devices
  (revoke any), and changing the password, which signs out every other browser. Sign out is at the bottom of
  the settings list.
- **Guests and producers don't need an account**: they join with a 6-digit code, and you let them in.

**What's on the server:** episodes (the home page lists them; **+ New episode** takes the next number), each
episode's script, show setup (solo or with a guest, script mode, talking points) and hotkey pads, and the pad
sound library. Pages are rendered with the server's copy and it's kept in this browser too, so the recording
screen works offline; a change made offline goes up on the next page load. Scripts carry a version, so a tab
with an old copy can't overwrite a newer one (it takes the newer copy instead).

**Recordings go to the server as you record.** Each 5 s piece is saved in this browser first, then uploaded,
with the take's markers. The header says "Saved to server" while it's caught up and "Saved in this browser"
while it's catching up (offline, say); more than 30 s behind shows "Uploads are behind". At Stop the last
pieces go up (up to 10 s); anything left is sent from the next page, and the Saved screen says how much of
it the server has. On another computer, Sessions lists recordings that are on the server but not in that
browser: **Bring into this browser**, then play or export as usual. Deleting a session deletes both copies.
- Passwords are hashed with scrypt; the session cookie is random and only its hash is stored; sign-in and
  codes are limited to 10 tries per 15 minutes.

## Known gaps

- **Voice follow uses Google's speech service** through Chrome, so it needs an internet connection; if the connection drops it reconnects on its own. On an iPhone it uses Siri, off by default; if it errors or stops more than 3 times in a minute it turns itself off and says so.
- **iPhone**: the mic stops as soon as Safari leaves the screen, so expect the "Mic stopped" warning there. This needs testing on a real iPhone.
- **Still mock data:** Whisper transcripts, titles/chapters/soundbites, the Domain & HTTPS checks, and the Controls remotes. Sign-in, episodes, scripts, pads and recordings are on the server.
- **Zips** are limited to 4 GB.
- **Setup wizard:** the Server check, Admin account, OpenAI key and Done steps have no designs yet, so "Verify and continue" goes straight to the Domain step.
- **OpenDyslexic** is listed as a prompter font, but the font isn't bundled yet, so it falls back to Atkinson Hyperlegible.
- **Mock values:** model names are placeholders. The version (Settings → About and Server, `/api/health`) comes from `package.json`.
- **Planned next** (designs in hand, not built yet): see `docs/roadmap.md`. It covers the next stage: a lab environment on a real VPS, with versioned releases and upgrade paths.
- **One guest per session**, by design. Video isn't part of it: the call app carries video if you want it.
