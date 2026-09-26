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
