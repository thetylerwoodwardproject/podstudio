# Shadcn migration: Phase 0 inventory and contract

This is the source-level baseline for [the phased migration](shadcn-component-migration.md).
Inventory date: 2026-09-30. A row lists every file that imports that custom
control family; repeated controls within one file share its state owner. Raw
HTML controls are grouped by surface below. Later phases should retire a custom
component only after its callers and browser-test hooks have moved.

## Components currently active

| Component | App use | State owner |
|---|---|---|
| Shadcn Button, Dropdown Menu, Alert Dialog, Popover, Input, Slider | `app/EditorFlow.svelte` | Editor Svelte project, gesture, playback, and overlay state |
| Shadcn Button | `app/RecordingReview.svelte` | Mobile review Svelte playback state |
| Copied but not yet used by app screens | Shadcn Dialog, Progress, Tooltip, Hover Card; community audio controls | None; do not count these as migrated screens |

## Custom control callers

Paths in these tables are relative to `src/`. The interaction owner is the
file's Svelte state for `.svelte` and its page script or native form for
`.astro`; audio and persistence still live in `src/lib/` and `server/`.

| Family | Current callers | Planned primitive and behavior to preserve |
|---|---|---|
| `ui/Sheet.svelte` | `app/EditorFlow.svelte`, `settings/PadsEditor.svelte`, `app/ExportPicker.svelte` | Sheet; desktop centered panel, phone bottom sheet, Escape/backdrop, fixed footer, focus return, draft Cancel. `data-picker` and `data-pad-editor-sheet` remain. |
| `ui/Segmented.svelte` | `settings/PadsEditor.svelte`, `settings/MarkerTones.svelte`, `app/ExportFlow.svelte`, `steps/ToneStep.svelte`, `steps/StepPlayer.svelte` | Radio Group for form choices; Tabs for panel views; Toggle Group only for pressed actions. Preserve `data-layer-picker`, `data-kind-picker`, `data-mode-picker`, `data-tone-view`, `data-tone-presets`, and `data-ab`. |
| `ui/Segmented.astro` | `pages/voice.astro`, `pages/episodes/[id]/studio.astro`, `settings/Recording.astro`, `settings/Domain.astro`, `settings/Prompter.astro` | Keep native form radios until an interactive island is warranted. Preserve submitted names/values and `data-*` hooks. |
| `ui/Switch.svelte` | `settings/MarkerTones.svelte`, `app/ExportFlow.svelte` | Switch or Checkbox according to whether the control is an immediate on/off state or a submitted choice. Preserve tone/export values and live preview. |
| `ui/Switch.astro` | `settings/ToggleRow.astro`, `settings/Recording.astro` | Keep native checkbox form behavior and autosave wiring; match Switch styling without hydrating the whole Settings page. |
| `ui/Select.astro` | `app/MicCheck.astro`, `settings/Ai.astro`, `settings/General.astro`, `settings/Recording.astro` | Native Select styling and native keyboard behavior; preserve labels and submitted values. |
| `ui/Checkbox.astro` | `pages/signin/index.astro`, `pages/signin/verify.astro` | Native checkbox until these auth forms gain a justified Svelte island. Preserve trusted-device values. |
| `ui/OtpInput.astro` | `pages/signin/verify.astro`, `pages/setup/two-factor.astro`, `pages/join.astro` | Evaluate Input OTP against paste, Backspace, arrows, one-time-code autofill, six-digit and alphanumeric codes. Preserve `data-otp` and form serialization. |
| `ui/Button.astro` | `pages/index.astro`, `pages/join.astro`, `pages/unsupported.astro`, `pages/voice.astro`, `pages/signin/index.astro`, `pages/signin/verify.astro`, `pages/setup/account.astro`, `pages/setup/domain.astro`, `pages/setup/two-factor.astro`, `pages/episodes/[id]/script.astro`, `pages/episodes/[id]/package.astro`, `pages/episodes/[id]/studio.astro`, `pages/episodes/[id]/sessions.astro`, `pages/episodes/[id]/recovered.astro`, `settings/Domain.astro`, `settings/Ai.astro`, `settings/Security.astro` | Keep plain links and form buttons server-rendered. Share Button dimensions, variants and focus styling; retain navigation and form submit behavior. |
| Static `ui/Card.astro`, `ui/Field.astro`, `ui/Avatar.astro`, `ui/Callout.astro`, `ui/Kbd.astro` | Settings cards; sign-in/setup fields; top bar avatar; setup/library callouts; Controls shortcut hints | Align Card/Field/Avatar/Alert/Kbd patterns in Phase 5. No client hydration for static content. |

## Direct HTML control hotspots

