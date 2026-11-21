# PodStudio handoff

State as of **v2026.11.20** (package revision 5). Read this first when picking the project back up.

## Where things stand

- Source is on GitHub: <https://github.com/thetylerwoodwardproject/podstudio> (`main`, tag `v2026.11.20`).
- **No GitHub release has been published yet.** The built packages are on this machine only, in `dist/`:
  `podstudio_2026.11.20-5_amd64.deb`, `PodStudio-2026.11.20.flatpak` and `PodStudio-2026.11.20-x86_64.AppImage`, each with a `.sha256`.
  Until a release exists, the in-app updater finds nothing, which is expected and silent.
- The repo previously held a different project (a TypeScript web "Podstudio"). It was replaced on 2026-11-20.
  A full backup is in `~/Backups/` (`podstudio-previous-contents.git` mirror, the `.bundle`, and
  `podstudio-previous-metadata.json` with the old description, homepage and topics).
  The old pull requests #1 to #5 and their commits are still reachable on GitHub; only deleting and recreating
  the repo, or a GitHub Support purge, removes them.

## To do: publish the release (the open item)

Why it matters: installed copies look at the repo's *latest release* to offer updates, and refuse to install one
that doesn't publish a SHA-256 checksum. So the release must contain **both** files.

### Prerequisites
- The GitHub CLI, signed in as the repo owner: `sudo apt install gh && gh auth login`.
  Do not paste tokens into chats or put them in git config. The token used for the 2026-11-20 push was exposed in
  a chat and **should be revoked** (GitHub, Settings, Developer settings, Personal access tokens).
- A clean, pushed `main`. This file was committed locally after the push, so run `git push origin main` first.

### Steps
```bash
cd ~/rode-usb
./packaging/build-deb.sh                      # skip if dist/ already holds the build you want to ship
V="$(dpkg-deb -f dist/podstudio_*_amd64.deb Version)"        # e.g. 2026.11.20-4
(cd dist && sha256sum -c podstudio_${V}_amd64.deb.sha256)    # must print: OK
git push origin main && git push origin "v2026.11.20"        # if not already pushed
gh release create "v${V}" \
  "dist/podstudio_${V}_amd64.deb" "dist/podstudio_${V}_amd64.deb.sha256" \
  --title "PodStudio v${V}" --notes "First public release. See the README."
```

Rules the updater depends on:
- The tag is **`v` + the package version** (`v2026.11.20-4`). The updater compares that tag to what is installed.
- The `.deb` asset name must match `podstudio_<version>_amd64.deb`, and the checksum asset must be the same name
  plus `.sha256`, in `sha256sum` format. `build-deb.sh` already writes it that way.
- Do not mark it a pre-release or draft: those are deliberately ignored.

### Verify afterwards
```bash
curl -s https://api.github.com/repos/thetylerwoodwardproject/podstudio/releases/latest | python3 -m json.tool | grep -E 'tag_name|name"'
```
Expect the tag and both asset names. Then test the updater for real, which has only ever been tested against a mock
server: install an *older* revision, open PodStudio, and use the menu's **Check for Updates…**. The dialog should show
the notes, download with progress, ask for your password, and offer **Restart now**.
(The 2026.11.20-4 package itself will not show as an update on a machine that already has it.)

### Releasing later versions
1. Bump `__version__` in `podstudio/__init__.py` to the new date (`YYYY.MM.DD`) and set `packaging/revision` to `1`.
   For a second build on the same date, keep the date and raise `packaging/revision` instead.
2. `.venv/bin/python -m pytest` must pass, then `./packaging/build-deb.sh`, then commit, tag, push and `gh release create` as above.

## Packaging: four formats, unequal proof (see `packaging/README.md`)

- **.deb**: verified (full suite against the extracted package, installed and run on a real machine).
- **Flatpak**: built and installed from the single-file bundle; `--self-test` passes inside the sandbox and the window
  renders on GNOME 49. **Tested with a real PodMic inside the sandbox** (discovery, ALSA gain, HID read and write-back,
  a 3 s recording, live Mic tab). This needs the host udev rule, which the `.deb` installs and Flatpak cannot.
