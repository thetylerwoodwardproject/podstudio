# Podstudio features

Everything Podstudio does today, in detail. For what's still mock data or
missing, see [Known gaps](#known-gaps); for what's next, [roadmap.md](roadmap.md).

- [Recording solo](#recording-solo)
- [With a guest and a producer](#with-a-guest-and-a-producer)
- [Keeping tracks in sync](#keeping-tracks-in-sync)
- [Podstudio Editor](#podstudio-editor)
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
  - **More** (`···` or **M**): a bottom sheet on a phone, a popover on a laptop, with Pause (**P**; host and guest stop accepting samples, playing pads freeze, and Resume counts down 3-2-1), text size 80–160 % (⌘+ ⌘−, saved per device), jump to section (**1–9** while it's open), the mic (changeable before you start), how much is saved, marker counts, the retake tone, and End session.
  - Tap or click a line to move there, drag or scroll to look around, **← →** or a page turner's PageUp/PageDown change lines.
  - **The meter** snaps up to each peak and falls 12 dB a second (like a broadcast peak meter), however often the device reports levels. A tick holds the highest peak of the last 1.5 s, which is the number beside it, so −12 dBFS sits mid-amber. If the system pauses the mic (iOS does for calls, Siri and other apps, and browsers keep audio off until you tap), a warning says so with a button to turn it back on. If a mic arrives with a silent input 1 and signal on another input, Podstudio switches to that input before you record, or warns if you're already recording. On iPhone and iPad it asks for a one-channel mic. **Copy diagnostics** in More includes the mic's settings, state and each input's level.
  - The laptop shows markers on a thin timeline above the bar: amber retakes, grey coughs, blue ad-libs, red gaps, and pad presses in their colours.
- **Warnings** (1h), one at a time, the most serious first. None stop the recording.
  - **Mic stopped**: audio stops arriving while the clock runs on (an iPhone leaving the screen, the mic taken away). The gap is marked, not filled with silence: its length is measured from the samples that did arrive, and markers after it are moved back by that much when they're mapped onto the audio. **Resume recording** restarts the mic into the same file.
  - Clipping, a Bluetooth mic (call quality; tap to switch to the built-in mic before you start), battery at 20 % and 10 % (where the browser reports it), and less than 30 minutes of space left.
  - The screen stays awake while recording.
- **After End Session:** a computer opens the Podstudio Editor. A phone opens **Session saved** (`/episodes/142/saved`) with a scrub-capable player, recording/marker details, upload status and Retry synchronization, and individual raw WAV downloads. Phones use **Review recording** from the library and sessions; full editing and finished export are available on desktop.
- **Voice follow keeps going**: after a network error it keeps reconnecting (waiting up to 30 s between tries), a failed start is retried, and a watchdog restarts recognition when the meter hears you talking but no words come back for 10 s (Chrome sometimes stalls silently). A ring next to REC shows its state (green listening, amber reconnecting, red stopped), More shows it with the restart count, and a warning with **Restart voice follow** appears if it stays down. Every restart, error and stall goes into the session's voice log: **Copy diagnostics** in More, and `…_voice-log.txt` in the export.
- **Marker tones** (export switch, set up in Settings → Recording): a short beep mixed into the full recording at each retake, and optionally coughs (yours only), ad-libs, pauses and mic stops, each at its own pitch. **Pitch** moves them all: Low (a retake at 600 Hz), 1 kHz, or High (1.6 kHz). They're ducked **under your voice** (default 12 dB); **More** has which markers beep, the tone level, and the attack (how fast they drop when you start talking, default 10 ms) and release (how fast they come back, default 150 ms). The card has a clean, isolated preview for each of the five marker types and shows its current frequency; these use the same generator, pitch, duration and level as export. The edit stays clean, and only the moments around the tones are re-encoded.
- **Lossless audio**: mono or stereo WAV at 16 or 24-bit, recorded through MediaRecorder PCM on supported Chromium browsers, on the mic’s own clock and at its own rate (nothing is resampled on that path). iPhone/iPad use AudioWorklet PCM at the AudioContext rate. On the MediaRecorder path, Web Audio only drives the meters, because it runs on the output device's clock, and with an interface in and other speakers out Chrome dropped or repeated samples. Browser echo cancellation, noise suppression and auto gain are off. Audio is saved to the browser's private file system every 5 seconds.
- **Microphone choice** (Settings → Recording, the mic check, or More before you start): "System default" follows the computer's sound settings; anything else is used whatever the OS default is. In mono, input 1 is recorded unless you pick another input or "all inputs mixed" (averaged); in stereo, inputs 1 and 2 become left and right. A saved mic that's unplugged falls back to the system default and says so.
- **Levels**: Podstudio reads the interface's inputs itself instead of Chrome's mono downmix (which read a mic on Input 1 of a two-input interface 6 dB low). Checked with test tones: mic check, recording screen and WAV agree to 0.1 dB.
- **Mic check** (`/episodes/142/mic-check`), four steps: **Input** (the mic, free space, and the numbers under Advanced details), **Level** (one meter in the traffic-light zones and a plain-language line saying what to turn), **Test** (a 10-second recording, and a line to read for voice follow) and **Noise** (below). The test plays in the bar at the bottom; **Start recording** is on the last step. It's a check, not a gate: every tab is open. It can be switched off in Settings → Recording.
- **Crash recovery**: if the tab closes mid-session, the next visit to the studio, library or sessions page opens the recovered-session screen. At most the last 5 seconds are lost.
- **Your own script**: on the script page, **Import or paste** opens three steps. **Paste**: pasted text or a .txt/.md file (`## Heading` lines become sections). **Sections**: each with its lines and read time at your prompter speed; click a name to rename it, drag the handle (or Alt+↑/↓) to reorder, and its lines move with it. **Review**: the script as it will read, then Import. The bar at the bottom sums it up ("4 sections · 64 lines · ~8:15 read time"). Full-screen on a phone. Every screen uses the script, and lines can be edited in place.
- **Editor and export:** the desktop editor opens after End Session, derives visible waveforms from bounded source reads when peak metadata is missing, keeps every edit as metadata and exports a finished WAV, optional MP3 and optional aligned raw tracks. Its compact Tools, Edit and track menus keep the timeline clear; position and trim fields appear for a selected clip. A track can be removed from the finished timeline and restored later without deleting its source. Recorded raw tracks remain available; removed imported audio remains in the media library but is excluded from that project's raw ZIP. Retakes and pause suggestions are reviewed explicitly; coughs are muted only in the finished mix.
- **Noise suppression**, like Waves NS1: one fader, adaptive, no noise print to capture. It uses [DeepFilterNet3](https://github.com/Rikorose/DeepFilterNet) (MIT/Apache), built to WebAssembly and served from `public/vendor/deepfilter`, so nothing leaves the browser. The fader sets how much the model may take away (halfway allows 20 dB; the top takes all it can), and your voice is left alone. With noise under speech the model's per-frequency gain jumps about from one 10 ms frame to the next, which made voices sound fluttery (and quieter, so compression and levelling pumped them back up); its gains are steadied (they rise at once and fall over 80 ms) before they're applied, which takes that wobble from 1.4 to 0.5 dB at 70 % on a noisy test recording while the background still drops 20 dB. The raw WAV is never changed: a cleaned copy is kept beside the recording and reused.
  - **Editor:** noise amount is a per-voice control in the FX sheet and is heard in the cumulative timeline preview. It is applied only while rendering playback or a finished export; raw source audio remains unchanged.
  - **Credits**: Settings → About & credits and README list DeepFilterNet3, shadcn-svelte, Bits UI, More Shadcn Svelte, Lucide, and other bundled work, with licences.
  - **Listen:** Session Saved and Sessions can still compare Original/Cleaned. In the editor, the same processor runs in bounded windows as part of the cumulative preview.
  - **Mic check** (step 04, Noise): the noise floor of your test recording, a suggested setting (quieter than −60 dBFS: not needed; −60 to −45: 40 %; louder: 70 %) with **Use 40 %**, the fader and how far the background comes down. The test plays **Original / Cleaned / Removed**. The setting you pick is the export default, also in Settings → Recording.
  - Cost: about 19 MB downloaded once (the 11 MB engine, 2 MB gzipped, and the 8 MB model), then cached. It runs at 2–4× real time on a laptop, so a 30-minute episode takes around 10 minutes to clean, and longer on a phone. The server could run the native `deep-filter` binary instead, which is much faster (planned).
  - `scripts/build-deepfilter.sh` rebuilds the engine from a pinned upstream commit.
- **Sessions list** (`/episodes/142/sessions`): play, open to export, download or delete.
- **Settings are saved on the server** (`/api/me/settings`): recording format, the mic-check toggle, exports, scrolling mode, the prompter font and the rest follow you to any browser you sign in on. A fixed status at the lower right says when a write is saving, saved, waiting for a connection, or failed. Each browser keeps a copy, so pages open with them straight away; a newer copy from the server is taken when a page opens, and a change made offline goes up on the next page load. The microphone choice stays per device; the recording screen’s 80–160 % text zoom is also local.

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
- **Preparing the editor:** after End, the desktop editor waits for the guest’s final segments, downloads missing server segments on demand, applies automatic start, drift and gap correction, and then opens the synchronized tracks. If an upload is missing, the existing **Add guest file** recovery accepts the guest’s backup WAV.
- **Editor/export** aligns the guest with drift and gap correction (see [Keeping tracks in sync](#keeping-tracks-in-sync)). Linked edits keep tracks together. The finished mix mutes each person’s cough only on that voice; optional raw tracks keep cough audio and place configured marker tones on the host copy only.
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

The optional `…_export.txt` report says what was done ("Sam: 48 ms of drift corrected
(+60 ppm), 3.0 s of missing audio filled with silence"), and the export page
shows the same. Accuracy is set by the browser's timing, typically within 10
to 20 ms. Recordings made before sync points existed are lined up by their
start times only.

## Podstudio Editor

**Open editor** is available on recorded episodes in the library and studio,
and on each session card. It opens the latest completed recording by recording
date; use the session switcher for older sessions. Explicit take links never
substitute another recording. Browser and server recordings are combined, so a
fresh browser can open a server session directly. Phones retain Session Saved.

Clicking a waveform selects its clip and opens compact clip details. Dragging
moves it on its track; ruler or Shift-drag selects time. Linked tracks move
together; Alt-drag unlinks. Trim handles or the popover's timeline position
and source in/out fields can shorten and restore source audio. Escape cancels
a drag or closes the popover. One completed gesture is one undo step. Delete
removes a selected clip or range without closing time; Ripple cut closes a range.
Overlapping clips mix. Cough markers follow their source clips through edits.
The selection shows its start, end and duration on the ruler. Right-click a
clip or highlighted range for Play selection, Split at cursor, Delete, Ripple
cut and Link/Unlink when applicable; Shift-F10 opens the same menu from the
keyboard. Playing a selection stops at its end.

Each track header has a live mono or stereo peak meter and held dBFS readout.
It measures that track after edits, FX, fades and its level control, before
final mastering. Mute and Solo affect what the meters show. This is a playback
measurement, separate from the source waveform and the level-control value.
The transport also has stacked horizontal Left and Right master meters. Those
measure the stereo mix the player receives, including mastering when mastered
preview is on. A mono mastered output feeds the same level to both bars.

**FX → Advanced** exposes a ten-band EQ (31 Hz–16 kHz, ±12 dB), response graph,
presets and bypass, plus threshold, ratio, knee, makeup gain, attack and release
for compression. Simple remains the default. Collapsing advanced settings
preserves them; Reset to simple requires an explicit confirmation. Preview FX
listens to the unsaved draft in the mix, Bypass compares it, Apply commits it,
and Cancel restores the prior sound.

**Loudness** controls the finished mix: −16 LUFS stereo, −19 LUFS mono, custom
−30 to −10 LUFS, or normalization off. The true-peak ceiling is adjustable
from −3 to −0.1 dBTP (default −1). Analyze mix measures the whole edited mix,
with progress and cancellation. Edits mark measurements stale. Mastered
playback and export share the same rendered audio; raw tracks are unaffected.

**Import audio** reports reading, conversion, upload percentage, server
confirmation and track insertion in a lower-corner status card. Failed uploads offer Retry and reuse the
same local file ID. Converted WAV uploads are limited to 200 MiB; larger
files receive an explicit size message. WAV, MP3, M4A, FLAC and other
browser-decodable inputs are supported.


The desktop workflow is **Record → Editor → Export → Optional AI tools**. End Session opens `/episodes/:id/editor?take=:takeId`; the old `/session` URL redirects there. Phones remain on Session Saved because the full editing surface is desktop-only.

- **Timeline:** a large ruler, one quiet marker lane (`RET`, `COUGH`, `AD-LIB`, `PAUSE`) and one readable waveform lane for each host, guest, pads or imported source. Existing timestamps and sync logs align tracks automatically. Waveforms use cached 20 ms source-time peaks from bounded reads and a fixed display scale, so split or moved clips retain the same shape without decoding a whole long recording.
- **Editing:** click a waveform to select it, drag it to move, drag its edge to trim, Shift-drag the waveform or drag the ruler to select a range, split, delete to leave a gap, or ripple-cut across linked synchronized tracks. Alt-drag unlinks a clip before moving it. Same-track edge overlaps crossfade across the full overlap; different tracks mix normally. Tracks stay linked unless explicitly unlinked. Space plays or pauses; Delete removes; S splits; X ripple-cuts; ⌘/Ctrl-Z and ⌘/Ctrl-Shift-Z undo and redo. Shortcuts do nothing while typing in a control.
- **Retakes:** markers and script history form attempt groups. The last attempt is suggested, but every group must be reviewed before export. Choose another attempt if needed, adjust its boundaries, loop either join, then confirm **Keep last take** or the selected attempt. Source recordings remain untouched.
- **Pauses:** shared quiet stretches of at least three seconds become suggestions. Leave each one alone, shorten it to one second and adjust the boundary, or remove it. Podstudio never strips natural pauses automatically.
- **Tracks and FX:** every track has Mute, Solo, FX, Level and a live dBFS peak meter. Solo changes listening only; mute and level also affect the finished mix. The FX sheet gives voice tracks noise amount, Low/Mid/High tone, Off/Light/Medium/Heavy compression and speech leveling. Pads and imports get tone and compression.
- **Imports:** WAV, MP3, M4A, FLAC and other formats the browser can decode become a new track at the playhead and use the existing media store.
- **Playback:** one persistent player previews the cumulative project. It keeps the playhead while edits and FX change. Initial playback renders roughly four seconds, then prefetches larger bounded windows toward 30 seconds. The transport reports preparation and waits; this is not a 30-second playback limit.
- **Autosave and recovery:** project metadata saves locally immediately and then to `/api/editor-projects/:takeId` after a short delay. The header reports Saving, Saved, Waiting for connection, Failed or Conflict. A conflict stops autosave until **Reload server version** or **Overwrite with this version** is chosen. Past Sessions reconstructs the timeline from immutable source references and saved metadata.

### Export

The editor’s compact export sheet always includes a finished WAV. MP3 and **Include raw tracks** are optional. A finished mix applies the selected takes, trims, cuts, pause decisions, track mute/level, noise, EQ, compression, speech leveling, loudness and true-peak limiting. It never includes marker tones.

Raw exports are aligned full host, guest, pads and imported tracks. They retain all attempts, cough audio and other unprocessed material. Coordinated pause intervals contain no recorded samples; equivalent intervals in older sessions are removed while raw files are assembled. Configured marker tones are rendered into the host raw export without modifying the source recording.

After packaging, the editor shows **Your export is ready**, **Back to sessions** and **Download again**. The project remains editable after export. Optional AI tools is visible as coming soon.

## Hotkey pads

Nine sounds on the number keys: soundbites, clips, music and sound effects (Hotkey Pads 1a–1c, 2a–2b).

- **Set them up** in Settings → **Hotkey pads**, or **Edit** on the pads. The main page keeps the show/episode choice, nine-pad grid and global ducking controls compact. Clicking a pad opens a centred setup sheet on a computer (bottom sheet on larger touch devices). Changes remain a draft until **Save pad**; Cancel, Escape and clicking the backdrop discard them. There's a **show set** for every episode, and an episode can override single pads (shown with a dot). Drag to swap keys. Each pad has:
  - a sound: an upload (WAV, MP3, M4A, FLAC or another browser-decodable audio file, converted to 48 kHz), a **soundbite** from the episode package or a **clip** (any range of a completed browser-local or server-stored session from previous episodes), or anything already in the library;
  - a Syntax colour, **One-shot / Loop / Hold**, volume (−24 to +6 dB), fades, trim, and **duck under your voice** with its own amount.
  - **Preview / Stop** plays the unsaved draft with its current trim, gain, fades, trigger mode and duck settings.
  - The kind sets the defaults: music loops, ducks and fades out over 2 s; a sound effect plays once with no fade and no ducking; soundbites and clips play once with a 150 ms fade.
  - **Ducking** for every pad is set there too: attack (default 80 ms), release (default 400 ms) and the voice threshold.
- **On a laptop** (mouse, 1024 px or wider): a rail beside the script with the 3×3 grid, Stop all / Fade all, what's playing and time left, pads volume and ducking. The bar's meter gets a **PADS** row under MIC. **1–9** fire pads while you rehearse or record, not while paused, typing, or with More open (there 1–9 still jump to sections). **0** stops everything; **Shift+0** fades everything over 2 s.
- **On larger touch tablets outside the mobile boundary**: a swipeable strip above the control bar. Tap a pad to fire it. Pull the strip up (or tap its handle) for all nine pads, laid out 1–9 like the rail. Firing a one-shot there, or swiping down, drops back to the strip.
- **Riding a pad's level on a large touch tablet** (outside the simplified mobile boundary, Hotkey Pads 2c): press and hold a playing loop or one-shot in the strip and it grows into a full-width fader. Slide left or right to set its level (−40 dB up to 0 dB, or the pad's saved level if that's higher) while you talk; it clicks into 0 dB and the saved level as you pass them (a light tick in your headphones, and a buzz on Android). **Fade out · 2 s** and **Stop** sit under it. Let go and it goes back to the strip after 2 s. The ride is recorded on the Pads track, and the next press starts from the saved level again.
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

**HTTPS is required for recording from another device.** Development and `npm run preview` serve HTTPS with a self-signed certificate. In production, `npm start` serves HTTP on `127.0.0.1:4321`, behind Caddy or Nginx + Certbot for public HTTPS. Each device shows a certificate warning the first time; accept it once. On a phone or a guest's computer, open the `https://` Network address that `npm run dev:phone` prints, on the same Wi-Fi.

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
sound library, your revisioned editor project metadata, and your settings (recording, export and prompter), so
they follow you to any browser you sign in on; the microphone choice stays per device. Pages are rendered with the server's copy and it's kept in this browser too, so the recording
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
- **Setup wizard:** admin account creation and two-factor setup work. The broader Server check, OpenAI key and Done steps are not implemented; after two-factor setup, the Domain screen still shows example checks.
- **OpenDyslexic** is listed as a prompter font, but the font isn't bundled yet, so it falls back to Atkinson Hyperlegible.
- **Mock values:** model names are placeholders. The version (Settings → About and Server, `/api/health`) comes from `package.json`.
- **Validation next:** the editor and installer are being exercised on the real lab VPS. See `docs/roadmap.md` for upgrade, long-session, real-device and optional AI work.
- **One guest per session**, by design. Video isn't part of it: the call app carries video if you want it.

The simplified mobile boundary is ≤700 px, or a coarse-pointer display ≤900 px. Sound pads, pad setup and key hints are unavailable there; existing recorded Pads tracks remain downloadable. Larger devices retain pad controls.
