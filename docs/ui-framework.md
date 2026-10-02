# Podstudio UI framework

The current token implementation is in `src/styles/global.css`. The original
[`design/Podstudio_UI_Framework.dc.html`](design/Podstudio_UI_Framework.dc.html)
is a reference for existing layouts; its dark-only palette is being replaced
by the light/dark facelift described below.

## Theme foundation

The interface follows the device's light or dark preference until the user
chooses a theme. The choice is cached locally, applied before paint, and synced
through account settings. It is separate from the prompter reading theme.
Light surfaces use indigo `primary` actions; dark surfaces use lime `primary`
actions. Recording and destructive states keep `rec` red. Use semantic tokens
for surfaces, text, borders and actions, so each screen works in both themes.
`src/components/shadcn/` holds locally adapted shadcn-svelte components;
Astro still owns routes and simple markup, while Svelte owns interactive
panels. The full screen migration and shared audio transport remain planned.
The account theme selector belongs in Settings → General rather than the
shared page header. In the desktop editor, use the local shadcn-svelte Button,
Input, Slider, Dropdown Menu and Alert Dialog primitives for suitable controls;
the synchronized editable waveform remains a Podstudio component.
The clip's position and source boundaries live in an anchored Popover rather
than a permanent row above the timeline. Import progress uses a lower-right
status card that does not cover the waveform or transport. Alert Dialog footers
use `surface`, not `muted`, because `muted` is a text color in Podstudio's
palette. Destructive actions use a red outline in both themes.
The editor uses the local shadcn-svelte Context Menu for waveform and range
actions. Its purpose-built mono/stereo track meters show processed sample peaks
in dBFS during playback; the source waveform is not a level meter. Keep the
meter compact within each track header and label its numeric readout `dBFS`.
The editor footer reserves a compact, stacked horizontal L/R master meter beside
the shortened scrubber. It measures the actual preview output and uses the same
dBFS scale and colors as the track meters. Keep the larger elapsed and duration
labels directly on either side of the scrubber, before the master meter.
The editor FX sheet offers Clean, Shape and Boost knobs in Simple view, with a
Shape preset choice. Advanced exposes ten vertical shadcn sliders and exact
compressor controls. The knobs adapt More Shadcn Svelte's MIT-licensed design;
the existing calibrated dBFS meters remain authoritative. More Shadcn's Audio
Wave is decorative, so it must not represent measured audio levels. Save
feedback uses a top-right Sonner toast below the shared header, with a semantic
Status Dot; setup step flows adapt More Shadcn's Stepper pattern. Astro form
fields and breadcrumbs use server-rendered shadcn structure, and episode
pagination appears once more than ten entries match the current filter.
Stateful checkboxes use the local shadcn-svelte Checkbox, including editor FX,
export options, pad ducking and marker-tone choices. Static Astro forms use the
same token and focus treatment with a native checkbox so they submit without
hydration. Authenticator and invite codes use shadcn-svelte Input OTP: a single
accessible input drives six visible cells, paste and one-time-code autofill.
Preset selects in the FX sheet reserve enough width and right padding for the
native arrow in both themes.

### Component choice during the migration

The [Phase 0 inventory](shadcn-phase-0-inventory.md) records current callers,
state owners, hooks and screenshot baselines. Use the locally adapted shadcn
component when a Svelte panel already owns the interaction:

| Interaction | Component |
|---|---|
| Modal task; consequential confirmation | Dialog or Sheet; Alert Dialog for confirmation |
| One-of-many submitted choice; distinct content panels | Radio Group; Tabs for panels |
| Immediate on/off state; independent form choice | Switch; Checkbox for the form choice |
| Continuous value; exact numeric value | Slider; Input with a visible label for precision |
| Short-lived progress; persistent error; brief success | Progress; Alert; Sonner, respectively |
| Plain form options; searchable choices | Native Select; Select/Combobox only when needed |
| Icon-only action | Button with an accessible name and Tooltip |

Keep Astro links and static form controls server-rendered, with the same
tokens, dimensions and focus treatment. A copied shadcn component must map
its semantic colors through `global.css`: `background` → `page`, `card` →
`surface`, `popover` → `sheet`, `secondary` → `control`, `accent-foreground` →
`accent-fg`, `muted-foreground` → `text-2`, `destructive` → `rec`.
Podstudio's legacy `muted` means secondary text, so copied `bg-muted` requires
an explicit surface translation. Do not overwrite the global CSS with CLI
defaults or add Svelte hydration solely to display a static card or button.

## In the code

