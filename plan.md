# Editor UI and playback polish

## Goal

Address the editor inconsistencies shown in the September 30 screenshots: import progress obscures the editor, the remove-track dialog has a low-contrast footer and destructive action, identical audio can draw different waveforms, selected-clip numbers crowd the timeline, and a short recording takes too long to begin playback. Preserve source recordings, project edits, and export behavior.

## Upload feedback

- Replace the full-width import status row with a nonblocking status card fixed in the lower-right corner, clear of the transport and safe-area inset.
- Report the actual stages: reading/decoding, conversion, transfer percentage, and server confirmation. Do not claim an upload is complete before the server confirms it.
- Keep failures visible with a specific message and a same-ID **Retry** action. A successful upload may dismiss after roughly five seconds. Keep playback buffering and errors separate from import status.
- Check keyboard focus, screen-reader announcements, narrow desktop widths, and both themes.

## Dialog contrast

- Fix the shadcn-svelte AlertDialog footer's `bg-muted/50` mismatch with Podstudio's semantic color tokens; use a surface color that remains legible in light and dark themes.
- Give **Remove track** the UI standards' clear destructive treatment and sufficient contrast. Keep Cancel visually distinct.
- Audit other copied shadcn dialog, sheet, and alert styles for the same token mismatch. Verify hover, focus, disabled, and backdrop states without changing the dialogs' behavior.

## Selected-clip controls

- Remove the full-width row of raw decimal Position, Trim start, and Trim end inputs.
- Open a compact clip popover on completed click or keyboard selection. Do not open it while a drag gesture is in progress. Keep the timeline dominant and retain discoverable keyboard access to the fields.
- Label timeline position and source in/out explicitly. Show time as `m:ss.sss`, with validation and accessible error text. A committed edit is one undo step and autosaves; Escape restores the pre-edit values.
- Use the local shadcn-svelte Popover, Input, Label, and Button patterns where appropriate. Add the Popover primitive locally if absent.

## Consistent waveforms

- Generate peaks against canonical **source time**, in bounded reads, using fine buckets (target 20 ms) and a versioned browser cache. Render each clip by mapping its source trim to those buckets and then aggregating only the visible viewport at the current zoom.
- Use a stable amplitude-to-height mapping for all clips of a source. Remove per-view peak normalization and flex stretching that can make an identical file look different after split, trim, move, import, or zoom.
- Preserve source alignment and show preparation, retry, or error feedback when peak generation fails. Do not load a whole long recording merely to draw its waveform.
- Test identical source intervals across duplicate imports and adjacent split clips, plus trims, moves, zoom changes, server-only tracks, and cache reopening.

## Faster playback startup

- Measure the first-play delay for the reported 19-second Host + Pads recording and locate time spent fetching, decoding, processing, and rendering.
- Render a short initial window (target about four seconds) on Play, seek, or committed edit, then start playback as soon as it is ready. Prefetch the next window immediately and build toward the existing rolling 30-second window in the background.
- Preserve processor continuity across adjacent windows, discard stale work after seek/edit, and avoid repeated stalls at boundaries. Show meaningful **Preparing audio**, **Waiting for audio**, and failure states near the transport.
- Keep reads and memory bounded. Verify the short recording starts promptly and a four-minute imported MP3 crosses multiple windows without repeated buffering. Playback and export must remain audibly consistent.

## Acceptance and delivery

- Add focused unit/audio and browser tests for the behaviors above. Review editor screenshots at normal and narrow desktop sizes in light and dark themes, including dialogs, popovers, upload states, and playback states.
- Update the relevant UI standards, feature guide, handoff, roadmap, and bug list as the work lands. Keep the separate VPS 502 report open until the original MP3 is verified on the VPS; local upload success does not close it.
- Run `npm test`, `npx astro check`, `npx svelte-check`, `npm run build`, and `npm run test:browser`.
- Implement on a feature branch. Commit as `Tyler Woodward <tyler@fullymodulated.com>` without co-author or model references. Push the feature branch, then fast-forward and push the verified commit to `feat/ui-build` and `main`.