- **AppImage**: built (`dist/PodStudio-2026.11.20-x86_64.AppImage`, 102 MB, with `.sha256`) by running
  `./packaging/build-appimage.sh`, which pins `appimagetool` 1.9.1 by checksum. The finished file passes `--self-test`, passes
  inside a bare Freedesktop runtime that has no GTK or libadwaita, and worked against a real PodMic. It is assembled from
  Ubuntu 24.04 libraries, so it runs on that release and newer, not on older distributions.
- **Snap**: `snap/snapcraft.yaml` was written but never built (needs snapd plus LXD or Multipass and root). Expect to fix
  the first build. Whether `raw-usb` reaches `/dev/hidraw` is a guess.
- **CI** (`.github/workflows/packages.yml`) builds all four on a tag. It has never run, and pushing a workflow file needs a
  token with the `workflow` scope.
- To rebuild the Flatpak: `packaging/flatpak/gen-wheels.py --python 3.13 > packaging/flatpak/python-deps.json` re-pins its
  Python wheels (whole tree, with checksums), then see the command in `packaging/README.md`.
- The in-app updater is switched off for Flatpak and Snap (their stores update them) and only offers a link on AppImage.
- Still unproven: the Snap (never built), and any of these formats on a machine that isn't this one.

## Known gaps (not bugs: things never exercised)

- **Buzzsprout** has only run against a local mock server, never a live account. Do a first upload to a throwaway
  or private draft and check the episode, art and chapters in the Buzzsprout dashboard before relying on it.
- **Mic DSP**: gain, mute, monitoring, high-pass, Basic/Advanced and single compressor/gate values are verified on
  hardware. Not every Advanced field has been checked by ear.
- **Updater install step** (the `pkexec` password prompt) has not been run for real.
- **Global hotkeys** are not implemented: pad keys only work while PodStudio is focused (Wayland needs the
  GlobalShortcuts portal).
- **Package** targets Ubuntu/Pop!_OS 24.04 on amd64 only (the bundled DeepFilterNet is the static x86_64 build).
- A leftover `/etc/udev/rules.d/70-cuebooth-podmic.rules` from the old project name may still exist on the dev
  machine. It is harmless; `sudo rm` removes it.

## Orientation

| Where | What |
|---|---|
| `podstudio/window.py` | Main window: Session, Mic, Mix, Recordings, Publish tabs |
| `podstudio/audio.py` | Mic engine, hotkey `ClipPlayer`, preview `Player`, waveform peaks, WAV repair |
| `podstudio/render.py`, `loudness.py` | Mix, ducking, true-peak limiting, -16 LUFS normalization, MP3 export |
| `podstudio/podmic.py` | PodMic USB control over HID (protocol from rumkit/podmicusb-doctor) |
| `podstudio/denoise.py` | DeepFilterNet wrapper (uses the bundled `deep-filter` binary) |
| `podstudio/buzzsprout.py`, `publish_ui.py` | Buzzsprout API client and the Publish tab |
| `podstudio/recovery.py` | Crash recovery: hit journal, backup restore, rebuild |
| `podstudio/runtime.py`, `alsa_gain.py`, `selftest.py` | Which package format is running; ALSA gain without `amixer`; `--self-test` |
| `podstudio/updates.py`, `update_ui.py` | Update check, verified download, authorized install |
| `packaging/` | `build-deb.sh`, `build-appimage.sh`, `flatpak/`, `appimage/`, `fetch-deepfilter.sh` (checksum-pinned), `revision`; `snap/` has the Snap recipe |
| `tests/` | About 117 tests; GTK ones skip without a display |

Run the app from source: `.venv/bin/python -m podstudio`. If a packaged copy is already open, add a second instance
only via a script that sets `Gio.ApplicationFlags.NON_UNIQUE`, or it will hand off to the running one.

Dev habits that mattered here: screenshot and test scripts should use a fake mic that ignores writes, because the
real PodMic's settings persist inside the mic itself.
