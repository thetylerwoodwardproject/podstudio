# Handoff: Step flow (Export + related screens)

## Overview
The Export page (`src/pages/episodes/[id]/package.astro`) is too cluttered, and EQ and compression can't remove background noise. It's replaced by a **step-by-step flow**: tabs across the top, one decision per step, and a **sticky bottom bar** with a preview player and Back/Next. The preview always plays the chain *up to the current step*, with a before/after switch for that step.

The same pattern is applied to Mic check, Wrapping up, Calibration, Session saved, Settings → Recording (marker tones) and Script import.

## About the design files
The `.dc.html` files are **design references built in HTML**. They're not production code. Recreate them in the existing Podstudio codebase (Astro + Tailwind v4 `@theme` tokens in `src/styles/global.css`), reusing its components (`Switch`, `Segmented`, `Button`, `SpeakerLabel`, `Waveform`, `LevelMeter`) and its audio libs. Don't ship the HTML.

To view them: open `Export Steps.dc.html` or `Step Flow Mockups.dc.html` in a browser, with `support.js` in the same folder. `Export Flow.dc.html` is the clickable flow; its logic is the `class Component` in the `<script data-dc-script>` block and is the best reference for state.

## Fidelity
- **Export flow (`Export Flow.dc.html`)**: high fidelity and interactive. Match layout, spacing, copy and behavior.
- **Other screens (`Step Flow Mockups.dc.html`, 1a–1g)**: high-fidelity *static* mockups. Match the look; wire up behavior using the Export flow as the model.
- **Font**: the mocks fall back to the system font. Use the codebase's `--font-sans` (Geist) and `--font-mono` (Geist Mono).

## The pattern (build once, reuse)
Build it as three shared components:

1. **`StepTabs`**: a 5-column (or N-column) grid, `max-width: 760px`, centered, 1px `--color-line` bottom border.
   - Each tab has a mono number (`01`, 11px/500, letter-spacing .06em) above a label (14px; 13px and centered on mobile).
   - **Current step**: fg text and a 2px fg underline.
   - **Done step** (index < furthest reached): green `--color-ok` number, muted label, clickable.
   - **Reached but not current**: subtle number, muted label, clickable.
   - **Not reached yet**: `--color-edge-strong` number and label, `disabled`, not clickable.
   - Clicking a tab you've reached goes back to that step. Settings are kept.
