# Reported bugs

## Mobile post-recording action points to the desktop editor

- Status: implemented in mobile-session-fixes; real iOS/Android validation remains pending.
- Reproduction: record an episode on a phone, end the recording, and view Session Saved.
- Actual: the primary action says **Open editor**, although the full editor is desktop-only. The editor route sends phones back to Session Saved, so the action does not provide a usable next step.
- Expected: show the intended simplified mobile post-recording panel with working touch controls. Do not offer the desktop editor as an action that works on the phone. Explain that full timeline editing is available on desktop.
- Confirmed code location: `RecordingReview.svelte` now replaces the old Saved player; mobile links use Review recording.
- Acceptance: finishing a mobile recording opens a usable simplified panel; no editor/Saved navigation loop; existing recordings remain available; desktop still opens the full editor. Cover portrait/landscape phone layouts and a server-only recording.

## Hotkeys remain visible on mobile

- Status: implemented in mobile-session-fixes; real iOS/Android validation remains pending.
- Actual: hotkeys are still shown in the mobile experience, despite the intended mobile removal.
- Expected: remove the hotkey UI on mobile only. Preserve desktop hotkeys and keyboard behavior.
- Inspection points: the mobile pad strip (`src/components/app/PadStrip.astro`), recording actions, and any keyboard shortcut hints shared with desktop.
- Acceptance: phone recording and post-recording screens do not show hotkeys; desktop retains them; remaining mobile actions are usable by touch. Review real iOS and Android layouts.

Mobile fixes now provide Review recording, bounded playback, synchronization retry and selected raw downloads. The shared boundary removes mobile pads without affecting desktop or existing recorded pads.

## VPS audio import returns 502

- Status: open; exact VPS cause unconfirmed.
- Reported file: MP3, approximately 12 MB, four minutes long.
- Actual: no upload feedback, followed by “The server refused this sound (502)”.
- Import converts audio to stereo 48 kHz, 16-bit WAV before upload: four minutes is approximately 46 MB, below the 200 MiB media limit. File size alone does not explain this report.
- Implemented mitigation: conversion/upload/server-confirmation feedback, retained-file retry with the same media ID, clearer errors, a 15-minute request timeout, and an HTTP 413 response without deliberately destroying the request socket.
- Verification: the four-minute converted WAV upload (46,080,044 bytes) and same-ID retry pass the local API regression test. VPS service/proxy logs around the failure are still required to distinguish an upstream restart, timeout, or another deployment issue. Do not treat the original 502 as resolved solely because a local upload passes.

## Timeline interaction correction: direct dragging and overlap crossfades

- Status: deferred, requested on 2026-09-28; not implemented in the current editor usability change.
- Remove the separate **Select** and **Move** tool buttons.
- Clicking a waveform block selects it. Holding the mouse button and dragging moves that block directly.
- Overlapping waveform blocks should automatically crossfade across their overlap, with matching playback and finished export. Keep sources unchanged and the gesture undoable.
- Preserve trim handles, linked-track behavior, keyboard editing, and cancellation. Define a separate discoverable time-range selection gesture so Cut/Delete remain available without the mode switch.
- Acceptance: click selects without moving; drag moves without a mode change; overlap produces an audible crossfade rather than simply summing the clips; undo restores clip positions and fades; saved projects reopen with the same result.

## Imported audio buffers indefinitely during playback

- Status: open; reported on 2026-09-29 after the same MP3 uploaded successfully.
- The VPS checkout was verified at `c53b6fc`, predating the latest editor/upload improvements; no recent Podstudio/Caddy journal entries were reported by the user.
- The user confirmed playback starts and then repeatedly stalls. Reproduce on the updated editor with the four-minute MP3 and measure preparation/prefetch time across playback windows. Verify bounded media reads and cumulative processing before closing the report.
