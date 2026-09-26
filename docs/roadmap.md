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

## Tone per speaker, and a loudness meter for the episode

Mockup: [design/Tone_mockup.html](design/Tone_mockup.html) (open it in a
browser; it plays an example conversation through real filters). Built on the
framework's Graphs & calibration rules.

- **Where:** a **Tone** card per person (host and guest tabs) in the export's
  Ready to publish section, with defaults in Settings → Recording. Applied at
  export to each person's edit, before the leveller and the mix. The
  recordings never change, so the tone can be redone any time; toned copies
  for a DAW are optional, like the levelled ones.
- **Graphic EQ:** ten bands, 31 Hz to 16 kHz, ±12 dB (peaking, about an
  octave wide). The graph shows a speech target (white), the voice before
  (its long-term spectrum from the take, faint) and with the EQ (the speaker's
  colour), the EQ curve, and a live spectrum while previewing. Presets: Flat,
  Warm, Clear, De-mud, Radio. **Match to target** suggests bands that move the
  voice toward the target, by up to 6 dB each. On a phone all ten bands fit;
  sweep a finger across them to draw the curve, or drag the dots on the graph.
- **Compressor:** the transfer curve (input against output, the 1:1 line in
  grey), threshold, ratio, knee and make-up gain, presets Gentle, Voice and
  Broadcast, gain reduction, and a dot showing where the voice is now.
- **Loudness meter (optional):** for the finished episode. Integrated,
  short-term and momentary loudness, range and peak; a momentary bar with the
  target tick (green within 1 LU); the last minute of short-term loudness with
  the target and a ±1 LU band; and what the export will do ("takes off 1.7 dB
  to reach −16 LUFS"). Live while previewing the mix; on the export page after
  rendering it shows the exact figures `renderMaster` measures.
- **Build:** `lib/audio/tone.ts` (EQ and compressor, unit-tested) used per
  track in `renderMaster` (`lib/audio/master.ts`); the long-term spectrum of
  each take; the Tone card and meter built from `FreqGraph`; the export report
  and docs.

