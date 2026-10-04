# Editor sidebar plan

## Goal

Give the desktop editor a compact project navigator without taking space away from the timeline. The sidebar is collapsed by default and expands on demand. It uses the same secondary-sidebar treatment as Settings and Manual, including the stationary rail, active-section highlight, storage status, and account actions.

## Layout

- Add a left rail inside the editor shell, over the timeline at the left edge.
- Collapsed width: 52 px. Expanded width: 224 px. The expanded rail overlays the timeline rather than changing its width.
- Keep the rail fixed to the editor viewport while the timeline scrolls horizontally and vertically.
- The rail starts collapsed. Clicking the toggle expands it; moving the pointer outside the rail collapses it again. Keyboard focus keeps it open until focus leaves the rail.
- On phones, keep the existing Session Saved fallback; do not load the editor sidebar.
- Use native shadcn Button, Tooltip, Separator, Dropdown Menu, and Collapsible primitives. Use the existing StatusDot for save and storage states.

## Navigation

The expanded rail contains these groups:

1. **Project**
   - Home / Episodes
   - Current episode and session switcher
   - Sessions
2. **Workflow**
   - Record new session
   - Editor (active)
   - Prepare / Export
   - AI tools (disabled until available)
3. **Editor tools**
   - Mixer
   - Retakes
   - Pauses
   - Loudness
   - Import audio

The footer contains Settings, Manual, Sign out, and Storage. Storage stays visible in both collapsed and expanded states through its status dot and tooltip. Sign out remains directly above Storage, matching the other sidebars.

## Interaction rules

- The rail toggle is an icon-only button with a tooltip, accessible name, and visible focus ring. Add a keyboard shortcut only if it does not conflict with editor editing shortcuts.
- Collapsed items show icons and tooltips; expanded items show icon, label, and optional count or status dot.
- The current route or editor stage receives the same active background and text treatment used by Settings and Manual. The rail does not move while a section is selected.
- Session links preserve the explicit `?take=` value. Switching sessions saves the project first and then navigates.
- Leaving with a pending save shows the existing Saving state and waits for the server confirmation before navigation. A conflict keeps the user in the editor.
- Tools that open sheets (Mixer, Retakes, Pauses, Loudness) stay in the editor route and do not reload the timeline.
- Import audio opens the existing file picker and reports progress through the existing upload status toast.

## Visual rules

- Reuse the editor’s page, surface, divider, primary, and text tokens. Do not introduce a second color system.
- Use StatusDot for saved, waiting, failed, storage, and recording states; do not add custom colored circles.
- Keep labels at the same type scale as the Settings and Manual sidebars. Counts use compact monospace text.
- The rail may cover the left edge of the timeline while expanded, but it must never obscure the playhead, mixer, or modal sheets. The timeline width calculation remains unchanged.

## Implementation phases

### Phase 1: shell and state

- Create `EditorSidebar.svelte` with collapsed and expanded variants.
- Add a small typed editor navigation model for project, workflow, tools, and account destinations.
- Mount it in `EditorFlow.svelte`, keep the overlay state local to the editor session, and expose `data-editor-sidebar`, `data-editor-sidebar-toggle`, and `data-editor-nav` hooks.

### Phase 2: navigation wiring

- Wire episode, sessions, settings, manual, storage, and sign-out links.
- Add editor stage links for the existing sheets and export route.
- Add save-before-navigation handling and preserve session IDs.
- Add active-state handling for the current stage and selected session.

### Phase 3: responsive and accessibility pass

- Collapse automatically below the desktop editor breakpoint without changing the stored preference.
- Verify keyboard navigation, focus return after expansion, tooltips, screen-reader labels, reduced motion, and no translation metadata.
- Confirm the sidebar is absent on the mobile Session Saved experience.

### Phase 4: validation and documentation

- Browser-test collapsed and expanded states, active links, session switching, save/conflict behavior, sheet launches, focus, and narrow desktop layouts.
- Review screenshots against the shared sidebar, Settings, Manual, and Pi-Tuner spacing/type rules.
- Update the editor feature guide, UI framework notes, and handoff document.

## Acceptance criteria

- The editor opens with a compact 52 px rail and a full-width timeline.
- One click expands the rail to 224 px; leaving the rail collapses it without changing timeline layout.
- All project navigation is reachable without returning to the recorder or prompter.
- Settings, Manual, Storage, and Sign out match the existing secondary-sidebar behavior.
- Current editor stage and session are visibly highlighted, and explicit session URLs remain intact.
- No editor playback, editing, autosave, mixer, or mobile fallback behavior regresses.
