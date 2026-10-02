# Handoff: where Podstudio is, and what's next

Read this first, then `CLAUDE.md`, `docs/ui-framework.md`, `docs/features.md`,
`docs/development.md`, `docs/server-api.md`, `docs/deploy.md`, and
`docs/roadmap.md` as needed.

## Where it stands

Podstudio `0.1.0` is in active development and installed on the first lab VPS
for real-world testing. Database schema 4 is current. Recording, synchronized
guest capture, hotkey pads, the desktop editor, browser audio processing and
finished/raw export are implemented. Phone recording remains supported; the
full editor is desktop-only and phones land on Session Saved.

The current workflow is **Record → Podstudio Editor → Export → Optional AI
tools**. The previous five-step export implementation remains at
`export-legacy.astro` for compatibility and regression coverage, while
`/episodes/:id/session` redirects to `/episodes/:id/editor`.

## UI theme foundation

The app now has account-synced System, Light and Dark choices, applied before
page paint. Light uses indigo primary actions and dark uses lime. The
prompter's reading theme remains independent. Selected shadcn-svelte and
Bits UI components are copied into `src/components/shadcn`; the mobile
recording-review play control uses the local button. The README and Settings
→ About & credits list the UI sources and link their license notices.

This is the foundation of the planned full-app facelift, not the completed
redesign. The shared transport interface, adaptation of the community audio
player, remaining screen migrations, and full light/dark visual review are
still outstanding. The original four-minute MP3 stall and VPS 502 report
remain open until verified on the updated VPS.

Phase 0 of the [shadcn component migration](shadcn-component-migration.md)
is complete on `feat/shadcn-component-migration`: the
[component inventory and adapter contract](shadcn-phase-0-inventory.md)
record the current callers, state owners, Astro/Svelte boundaries, theme
tokens, licenses, and baseline desktop/phone screenshots. Settings → General
now presents Appearance as one full-width field in both themes. Later phases
will replace screen controls; Phase 0 does not claim the full migration is done.

The 939 MB lab VPS hit Node's heap limit while the installer ran `astro check`
as part of `npm run build`. The installer now runs `npm run build:deploy` to
bundle without rechecking types on the VPS; the full build remains a required
pre-push check. Rerun the installer after pulling this fix, then validate the
MP3 upload and playback on the VPS.

## Editor usability and advanced audio

The editor now has direct entry points on recorded episodes, a session switcher,
and local/server discovery. Existing take-detail responses include a segment byte
index for exact lazy reads. Completed legacy guest uploads are exposed through
the authenticated take reader without copying their audio. The selected session's pads still require preparation
of its host audio for ducking; other sessions are never downloaded speculatively.

Direct clip dragging, ruler/Shift range selection, signed reversible trim gestures, clip details popover and SVG
transport controls replace the ambiguous interactions. `EditorFxControls.svelte`
provides optional advanced EQ/compression. `fx.tone` is authoritative when present;
older simple projects retain their sound. Loudness analysis and mastered preview
share export rendering, with cancellation and stale-result indication.
The current FX pass replaces the Simple Low/Mid/High controls with Clean,
Shape and Boost knobs, while Advanced keeps exact ten-band EQ and compressor
controls. A Shape preset and amount map to the existing EQ processor; Boost
maps to the compressor. Legacy settings are not replaced without an explicit
choice. A top-right Sonner toast now shows editor and Settings persistence
state. Shared step flows use a Stepper-style progress control; sign-in and API
key fields use server-rendered shadcn-style fields, and the episode library
paginates after ten matching entries. More Shadcn's Audio Wave is decorative
and is not used for calibrated dBFS meters.
The current control pass also uses shadcn-svelte Checkbox for interactive
choices and Input OTP for authenticator and invite codes. Astro-only checkbox
forms retain native inputs with matching tokens. The FX preset selects have
room for their arrow and text in both themes.