| Part | Where |
|---|---|
| Tokens (colours, fonts) | `src/styles/global.css` `@theme`: `page`, `surface`, `nav` (raised), `control`, `divider`, `border`, `track-off`, `handle`, `text`, `text-2`, `text-3`, `rec`, `warn`, `ok`, `info`. Older names (`muted`, `subtle`, `line`, `edge`, `raised`, `fg`…) map to the same values; use the framework names in new code. |
| Type utilities | `page-title` (26 / 500), `section-label` (13 / 500 text-2), `help` (13 / 1.5 text-2), `eyebrow` (the mono 11 caps tag) |
| Components | `src/components/ui/`: `Button` (primary, secondary, ghost, destructive, record, retake; `sm` 36 / `lg` 48), `Segmented`, `Select`, `Switch`, `CheckChip`, `Checkbox`, `Card` (with `label` and `rows`), `Row`, `Block`, `Callout`, `Kbd`, `StatusRow`, `CodeBlock` |
| Text inputs | `inputClass` in `src/lib/ui.ts` |
| Sliders | plain `<input type="range">`: styled globally, `src/lib/range-fill.ts` keeps the fill in step |
| Meter | `src/lib/audio/meter.ts` for scale/ballistics; `src/lib/audio/editor-meter.ts` for processed track peaks |
| Settings page | `src/components/settings/Section.astro` for the title; a `Card` per group, rows inside |
| Graphs | `FreqGraph` and `StatusCard` in `src/components/ui/`; `lib/graph.ts` (axes, grid, paths; tested) and `lib/graph-view.ts` (`mountGraph`, draws the SVG). Live example at `/ui`. |

Before adding a one-off style, check whether a component above already does it.

### Svelte for stateful panels

Pages, layouts and simple components are `.astro`. A panel with a lot of
state that changes as you use it (several controls that affect each other,
graphs that follow the settings) is a Svelte 5 component in
`src/components/`, like `app/ExportFlow.svelte`:

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
- Existing panels move to Svelte only when they need real work. Recording
  moves in small pieces when needed; timing-critical capture, meters and
  prompter scrolling stay plain TypeScript. Follow the
  [screen-by-screen rules](handoff.md#svelte-or-astro-the-rule).

## Fonts
- Sans: `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', system-ui, sans-serif`
- Mono: `ui-monospace, 'SF Mono', Menlo, monospace`. Use it for numbers, units, times, key hints and caps tags.
- The prompter keeps its own reading fonts (Atkinson Hyperlegible, OpenDyslexic).

## Neutrals
| Token | Hex | Use |
|---|---|---|
| page | #0b0b0c | App background, input fill |
| surface | #141416 | Cards, docks, a dialog's footer |
| sheet | #0f0f11 | A dialog or bottom sheet over the page |
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

## Dialogs
`ui/Sheet.svelte`: a dialog over the page on `sheet` (#0f0f11), 1px border,
radius 16, 640 max, with a fixed header (title 18/500, a mono summary under
it, × to close) and footer on surface, and a body that scrolls. On a phone
it's a bottom sheet (full width, 88 % high at most, radius on top only,
buttons 44). Esc and a click outside close it; focus stays inside and goes
back to what opened it, and the page behind doesn't scroll. A row you tick is
the whole row (`role="checkbox"`): an 18px box (radius 5, text fill when
ticked), and unticked rows drop to 45 %. Design: `design/export-files/`.

## Step flow
For a screen with several decisions that build on each other (Export, Mic
check, Wrapping up, Script import). Design: `design/step-flow/`.

- **One decision per step**, in the order things happen. The title (26/500)
  and a one-line lede say what the step is for.
- **Tabs** (`steps/StepTabs.svelte`): a mono number over the label. Current is
  text with a 2px underline, done has a green number, reached is text-3 and
  clickable, not yet reached is handle and disabled. A screen that checks
  rather than gates (Mic check) leaves every tab open.
- **Bar** (`steps/StepPlayer.svelte`), pinned at the bottom on surface:
  - the editor transport: play/pause, the current cumulative mix, current time,
    duration and timeline zoom. Long sessions use rolling render windows without
    exposing those buffers as a playback limit.
    with the time and a 3px progress line;
  - the step's before and after as a segmented control (Raw / Edit, Original /
    Cleaned / Removed, Before / With tone …). Switching keeps the playhead; a
    new step starts on "after", at 0;
  - Back (ghost) and Next (primary), "Next: Tone". The last step's button says
    what it does: "Export 11 files", "Start recording", "Import to Ep. 142";
  - no player where there's nothing to hear: a summary instead ("4 sections ·
    64 lines · ~8:15 read time").
  - One row on a laptop; on a phone the player, the choice at full width, then
    Back and Next at 48.
- **Page** (`steps/StepPage.svelte`): tabs, a scrolling column (760 max,
  28/20/40 padding, 28 between blocks), the bar.
- **The preview plays everything up to the step.** Audio work stays in
  `lib/audio` (`chain-preview.ts` for Export, `preview-player.ts` to play).
- **Export completion:** after the browser download starts, show “Your export
  is ready” with actual zip size and file count. Focus the heading and scroll
  it into view; turn the final step number green. The bottom bar uses a summary
  and **Back to sessions**. Offer **Download again** and **Adjust export
  settings**, keeping measured results and sync details below. Don’t claim the
  file finished saving or redirect automatically. Failed exports stay in the
  export flow.
- **Settings survive going back** and a reload (Export keeps them per take for
  the browser tab).
- Screens that are Astro markup with a script use `lib/step-shell.svelte.ts`,
  which mounts the same tabs and bar and hands back their state.

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
