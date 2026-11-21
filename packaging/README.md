# Packaging

PodStudio ships in four formats. They are **not equally verified**. This table is what was actually done.

| Format | Build | How it was checked | Status |
|---|---|---|---|
| **.deb** | `./packaging/build-deb.sh` | Full test suite run against the extracted package under the library versions Ubuntu 24.04 supplies; installed and run on a real machine. | Verified |
| **Flatpak** | `flatpak run org.flatpak.Builder --user --install --force-clean build/flatpak-build packaging/flatpak/io.github.thetylerwoodwardproject.PodStudio.yml` | Built from scratch; `podstudio --self-test` passes **inside the sandbox**; the window renders on the GNOME 49 runtime. The PodMic itself was not plugged in, so the sandboxed USB and ALSA access is untested. | Built and self-tested |
| **AppImage** | `./packaging/build-appimage.sh` | The app directory builds and its self-test passes, including in a bare Freedesktop runtime that has none of the GNOME libraries. The final packing step runs `appimagetool`, which has not been run. | Contents verified, final file not built here |
| **Snap** | `snapcraft` | Not built. It needs snapd plus LXD or Multipass and root. The recipe is a best effort. | Unverified |

`.github/workflows/packages.yml` builds all four on a release tag. It has never run.

## Checking any install

```
podstudio --self-test                                              # .deb or source
flatpak run io.github.thetylerwoodwardproject.PodStudio --self-test
./PodStudio-<version>-x86_64.AppImage --self-test
```

It checks the Python libraries, GTK and libadwaita, every GStreamer element the app uses, an MP3 round trip, the bundled
DeepFilterNet, the loudness meter and session files, then reports the microphone without requiring it.

## Things every sandboxed format has to deal with

- **No host tools.** There is no `pactl`, `amixer` or `dpkg-query`. The app reads the mic's gain through libasound, finds the
  input through GStreamer, and finds the HID node by asking `/dev/hidraw*` directly when `/sys` is hidden.
- **The mic's on-board controls need a udev rule on the host**, which no sandbox can install. The Mic tab shows the command
  (it works the same for every format): it writes `/etc/udev/rules.d/70-podstudio-podmic.rules`. The `.deb` installs it for you.
- **Updates.** Flatpak and Snap are updated by their stores, so the in-app updater is switched off there. The AppImage and the
  .deb check GitHub releases.
- **MP3.** The Flatpak runtime's libsndfile cannot read MP3, so reading an MP3 back (for the verified export and the waveform)
  goes through GStreamer.
- **Flatpak permissions** are broad on purpose. `--device=all` is the only way to reach `/dev/hidraw` and ALSA.
  `--filesystem=xdg-music` is where sessions are saved. The keyring and network are used for Buzzsprout.
