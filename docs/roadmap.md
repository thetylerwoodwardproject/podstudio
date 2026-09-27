# Planned

Designed and agreed, not built yet.

## Next stage: a lab environment on a real VPS

The next test runs on a real VPS. From here on, work builds off that lab
server as well as local development and CI, so every change has to be
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

The unit/server checks and all 13 browser tests already run in
[GitHub Actions](../.github/workflows/checks.yml). They cover simulated devices;
they do not replace the real-server and real-phone checks above.

## Calibration (step flow mockup 1d)

Designed in `design/step-flow/` (1d), not built: a step flow of **Speaker 1 →
Speaker 2 → Result** that plays a test signal through each monitor speaker,
measures it with the mic, and shows each speaker's curve in its colour (the
framework's graph) with a gain readout. Result compares **Before / Corrected**
in the bar; the last button is **Save**. It needs:

- a measurement signal and capture (sweep or pink noise) and the averaged
  response per speaker (`lib/audio/spectrum.ts` has the long-term spectrum);
- a correction per speaker: gain and a few EQ bands toward the target, stored
  in Settings;
- somewhere the correction applies (the monitor path during recording and
  playback), which doesn't exist yet: Podstudio doesn't route monitoring
  today.

## Transcription and episode package

Transcripts, titles, chapters and soundbites still use example data. Connecting
transcription through the user's own OpenAI key and replacing the package
screen's mock content remain future work, after the lab and upgrade-path work.
The Domain & HTTPS checks and Controls remotes also remain mock interfaces;
see [known gaps](features.md#known-gaps).