Imports display progress and retry the same file ID. Oversize request handling
now returns 413 without destroying the socket, and the Node request timeout matches
the 15-minute upload timeout. The user's specific VPS 502 still needs verification
against Caddy and service logs; do not claim that its cause has been proven locally.
Editor-specific no-translation markup supplements the existing English language tag.

## Editor core

- `src/pages/episodes/[id]/editor.astro` loads local and server takes, aligns
  guests, creates bounded source readers, mounts the editor, imports audio and
  renders exports.
- `src/components/app/EditorFlow.svelte` owns the timeline, selections,
  transport, sheets, undo/redo, autosave/conflicts and export state.
- `src/lib/editor-project.ts` is the versioned, non-destructive project model
  and edit command layer. Source PCM/WAV is only referenced; it is never
  rewritten.
- `src/lib/audio/editor-peaks.ts` builds and caches waveform peaks from bounded
  source reads for recorded, server-only and imported tracks. The timeline
  loads visible regions first and shows preparation or retry when a read fails.
- `src/lib/audio/editor-render.ts` renders only clips overlapping the requested
  window. Playback uses rolling 30-second windows with prefetch, so it is not
  limited to 30 seconds and does not decode a whole long session at once.
- `server/editor-projects.ts` stores compact project JSON with revision checks
  through `GET`/`PUT /api/editor-projects/:takeId`.
- Finished export renders each audible track through its editor FX before the
  existing loudness/true-peak master. Marker tones are absent. Optional raw
  tracks retain attempts and cough audio; the host raw copy receives configured
  marker tones during rendering.

The editor supports linked split, trim, move, delete and ripple cut, explicit
unlinking, selection, zoom, keyboard shortcuts, retake review, pause choices,
imports, per-track mute/solo/level and focused FX. Retake groups must be
reviewed before a finished export. Autosave writes a local recovery copy first,
then uses server revisions and exposes offline and conflict states.
The compact Tools and Edit menus hold secondary actions, and clip position/trim
fields open in a popover on selection. Removing a track is an undoable project edit:
its source stays intact and the track can be restored after reopening. Recorded
raw exports still include original sources; removed imports remain in the media
library but are omitted from that project's raw ZIP. The top bar no longer has
a theme picker; Settings → General retains the synced System/Light/Dark choice.
The studio setup panel scrolls independently above a fixed-height Start session
footer.
The editor now also shows processed per-track sample-peak dBFS meters synchronized
to its rolling player. Shift-drag and ruler ranges have clearer highlighting,
and a shadcn-svelte Context Menu exposes the existing edit actions plus Play
selection. Meter data is collected during rendering without another source read;
mastered preview keeps the per-track readout before the final master.
The footer has a stacked horizontal L/R meter for the preview output; the
scrubber is shorter to make room. Mastered preview meters its mastered output.
The master meter now switches to live short-term, long-term integrated, and
range loudness measured from played PCM. Track gain stages changes during a
drag and renders once on commit, avoiding overlapping preview work. Playback
startup has a bounded wait and reports an error if a media element never
starts. Invalidating a preview during its initial load clears stale loading
state and restarts playback with the new mix. A successful Sonner save toast
dismisses after 2.5 seconds.
Editor polish on `feat/editor-ui-playback-polish`: an anchored clip
popover replaces the position/trim row, uploads report progress in a lower
corner, Alert Dialog footers use the correct surface token, and waveforms use
versioned 20 ms source-time peaks with stable visual scaling. Initial playback
renders a short window and prefetches larger windows. The original VPS MP3
stall and 502 are still open until verified on that VPS.

## Recording and synchronization

`src/lib/audio/capture.ts` and `public/worklets/recorder.js` can pause and resume
sample acceptance. A shared Pause command stops host and guest samples on the
session clock and suspends active pads; Resume uses the existing countdown and
pads continue from the same position. Pause intervals are recorded in metadata.
Older sessions have their recorded pause intervals removed when editor sources
or raw exports are assembled.

