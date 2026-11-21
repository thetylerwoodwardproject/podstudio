# Roadmap

## Next: macOS (Apple silicon)

Rebuild the native app for Macs with an M-series chip. Planned for the week after the Windows app settles.

- **Reuse:** the platform-neutral `native/core/` (loudness, limiter, ducking, project files, PodMic protocol) and the ImGui interface.
- **New for Mac:** window and graphics backend (Metal), audio through CoreAudio, USB control of the mic through IOKit HID, token storage in the Keychain, MP3 export, a signed and notarized `.dmg`.
- **Testing:** on a real Mac with a PodMic USB, by the project owner.

## Also open

- Linux: the Python/GTK app stays as it is for now. Its Flatpak build still fails in CI.
- Windows: not yet tried with a real PodMic USB.
