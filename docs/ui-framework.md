# Podstudio UI framework

Every screen follows this, old and new. The source of truth is
[`design/Podstudio_UI_Framework.dc.html`](design/Podstudio_UI_Framework.dc.html)
(open it in a browser); this is the short version, and where each part lives
in the code.

## In the code

| Part | Where |
|---|---|
| Tokens (colours, fonts) | `src/styles/global.css` `@theme`: `page`, `surface`, `nav` (raised), `control`, `divider`, `border`, `track-off`, `handle`, `text`, `text-2`, `text-3`, `rec`, `warn`, `ok`, `info`. Older names (`muted`, `subtle`, `line`, `edge`, `raised`, `fg`…) map to the same values; use the framework names in new code. |
| Type utilities | `page-title` (26 / 500), `section-label` (13 / 500 text-2), `help` (13 / 1.5 text-2), `eyebrow` (the mono 11 caps tag) |
| Components | `src/components/ui/`: `Button` (primary, secondary, ghost, destructive, record, retake; `sm` 36 / `lg` 48), `Segmented`, `Select`, `Switch`, `CheckChip`, `Checkbox`, `Card` (with `label` and `rows`), `Row`, `Block`, `Callout`, `Kbd`, `StatusRow`, `CodeBlock` |
| Text inputs | `inputClass` in `src/lib/ui.ts` |
| Sliders | plain `<input type="range">`: styled globally, `src/lib/range-fill.ts` keeps the fill in step |
| Meter | `src/lib/audio/meter.ts` |
| Settings page | `src/components/settings/Section.astro` for the title; a `Card` per group, rows inside |
| Graphs | `FreqGraph` and `StatusCard` in `src/components/ui/`; `lib/graph.ts` (axes, grid, paths; tested) and `lib/graph-view.ts` (`mountGraph`, draws the SVG). Live example at `/ui`. |

Before adding a one-off style, check whether a component above already does it.

### Svelte for stateful panels

Pages, layouts and simple components are `.astro`. A panel with a lot of
state that changes as you use it (several controls that affect each other,
graphs that follow the settings) is a Svelte 5 component in
`src/components/`, like `app/ToneCard.svelte`:

- Style it with Tailwind classes and the tokens above, the same as `.astro`
  files. Write class names out in full; for values only known at runtime
  (speaker colours, positions) use `style:` bindings.
- Keep audio, measurement and file work in `src/lib/` as plain TypeScript,
  and pass it in. The component holds UI state and reports changes
  (`onchange`); the page owns the data.
- When the data only exists in the browser (takes in OPFS), the page script
  mounts it with `mount()` from `svelte`, loaded with a dynamic `import()` so
  the page opens without it.
- Keep the `data-*` hooks the browser tests use.
- `npx svelte-check` must pass, as well as `npx astro check`.
- Existing panels move to Svelte only when they need real work. The recording
  screen and `lib/audio` stay as they are.

## Fonts
- Sans: `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', system-ui, sans-serif`
- Mono: `ui-monospace, 'SF Mono', Menlo, monospace`. Use it for numbers, units, times, key hints and caps tags.
- The prompter keeps its own reading fonts (Atkinson Hyperlegible, OpenDyslexic).

## Neutrals
| Token | Hex | Use |
|---|---|---|
| page | #0b0b0c | App background, input fill |
| surface | #141416 | Cards, sheets, docks |
| raised (`nav`) | #16171a | Active nav item |
| control | #1c1c1f | Secondary buttons, avatar, selected chip |
| divider | #1c1d20 | Header, sidebar, row dividers |
| border | #26272b | Inputs, segmented, tags, slider track |
| track-off | #2a2b2f | Toggle off, dashed empty state |
| handle | #3a3b3f | Grab handle, hover border |
| text | #ededea | Primary type, selected fill |
| text-2 | #8a8c91 | Help, secondary |
| text-3 | #6a6c71 | Meta, units, tags |

