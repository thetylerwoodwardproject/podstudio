# Planned

Designed and agreed, not built yet.

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