2. **`StepPlayer`** (sticky bottom bar, `--color-surface`/#141416 background, 1px `--color-line` top border). It has two layouts:
   - **Desktop** (one row, `max-width: 760px`, padding 16px 20px, gap 16px):
     - Play/pause: a 40px fg circle. Play is a CSS triangle (7/7/12px borders, nudged 3px right); pause is two 4×14px bars.
     - Info block, `flex:1`: the chain text (13px muted, ellipsis) with time on the right (mono 12px subtle), and a 3px progress bar below (`--color-edge` track, fg fill).
     - A/B `Segmented` (30px tall, 13px).
     - A 1×28px `--color-edge` divider.
     - Back is a ghost text button (muted, no border). Next is a primary button (fg background, ink text, 36px, radius 10px).
   - **Mobile** (three rows, padding 14px 16px 20px, gap 14px):
     - Row 1: a 44px play button with the info block.
     - Row 2: the A/B `Segmented` at full width (equal columns, 32px, 14px).
     - Row 3: Back (48px, `--color-raised` background, radius 12px) and Next (flex 1, 48px, primary).
   - Hit targets are at least 44px on mobile.
3. **`StepPage`**: a header (56px), then `StepTabs`, then a scrolling main area (`max-width: 760px`, padding 28px 20px 40px, gap 28px) with a title (26px/500, -0.01em) and lede (14px/1.5 muted), then `StepPlayer`.

Cards: `--color-surface` background, radius 14px, padding 18–20px. Rows inside a card are split by a 1px `--color-line` rule inset 20px. Section labels are 13px/500 muted.

## Screens

### Export (`Export Flow.dc.html`, shown in `Export Steps.dc.html` as 1a desktop / 1b mobile)
The steps go in processing order. **Noise comes before Tone.**

| # | Step | Content | A/B options |
|---|---|---|---|
| 01 | Edit | Card with two switches: Assembled edit, and Marker tones in the full recording (links to Settings → Recording). Below it, a "Pauses in the edit" choice of 3 cards: Cut / Keep / Split. The choice fades to 40 % when Assembled is off. | Raw / Edit |
| 02 | Noise | A room-noise card showing the measured noise floor (mono, `--color-warn`) and a "Use 40 %" button. Then a Suppression slider (0–100, step 5, labelled Off/Gentle/Strong) with a background reduction bar in `--color-ok` (≈ −0.4 dB per %). Then "How to judge it" help text and a DeepFilterNet3 credit. | Original / Cleaned / **Removed** (plays only what's being taken out) |
| 03 | Tone | A speaker chip, and a segmented control switching between Graphic EQ and Compressor. EQ: a response-curve graph (150px), presets (Flat, Warm, Clear, De-mud, Radio), and 10 vertical bands from 31 Hz to 16 kHz at ±12 dB (drag to set, double-click to reset; editing a band changes the preset to Custom). Compressor: Off/Light/Medium/Heavy with help text. | Before / With tone |
| 04 | Loudness | Target segmented control: Stereo −16 / Mono −19 / Off (peaks only). Three readouts (Measured, After, True peak). A "Level each speaker" switch. | Before / Levelled |
| 05 | Export | "Your chain" summary: 4 rows (number, label, value, and a "Change" link that jumps to that step). "In the zip": Episode file switch, MP3 switch, and Raw WAV with markers marked ALWAYS. | Raw / Final |

- Next shows "Next: {label}". On the last step it shows "Export N files". N counts the raw WAV plus markers (3), the edit (+1), the _clean copies (+2 if noise is on), the episode (+1) and the MP3 (+1).
- The chain text is built from the enabled stages, e.g. `Edit → Noise 40 % → Tone → −19 LUFS`. For the "before" option it drops the current stage. For Noise → Removed it shows "Only the removed noise".
- Changing step resets the A/B choice to "after" and the playhead to 0.

### Other screens (`Step Flow Mockups.dc.html`)
- **1a / 1b, Mic check**: tabs Input → Level → Test → Noise. The Noise step matches Export step 02 but runs on the 10-second test recording. **The chosen amount carries over to Export.** The final button is "Start recording".
- **1c, Wrapping up** (`wrap.astro`): tabs Uploads → Line up → Review. Two track rows with speaker dots, and a guest offset stepper (± buttons, in ms). A/B is Host / Guest / Both.
- **1d, Calibration**: tabs Speaker 1 → Speaker 2 → Result. Two speaker-colored tone curves and per-speaker gain readouts. A/B is Before / Corrected. The final button is "Save".
- **1e, Session saved** (`saved.astro`): no tabs. The noise suppression switch is removed. The shared `StepPlayer` has Original / Cleaned options and an "Export" primary button.
- **1f, Settings → Recording, marker tones** (`components/settings/Recording.astro`): no tabs. An "Add tones" switch, a pitch segmented control (Low / 1 kHz / High), and an "Under your voice" duck slider (dB). The player plays an 8-second sample retake with Without / With tone. There's no Next button.
- **1g, Script import** (`ImportDialog.astro` / `script.astro`): tabs Paste → Sections → Review. The Sections list has number, name and "N lines · ~m:ss". The bottom bar has **no player**; it shows the section count and read time with Back/Next.

## Wiring the audio
- Preview player: `src/lib/player.ts`. Keep one audio element; switching A/B swaps the buffer at the same playhead position.
- Noise: `src/lib/audio/denoise.ts`. Use `previewTake(meta, amount, 30, from)` for Export and Session saved, and `previewSamples(...)` for Mic check. **Removed** = original minus cleaned, sample by sample. `denoiseTake` runs at export time; the result name comes from `variantName(amount)`.
- Tones: `src/lib/audio/tones.ts`. Assembly: `src/lib/audio/assemble.ts`. Zip: `src/lib/zip.ts`.
- EQ, compressor and loudness don't have libs yet. Build the preview with a Web Audio graph: 10 × `BiquadFilterNode` (peaking, Q≈1.4) → `DynamicsCompressorNode` → gain. Measure LUFS offline.

## State (per flow)
`step`, `reached` (furthest step unlocked), `ab` (index into that step's A/B labels), `playing`, `t`. Export settings: `assembled`, `tones`, `pause` (cut|keep|split), `ns` (0–100), `toneTab`, `preset`, `bands[10]`, `comp`, `target`, `level`, `episode`, `mp3`. Keep settings per episode (session store) so going back never loses them. Save the noise amount from Mic check as the default `ns`.

## Tokens used
- Colors: ink `#0b0b0c`, surface `#141416` (close to `--color-surface` #121214; either is fine), raised `#16171a`/`#1c1c1f`, line `#1c1d20`/`--color-line`, edge `#26272b`/`--color-edge`, edge-strong `#3a3b3f`, fg `#ededea`, muted `#8a8c91`, subtle `#6a6c71`, rec `#ff453a`, ok `#30d158`, warn `#ff9f0a`, speaker colors from `--spk-*`.
- Radii: cards 14px, buttons and segmented controls 10px (inner segments 7px), mobile buttons 12px, pills 999px.
- Type: title 26/500, body 14, secondary 13, mono labels 11/500 +.06em, readouts mono 22.

## Files
- `Export Steps.dc.html`: presents the Export flow on desktop (1a) and mobile (1b).
- `Export Flow.dc.html`: the interactive Export flow (props: `mobile`).
- `Step Flow Mockups.dc.html`: static mockups 1a–1g.
- `support.js`: runtime needed to open the `.dc.html` files.
- `screenshots/`: static reference images.
  - `export-01-edit` … `export-05-export`, each with a `-mobile` version.
  - `1a-mic-check`, `1b-mic-check-mobile`, `1c-wrapping-up`, `1d-calibration`, `1e-session-saved`, `1f-marker-tones`, `1g-script-import`.
  - In the mocks, the player shows 0:19 in the header and Noise at 0 %. Those values are just starting state, not real data.