## Signal colours
- Record `#ff453a`: recording, hot level, destructive
- Warn `#ff9f0a`: Retake, target zone, reconnecting
- OK `#30d158`: saved, connected
- Info `rgba(110,168,255,0.7)`: Ad-lib ranges

Speaker colours (oklch) are only for dots, meter rings, talk-time bars and a channel's curve on a graph. Graphs add pink, `oklch(78% 0.13 330)` (`spk-pink`), for a right channel.

## Type
| Role | Spec |
|---|---|
| Page title | 26 / 500 / −0.01em |
| Brand | 17 / 600 |
| Body large | 15 |
| Body | 14 |
| Help | 13 / lh 1.5 / text-2 |
| Section label | 13 / 500 / text-2 |
| Value | mono 13 |
| Tag | mono 11 / 500 / caps / 0.06em |

## Spacing and radius
- Spacing: 2, 4, 8, 12, 16, 20, 24, 40, 48
- Radius: 4 (key hint, checkbox), 7 (segment inside), 10 (input, small button), 12 (large button), 14 (card), 999 (pill, toggle)

## Components
- **Select / input:** height 40, radius 10, fill page, 1px border.
- **Segmented:** page-fill track with 3px padding and radius 10. The selected option is text fill with page-coloured text at weight 500. Unselected options are transparent with text-2.
- **Toggle:** 40×24, 18px knob. On: text track with a page knob. Off: track-off with a text-2 knob.
- **Slider:** 4px border track, text fill, 16px text knob. The value sits top-right in mono 13.
- **Check chip:** height 34, radius 9, 1px border. Selected: control fill, handle border, filled 14px checkbox.
- **Buttons:**
  - Large: height 48, radius 12. Record is red and Retake is amber; everything else uses control.
  - Small: height 36, radius 10. Primary is text fill; secondary is outline; ghost is text-2; destructive is a red outline.
- **Card:** surface, radius 14, no border or shadow, padding 20. Rows are 18/20 with inset dividers. A 13/500 section label sits above each card group, and sections are 40 apart.
- **Status pill:** mono 13 caps. While recording it uses red at 15% behind red text, and a 3px red bar runs across the top of the screen.
- **Meter:** −60 to −18 green, −18 to −6 amber (target), above −6 red. Unlit segments are the zone colour at 20% over #1f2023; the peak hold is text.

## Graphs and calibration
- **Plot area:** `plot` (#16171a), a step above the card. Log frequency axis from 20 Hz to 20 kHz. dB axis ±24, with a line every 6. Labels are mono 10 in text-3.
- **Grid:** decade and 1-2-5 lines are `border` (#26272b), minor lines `divider` (#1c1d20), and the 0 dB line `handle` (#3a3b3f).
- **Curves:**
  - Target is text (#ededea) at 2px.
  - Measured uses the channel's speaker colour at 2px: Left is teal, Right is pink.
  - Live spectrum is a 1.25px line, amber that turns red at the extremes, at 85% opacity, behind the curves.
- **Status card:** 16px spinner (track-off ring with an amber arc), then the title with help text. A mono caps tag on the right can show a step or generation (GEN 0).
- **Channel panel:**
  - Speaker dot with the channel name and "Speaker N of 2".
  - 14px vertical level bar in the speaker colour.
  - Mono 28 dB readout.
  - Amber 4px progress bar.
  - "Stop calibration" as a destructive outline button, never solid red.

## Shell
- Header: 56 tall. Brand, then the page name in text-2, then the avatar on the right.
- Sidebar: 220 wide, items 36 tall, radius 8.
- Content: max width 720 for settings and single-column pages.

## Writing
- Use sentence case and plain words.
- Say what a setting does.
- Put units in mono with a space before them: `48 kHz`.
- Use a real minus sign: `−18`.

## Screen designs
Designs for single screens (`design/Settings_Recording.dc.html` and the
handoffs before it) are built on this framework. Where a screen design and
this file disagree, ask; otherwise the framework wins.
