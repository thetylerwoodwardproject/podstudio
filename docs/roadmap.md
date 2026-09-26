# Planned

Designed and agreed, not built yet.

## Next stage: a lab environment on a real VPS

The next test runs on a real VPS. From here on, work builds off that lab
server rather than only this dev container, so every change has to be
something you can install over a running copy without losing data.

- **Lab environment.** One VPS set up with `deploy/install.sh` (Caddy, systemd,
  `/var/lib/podstudio`), used as the reference install. New slices are tried
  there — a real domain, real phones, real network — before they count as done.
- **Versions.** Releases get a semver number, set once in `package.json`:
  - shown in Settings → About and in `GET /api/health` (both done, with the
    schema version: the number of migrations);
  - tagged in git (`v0.2.0` …) with a short changelog (`CHANGELOG.md`): what's
    new, what changed, anything to do by hand when upgrading;
- **Upgrade paths.** Going from any released version to the next must work:
  - `install.sh` detects an existing install and upgrades in place: backup,
    copy, `npm ci`, build, restart, health check (done: the guided installer);
  - a backup of `podstudio.db` (`VACUUM INTO`) before migrations run, kept
    with the version it came from (done: `/var/backups/podstudio/pre-<version>-<date>.db`);
  - migrations only move forward and are tested from each released schema,
    not only from an empty database;
  - rollback: reinstall the previous tag and restore that backup;
  - the server refuses to start on a database newer than it knows, with a
    message saying which version to install.
- **Lab checks for each release:** fresh install, upgrade from the previous
  release with real recordings in place, restart during a live session (guests
  reconnect), and idle memory.

## Publish-ready export: loudness and leveling

Today's export is made for editing: an untouched WAV and an edit for each
person, lined up, with nothing done to their level. Next, an export you can
publish as is, alongside the files for editing yourself.

- **Mixed episode file.** Everyone's edit (and the Pads track) mixed into one
  file: **stereo at −16 LUFS** or **mono at −19 LUFS** integrated, the
  usual podcast targets. Loudness measured to ITU-R BS.1770 / EBU R128, with a
  true-peak limit (about −1 dBTP) so encoding to MP3 or AAC doesn't clip.
  Still to explore: where the measuring and gain run (in the browser, like
  noise suppression, or natively on the server), and whether to export MP3 as
  well as WAV.
- **Adaptive leveling per track (optional switch).** A compressor/leveler on
  each person's track before the mix, so a quiet guest and a loud host come
  out even and nobody jumps when they laugh. Off by default; set in Settings →
  Recording and on the export page, next to the loudness target. Like noise
  suppression, it makes processed copies and never changes the raw files.
- **Both ways out, always.** The export page offers:
  - **Ready to publish:** the mixed, leveled, loudness-matched episode.
  - **Everything for your DAW:** the raw and edited WAVs per person, lined up
    with timecode (as now), for your own post-production.

**Landing page, once this ships:** advertise both. "Export it as is and publish
it straight to your podcast feed, or take every track into your favourite DAW
and do your own post-production." Not before: today's export doesn't make a
finished, loudness-matched file, so the claim would be ahead of the app.

## Mixer view on a phone (Mixer View 2a–2b)

For a host + guest session with no script (ad-lib mode), on a phone. The laptop mixer (1b) is built.

- **2a · Collapsed.** A dock above the control bar with one thin meter per person, name and dB ("Tyler −7 dB", "Sam −50 dB"), in place of the single footer meter. The screen above says "Just talk · No script for this show. Markers work as usual."
- **2b · Slid up.** Drag the dock up or tap it to open the full strips:
  - "LEVELS · TARGET −18 TO −6";
  - a vertical strip per person (name, HOST / GUEST, a scale at 0 / −6 / −18 / −60, dB readout, IN TARGET or the guest's "↑42 uploaded");
  - **TALK TIME** "Tyler 58% · Sam 42%".
- **Behaviour:**
  - The control bar stays below the dock, so Cough and Retake still work while it's open.
  - Swipe down or tap the scrim to close.
- **Reuse:** `lib/mixer.ts` (zones, history, talk time) and the guest's `guest` room messages. It needs a phone layout in `MixerLanes.astro` / `lib/mixer-view.ts`, like the pads strip and sheet in `PadStrip.astro`.

## Hotkey pads: press and slide to set a level (Hotkey Pads 2c)

- **Gesture.** On a phone, press and hold a playing pad and it grows into a full-width fader ("−20 dB · SLIDE TO SET LEVEL", 0 dB at the right).
- **Controls.** "Fade out · 2 s" and "Stop" sit under the fader. Let go and it shrinks back into the strip after 2 s.
- **Feedback.** A light tick plays at 0 dB and at the pad's saved level.
- **Recording.** The level change is recorded on the Pads track. `PadLog` needs per-press level changes; today it logs rail-wide volume changes only.
