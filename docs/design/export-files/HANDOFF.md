# Handoff: Export file picker (Podstudio)

Reference design: `Export Files.dc.html` (open it in a browser; the logic class at the bottom is the reference implementation). Screenshots are in `screenshots/`.

Builds on the step-flow handoff (`design_handoff_step_flow/`). The tabs, player and steps 01–04 don't change. This handoff only changes **step 05 Export**: users now pick which files go in the zip instead of always getting all of them.

## What to build

### 1. Export step (`01-export.png`)
- Keep "Your chain" as it is.
- Replace the old "In the zip" switches (Episode file, MP3 too, Raw WAV ALWAYS) with one card:
  - Title: `Your saved selection` if the current picks match the saved set; otherwise `Every file from your chain` / `N of M files picked` / `No files picked`.
  - Subline (mono, 12px, #8a8c91): `N of M · X.X MB`.
  - Right: a secondary button, `Choose files`.
- The bottom-bar primary button on this step reads `Export…` and opens the picker. `Choose files` opens the same picker.
- Remove the `episode` and `mp3` settings. Unticking those files in the picker replaces them.

### 2. Picker modal (`02-export.png`, `03-export.png`)
- Overlay: fixed, `rgba(0,0,0,.6)`. Clicking it or pressing Esc closes the picker without saving anything. Selection state stays in memory for the session.
- Panel: max-width 640px, background #0f0f11, border 1px #26272b, radius 16px, centered. The body scrolls and the header and footer stay fixed.
  - On mobile it's a bottom sheet: aligned to the bottom, radius `16px 16px 0 0`, max-height 88%, buttons 44px high.
- Header: `Choose files` (18px/500) with the `N of M · size` subline below, and a × close button.
- Quick picks (pill buttons, 32px). The active pill has a filled #ededea background with #0b0b0c text. A pill is active when the current selection exactly matches it.
  - `Saved`: only shown if a saved selection exists, and always first.
  - `Everything`
  - `To publish`: the Ready to publish group only.
  - `For my DAW`: the assembled edit group plus `markers.txt` and `markers.csv`.
  - `Forget saved`: a text link aligned to the right. Only shown if a saved selection exists.
- Groups, one card each (#141416, radius 14px). Groups with no files are hidden.
  1. Your recording, untouched
  2. The assembled edit
  3. Ready to publish
  4. Markers and reports
  - Group header: the name, an `n/m` count (mono), and an `All`/`None` toggle link. It shows `None` when every file in the group is ticked, and `All` otherwise.
- File row: the whole row is the hit target, with `role="checkbox"`. It has an 18px checkbox (radius 5, ticked = #ededea fill with a dark tick), the filename (mono 13px, wraps anywhere), a one-line description (13px #8a8c91), and the size (mono 12px, right). Unticked rows drop to 45% opacity.
- Footnote under the groups, only when relevant. It explains missing files: `No edit files: the assembled edit is off.` / `No _clean copies: noise suppression is off.` / `No toned copy of the edit: tone and levelling are off.`
- Footer (#141416):
  - Left: an `Use this selection every time` checkbox.
  - Right: `Cancel`, and a primary button `Download N files` (`Download 1 file`). When nothing is ticked, the primary button is disabled with the label `Pick a file` (bg #26272b, text #6a6c71).

### 3. Saved selection
- Save the **kinds** of file, not the filenames, so a saved selection still applies across episodes, guests and split parts. The reference normaliser strips the episode/session prefix, the `_partN` suffix, and the person name (swapped for `voice`):
  ```js
  const kindOf = n => n.replace(/^Ep142_(Session_)?/, '').replace(/_part\d+/, '').replace(/^(Tyler|Sam)(_|\.)/, 'voice$2');
  // Ep142_Session_Sam_edit_clean_part2.wav -> voice_edit_clean.wav
  ```
  In the real code, build the kind from the export's own metadata (role + variant + extension), not from a regex on the filename.
- On Download:
  - If the checkbox is ticked, save the kinds of the ticked files.
  - If it's unticked, clear any saved selection.
- On opening Export, if a saved selection exists, tick only files whose kind is in it. Kinds that aren't produced this time (e.g. `_clean` with noise off) are simply skipped, and any new kinds default to unticked.
- `Forget saved` clears the saved selection and unticks the checkbox.
- Where to store it: the prototype uses `localStorage['podstudio-export-saved']`. In the app, store it in the user's settings so it follows them across devices.

## The file list (drives both the picker and the zip)

The zip must contain exactly the ticked files, so the count on the button always matches what's in the zip. Generate the list from the export settings with one function, and use that same function for the picker and for writing the zip.

Default test case (solo, noise on, assembled edit on, tone set, levelling off) gives 11 files:

| Group | File | Condition |
|---|---|---|
| Recording | `{S}_{Person}.wav` | always, per person |
| Recording | `{S}_{Person}_clean.wav` | noise suppression on |
| Recording | `{S}_Pads.wav` | hotkey pads used |
| Recording | `{S}_RoughMix.wav` | pads + Rough mix on |
| Edit | `{S}_{Person}_edit{part}.wav` | assembled edit on |
| Edit | `{S}_{Person}_edit_clean{part}.wav` | edit + noise on |
| Edit | `{S}_{Person}_edit_toned{part}.wav` | edit + tone set + levelling off |
| Edit | `{S}_{Person}_edit_levelled{part}.wav` | edit + levelling on (includes tone) |
| Edit | `{S}_Pads_edit{part}.wav` | edit + pads |
| Publish | `{E}_Episode{part}.wav` | always (from the whole session if the edit is off) |
| Publish | `{E}_Episode{part}.mp3` | always. 192 kbps stereo at a −16 LUFS target, otherwise 128 kbps mono |
| Reports | `{S}_markers.txt`, `{S}_markers.csv`, `{S}_export.txt` | always |
| Reports | `{S}_voice-log.txt` | voice follow logged something |

`{S}` = `Ep142_Session`, `{E}` = `Ep142`. `{part}` is `_part1`, `_part2`… only when Pauses = Split (with the edit on), otherwise empty. A "tone set" means the EQ isn't Flat or the compressor isn't Off.

- **Sizes:** show the real estimated size (duration × format). The prototype uses fixed placeholders.
- **Descriptions:** use the copy in `buildGroups()` in the reference file.

## Implementation notes
- Build this with the existing modal/sheet primitive if Podstudio has one. If not, add one:
  - It needs focus trap, Esc to close, return focus to the trigger, and scroll lock on the page behind it.
  - Reuse it for other dialogs.
- Keep the selection keyed by filename while the modal is open. That way newly produced files (e.g. after the user changes a step and comes back) are ticked by default unless a saved selection says otherwise.
- **Accessibility:**
  - Rows use `role="checkbox"` and `aria-checked`.
  - The dialog has `role="dialog"`, `aria-modal="true"`, and an `aria-labelledby` pointing at the title.
  - Group toggles need an accessible name, e.g. "Select all in The assembled edit".
- Colours and type are the same tokens as the step-flow handoff: #0b0b0c page, #141416 cards, #1c1d20 dividers, #26272b borders, #ededea text, #8a8c91 muted, #6a6c71 faint, and SF Mono for filenames and numbers.

## Files
- `Export Files.dc.html` — the reference prototype. Settings props: `mobile`, `guest`, `pads`, `voiceLog`.
- `screenshots/01-export.png` — the Export step.
- `screenshots/02-export.png` — the picker with everything ticked.
- `screenshots/03-export.png` — the picker with the `To publish` quick pick.
