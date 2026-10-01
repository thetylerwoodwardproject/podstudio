# Shadcn component migration plan

## Goal and boundaries

Make Podstudio's controls and overlays consistent across the editor, settings,
recording, setup, and account screens using locally adapted components from the
[shadcn-svelte catalog](https://www.shadcn-svelte.com/docs/components). Keep
Astro routes, the current light/dark semantic tokens, recordings, project data,
keyboard behavior, and browser-test `data-*` hooks. This is a component and
interaction pass, not a change to recording, rendering, or export algorithms.

The editor already uses shadcn Button, Dropdown Menu, Alert Dialog, Popover,
Input, and Slider; Recording Review uses Button. Dialog, Progress, Tooltip,
Hover Card, and community audio controls are present locally but are not yet
used by app screens. The other screens still use custom controls in
`src/components/ui/` or page-specific markup.

Shadcn-svelte components are Svelte components. Preserve server-rendered Astro
forms and links where no client interaction is needed; give them the same
tokens, dimensions, and focus treatment without hydrating an entire page just
to render a button or card. Introduce a small Svelte island when it owns a
real interaction. Keep Podstudio's multitrack waveform, meters, prompter,
capture, and rolling audio player purpose-built. Do not substitute the copied
single-file community player for the editor's synchronized transport.

## Phase 0 — Inventory and component contract

Completed in [the Phase 0 inventory and contract](shadcn-phase-0-inventory.md),
including tracked light/dark editor and Settings reference screenshots.

1. Record every custom Button, Select, Switch, Checkbox, Segmented, Sheet,
   status, dialog, and slider use, including its page, state owner, keyboard
   behavior, and test hooks. Mark each as interactive Svelte or plain Astro.
2. Define one Podstudio adapter style for shadcn components using `page`,
   `surface`, `sheet`, `control`, `border`, `text`, `primary`, `rec`, and the
   other semantic tokens. Check light/dark contrast, focus rings, touch size,
   and reduced motion. Do not run CLI initialization over `global.css`.
3. Keep a short mapping in `docs/ui-framework.md` of which component to use
   for each interaction. Inventory copied component licenses before adding
   more and update README and Settings → About & credits as needed.

**Done when:** the migration targets and exceptions are explicit, baseline
desktop/phone screenshots exist, and no theme or test hook changes are needed
to start the screen migrations.

## Phase 1 — Overlays and confirmation flows

1. Replace the custom Svelte `Sheet.svelte` in the editor, pad configuration,
   and export picker with the native shadcn Sheet. Adapt it to the current
   centered desktop panel and phone bottom-sheet behavior, fixed actions, and
   independently scrolling body. Use Drawer on phones only if Sheet cannot
   preserve the required gesture, focus, and safe-area behavior cleanly.
2. Use Dialog for non-destructive modal tasks and Alert Dialog for irreversible
   or consequential confirmation. Migrate the FX reset and end-session
   confirmation. Treat the script-import dialog as a separate Svelte island
   only if its state and file handling can move without changing its workflow.
3. Verify Escape, backdrop, focus return, nested overlays, and cancellation of
   unsaved draft settings. Keep microphone capture and audio processing outside
   the overlay components.

**Done when:** every migrated overlay has the same header/footer layout and
focus behavior in both themes, and closing a draft does not silently save it.

## Phase 2 — Stateful audio and settings controls

1. In `PadsEditor.svelte`, replace one-off inputs, switches, sliders, selects,
   color radios, and segmented choices with Input, Switch, Slider, Select or
   Native Select, Radio Group, and Field/Label as their semantics require.
   Preserve pad preview, upload, draft Save/Cancel, and all six color values.
2. In `EditorFxControls.svelte`, use Tabs for Simple/Advanced views, Switch or
   Checkbox for bypass and leveling, Slider for continuous controls, and
   Input/Native Select for precise compressor values and presets. Keep custom
   advanced settings intact when collapsing the view.
3. Update `MarkerTones.svelte`, the Svelte export controls, and other stateful
   settings panels in the same pattern. Use Radio Group for one-of-many form
   choices; use Toggle Group only for toolbar-like pressed actions. Do not turn
   distinct content panels into radio buttons merely to match a visual style.

**Done when:** the migrated controls retain their saved values, preview sound,
form labels, keyboard operation, and existing server synchronization behavior.

## Phase 3 — Progress, errors, and transient feedback

1. Use Progress for measurable media transfer and processing; pair it with
   readable stage text for decode, conversion, upload, and server confirmation.
   Keep indeterminate work visibly distinct from a percentage.
2. Use Alert for persistent upload, playback, autosave, and recovery failures.
   Use Sonner for brief successful actions such as copying a link or adding
   audio; do not replace the persistent save-status indicator or a blocking
   error with a disappearing toast.
3. Add Skeleton or Spinner only where preparation has a real wait. Add Tooltip
   to icon-only editor controls, while preserving their accessible names.

**Done when:** every long operation has a truthful status, errors remain
actionable, and success feedback does not cover the waveform or transport.

## Phase 4 — Authentication and recording actions

1. Evaluate Input OTP against the current six-character code behavior: paste,
   Backspace, arrow movement, mobile one-time-code autofill, and alphanumeric
   guest codes. Replace `OtpInput.astro` only after these work in setup, sign
   in, and join flows.
2. Standardize recording actions and end-session confirmation with Button and
   Alert Dialog where a small Svelte island is justified. Preserve the
   recorder's timing-critical TypeScript and the phone layout.
3. Keep ordinary Astro form fields server-rendered. Share shadcn-derived
   classes and semantic tokens for Input, Native Select, Textarea, Checkbox,
   Field, and Button instead of hydrating static forms.

**Done when:** setup, sign-in, recovery, join, and recording work with keyboard
and touch, with no added latency or changed capture behavior.

## Phase 5 — Static surfaces and navigation

1. Align the episode library, settings cards, setup pages, and navigation with
   Card, Field, Badge, Avatar, Breadcrumb, Separator, and Kbd patterns where
   they improve consistency. Use actual Svelte components only for interactive
   islands; retain lightweight Astro markup for static content.
2. Remove superseded custom components only after all callers are migrated.
   Keep Podstudio-specific visual components such as level meters, waveforms,
   frequency graphs, speaker colors, and recording status.
3. Update the UI framework and `/ui` reference page to show the current light
   and dark component states rather than obsolete examples.

**Done when:** every active route uses the same spacing, typography, focus,
loading, error, and button hierarchy without unnecessary client bundles.

## Phase 6 — Integration and release

1. Review normal and narrow desktop screens plus phone portrait/landscape in
   both themes. Include overlays, focus, loading, offline, validation, and
   destructive states. Check screen readers and reduced motion. Spot-check
   real iOS Safari and Android Chrome for the recording and review flows.
2. Test keyboard and focus behavior, form submission, autosave, upload retry,
   pad preview, editor shortcuts, and recording completion. Preserve existing
   projects and recordings; no data migration is planned.
3. Run `npm test`, `npx astro check`, `npx svelte-check`, `npm run build`, and
   `npm run test:browser`. Update README, feature guide, UI framework, handoff,
   roadmap, and app credits for the final component set.
4. Build the implementation on `feat/shadcn-component-migration`, commit as
   Tyler Woodward without co-author or model references, push the feature
   branch, then fast-forward and push the verified commit to `feat/ui-build`
   and `main`. Migrate screen groups internally but release the coordinated
   result when all routes are consistent.

**Done when:** checks and visual review pass, local and remote branches point
to the same verified commit, and the VPS can install the production build.
The original VPS MP3 playback stall and upload 502 remain separate open bugs
until reproduced or verified on the updated VPS.

## Working estimate

| Phase | Working days |
|---|---:|
| Inventory and adapters | 1–2 |
| Overlays | 2–3 |
| Stateful controls | 3–4 |
| Feedback | 1–2 |
| Authentication and recording | 2–3 |
| Static surfaces and navigation | 2–3 |
| Integration and release | 2–3 |
| **Total** | **13–20** |

The estimate includes adapting and testing components across existing routes;
it excludes new audio-engine features and the unresolved VPS bugs.
