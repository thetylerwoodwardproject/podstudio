# Packaging

PodStudio ships in four formats. They are **not equally verified**. This table is what was actually done.

| Format | Build | How it was checked | Status |
|---|---|---|---|
| **.deb** | `./packaging/build-deb.sh` | Full test suite run against the extracted package under the library versions Ubuntu 24.04 supplies; installed and run on a real machine. | Verified |
| **Flatpak** | `flatpak run org.flatpak.Builder --user --install --force-clean build/flatpak-build packaging/flatpak/io.github.thetylerwoodwardproject.PodStudio.yml` | Built from scratch and installed from the single-file bundle. `podstudio --self-test` passes inside the sandbox. **Tested with a real PodMic inside the sandbox**: it found the control channel, audio input and ALSA gain control, read and decoded the on-board settings over HID, wrote gain and monitoring back unchanged, recorded a clean 3 s take, and the Mic tab showed live values. The host udev rule is still needed. | Verified |
| **AppImage** | `./packaging/build-appimage.sh` (102 MB output) | The finished file passes `--self-test`, also inside a bare Freedesktop runtime that has no GTK or libadwaita (it uses its own bundled libraries). With a real PodMic, through its own bundled Python, it found the control channel, ALSA gain and audio input, read and wrote settings back unchanged, and recorded a clean take. Built on Ubuntu 24.04, so it needs a distribution that new or newer. | Verified |
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