Guest sync remains in `src/lib/audio/sync.ts`, with start-time fallback in
`align.ts`. The editor shows Preparing editor until final guest segments and
drift correction are ready. Missing guest uploads retain the Add guest file
recovery path.

## Other current systems

- One Node process: `server/main.ts` serves Astro, JSON APIs and the WebSocket
  room. SQLite runs in WAL mode; uploaded segments and media are files.
- Account settings and pad synchronization emit the shared save-status event.
  Every Settings page reports Saving, Saved automatically, Waiting for
  connection or Couldn't save.
- Hotkey pad setup is a Svelte sheet with draft Save/Cancel, six concrete UI
  palette colors, server-session clips, uploaded browser-decodable clips and a
  live draft preview.
- Marker settings provide five clean isolated tone previews generated by the
  same code and frequency mapping used for raw export.
- Audio processing stays in plain TypeScript. Svelte owns stateful UI; Astro
  owns routes and data loading. Keep this boundary when extending the editor.

## Tests and publishing

Editor usability verification (2026-09-28): 259 unit/server tests pass; Astro
and Svelte checks have zero errors; the build passes. All 14 browser flows
passed across the full run and targeted editor/guest reruns after correcting
legacy guest discovery and navigation expectations. Tests used installed Chrome.
Desktop timeline/FX/loudness screenshots were reviewed against the UI standards;
`docs/images/editor.png` is current. Chrome's profile-dependent translation
prompt and the reported VPS 502 still need real-environment verification.

Run all of these before publishing:

```sh
npm test
npx astro check
npx svelte-check
npm run build
npm run test:browser
```

The browser suite contains 16 Chromium flows and writes logs/screenshots to
`tests/browser/.out`. Review new desktop and phone screenshots against
`docs/ui-framework.md`. The editor unit coverage includes project validation,
linked/ripple commands, retakes, pause suggestions, bounded source reads and
finished/raw behavior. Server coverage includes project revisions and
conflicts.

Work on a feature branch. Commit as `Tyler Woodward
<tyler@fullymodulated.com>` with no co-author trailers. After checks pass, push
the feature branch, fast-forward `feat/ui-build`, push it, then fast-forward
`main` and push it.

## Known issues and next work

1. Validate the editor with long real sessions, multiple guest devices and
   interrupted uploads on the lab VPS. Watch browser memory, worker time and
   reconnect behavior.
2. Validate upgrades from each released schema, including schema 3 → 4 and a
   restored backup, before calling the installer upgrade path proven.
3. Test phone recording and coordinated pause/resume on real iOS and Android
   devices. The full editor intentionally remains desktop-only.
4. Profile DeepFilterNet and long exports on common laptops. Native server-side
   acceleration may be explored later, but the current product keeps audio
   processing in the browser and VPS requirements low.
5. Optional AI tools, transcription and episode-package features remain future
   work. Do not let those controls imply a working service yet.

Mobile review now replaces the editor loop with bounded playback/scrubbing, server status/retry and selected raw downloads. Local/server sources share discovery and raw rendering with the editor. `mobile.ts` centralizes the boundary; mobile pads and setup are excluded. Chromium portrait/landscape checks cover these changes; real iOS/Android validation remains pending.

Mobile verification (2026-09-29): 261 unit/server tests pass, Astro and Svelte checks have zero errors, and the build passes. Browser coverage includes server-only phone host/guest review, portrait/landscape, selected raw downloads, missing IDs, offline status and desktop pads. Legacy Saved-screen tests now exercise raw review while retaining the legacy export/noise regressions. Real iOS Safari and Android Chrome checks remain pending.

The editor-direct-drag branch stores optional same-track crossfade references in project metadata. New partial overlaps use equal-power fades over their full span; old projects keep their old overlap sound until a clip is moved or trimmed. Imported media readers seek into cached WAV Blobs and no longer decode a full file on every preview window. The previous VPS 502 and newly reported repeated playback stalls still require updated-VPS reproduction with the original MP3.