| Surface and state owner | Existing controls and behavior | Hooks or exceptions |
|---|---|---|
| `app/EditorFlow.svelte` and `app/EditorFxControls.svelte` | Svelte-owned track buttons, range sliders, checkboxes, advanced number inputs and preset selects. Audio preview remains a callback into the existing renderer. | Preserve `data-editor`, `data-track-fx`, `data-clip`, `data-import-status`, `data-playback-status`, `data-export-open`. Timeline drag/trim and waveform are Podstudio-specific. |
| `settings/PadsEditor.svelte` | Svelte draft sheet; native session/library selects, file inputs, pad-color radios, gain/trim/duck inputs and preview. Save is atomic; other settings autosave. | Preserve `data-pad-editor-sheet`, `data-clip-upload`, `data-library`, `data-colors`, `data-d-*`. Keep file input and server-sync logic. |
| `settings/MarkerTones.svelte` | Tone-kind checkboxes, isolated preview buttons and range inputs; custom disclosure. | Preserve `data-tone-*`. The clean tone generator stays in audio code. |
| `app/ExportFlow.svelte`, `app/ExportPicker.svelte`, `steps/ToneStep.svelte`, `steps/StepPlayer.svelte` | Svelte-owned legacy export choices, sliders, playback and file selection. | Legacy route remains for compatibility. Keep player logic and file selection semantics; do not replace with a single-file audio widget. |
| `pages/episodes/[id]/recording.astro`, `pages/guest.astro`, `pages/producer.astro`, `app/PadRail.astro` | Page-script-owned controls and statuses around live capture, guests, room state and pads; recording has an end-session `<dialog>`. | Preserve `data-end-dialog`, `data-toast`, recorder shortcuts and timing. No Svelte ownership of microphone capture, meters or pad trigger timing. |
| `app/ImportDialog.astro`, `pages/episodes/[id]/recovered.astro`, `pages/episodes/[id]/export-legacy.astro` | Native `<dialog>` elements with page-script state. | Migrate only where an island can own the complete interaction without changing import or recovery. |
| `pages/signin/*`, `pages/setup/*`, `pages/join.astro` | Astro form inputs, checkboxes, radio choices and OTP script. | Preserve native validation, Enter submission, password managers, autofill and authentication redirects. |
| `settings/*.astro`, `pages/episodes/[id]/studio.astro`, `pages/index.astro`, `pages/episodes/[id]/package.astro` | Plain form selects, radios, checkboxes, ranges, inputs and textareas with page scripts or native submission. | Preserve autosave events, studio format selection, theme choice and `data-ui-theme`. Keep Astro markup unless interaction merits a Svelte island. |
| `app/RecordingReview.svelte`, `app/SavedPlayer.svelte`, `app/MicCheck.astro` | Review playback controls, scrubbing, source selection and mic calibration. | Preserve bounded audio playback, touch scrubber and mobile-only review. Meters remain purpose-built. |

The raw-control scan also finds direct `<select>` in `pages/guest.astro`,
`pages/episodes/[id]/recording.astro`, `app/EditorFlow.svelte`,
`app/EditorFxControls.svelte`, `settings/PadsEditor.svelte`, and
`ui/ThemePicker.astro`; direct `<textarea>` in
`pages/episodes/[id]/script.astro` and `settings/Ai.astro`. These are covered
by the owning surface rows above.

## Podstudio adapter contract

| Shadcn semantic class | Podstudio token | Use |
|---|---|---|
| `background`, `foreground` | `page`, `text` | Main surface and primary text |
| `card`, `card-foreground` | `surface`, `text` | Grouped content |
| `popover`, `popover-foreground` | `sheet`, `text` | Floating overlays |
| `primary`, `primary-foreground` | `primary`, `primary-fg` | Indigo on light; lime on dark |
| `secondary`, `secondary-foreground` | `control`, `text` | Secondary actions |
| `accent`, `accent-foreground` | `accent`, `accent-fg` | Hover and active menu items |
| `input`, `ring` | `border`, `primary` | Form edge and keyboard focus |
| `muted-foreground`, `destructive` | `text-2`, `rec` | Help text and destructive controls |

`src/styles/global.css` owns these mappings. Podstudio's older `muted` token
means secondary **text**, so copied `bg-muted` must be translated to
`bg-control` or `bg-surface`; never assume the shadcn meaning. New component
code must reference `--color-*` tokens, not undefined raw variables such as
`--secondary`. Do not copy shadcn's default CSS over Podstudio's theme.

The current shadcn Button and Input defaults are 32 px high while Podstudio's
standard small button/input heights are 36/40 px. Later screen phases should
adapt sizes at the component boundary and review layouts; Phase 0 keeps the
existing screen geometry. Minimum touch targets, disabled states, visible
focus, light/dark contrast and reduced-motion behavior are acceptance checks
for every newly migrated component.

The editor's Dropdown Menu and clip Popover use `preventScroll={false}`. These
small overlays must not lock body pointer events: an immediately following
waveform drag otherwise can hit the page root instead of its clip. The browser
suite checks that menus release pointer events before direct dragging.

Token contrast spot-checks (foreground/background, WCAG relative luminance):
dark primary 13.20:1, light primary 7.15:1; dark accent 6.10:1, light accent
9.44:1; dark secondary text on surface 8.71:1, light 6.84:1; dark destructive
text on sheet 5.00:1, light destructive text on surface 4.72:1. These verify
the baseline colors, not every future hover or disabled state.

## Baseline screenshots

Tracked references in `docs/images/shadcn-baseline/`:

| Surface | Light | Dark |
|---|---|---|
| Desktop editor | `editor-light.png` | `editor-dark.png` |
| Desktop Settings → General | `settings-desktop-light.png` | `settings-desktop-dark.png` |
| Phone Settings → General | `settings-phone-light.png` | `settings-phone-dark.png` |

The browser tests retain original `data-*` hooks and generate these views
using installed Chrome at 1360×900 desktop and 390×844 phone viewports. The
desktop editor is intentionally not presented as a phone editor.

## Credits and licenses

`public/vendor/shadcn-svelte/LICENSE.md`, `public/vendor/bits-ui/LICENSE`,
and `public/vendor/more-shadcn-svelte/LICENSE` are present. README and Settings
→ About & credits already link them. Phase 0 adds no third-party code; later
phases must review and credit each newly copied component or dependency.
