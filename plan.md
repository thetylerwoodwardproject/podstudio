# Podstudio Editor Core

## Summary

Replace the five-step export flow with a desktop-only Podstudio editor built
on the existing recording, synchronization, processing, and export code. Do
not install OpenDAW. Keep audio work in the browser and store compact project
metadata on the VPS.

The workflow becomes **Record → Editor → Export → Optional AI tools**. Phones
continue to Session Saved and direct users to open the project on desktop.

## Editor experience

- Build a full-width Svelte editor with the episode and save status above a
  dominant timeline, compact Mute/Solo/FX/Level track controls, and a bottom
  transport with playback, position, duration, and zoom.
- Stream segmented PCM around the playhead and cache multiresolution waveform
  peaks instead of decoding entire sessions.
- Support select, split, trim, move, undo, redo, Delete (leave time), and Cut
  (ripple-delete linked tracks). Tracks stay linked unless explicitly unlinked.
- Add desktop shortcuts and ignore them while focus is in a form control.
- Allow browser-decodable audio uploads as additional tracks.
- Show RET, COUGH, AD-LIB, and PAUSE markers subtly above the waveforms.

## Editing and processing

- Derive retake groups from marker and script history. Use the last take
  provisionally, require each group to be reviewed before final export, and
  allow another take to be selected and trimmed.
- Let users drag take boundaries and loop each transition. Render short
  equal-power crossfades at joins.
- Suggest pauses when all voice tracks remain quiet for at least three seconds.
  Leave suggestions unchanged until the user keeps, shortens, or removes one.
  Shorten starts at one second and remains adjustable.
- Use one persistent full-session player. Changes update the cumulative mix
  while keeping the playhead. Solo is for listening; mute and level affect the
  final export.
- Put per-track FX in a Podstudio sheet: noise amount, Low/Mid/High tone,
  compression presets, and automatic speech leveling for voices; tone and
  compression for pads and imported tracks.
- Reuse the current denoise, tone, mastering, MP3, synchronization, and export
  libraries. Run expensive analysis and rendering in browser workers.

## Persistence, recording, and export

- Add a versioned editor project containing source references, clips, link
  groups, edit decisions, markers, gains, mutes, FX, fades, and export settings.
  Never alter source recordings.
- Add authenticated editor-project GET/PUT endpoints with revision conflicts.
  Save locally first, debounce server saves, and report saving, saved, offline,
  failed, and conflict states.
- Reconstruct projects from server takes and fetch missing audio on demand.
- Schedule Pause and Resume for host and guest on the shared clock. Stop
  accepting samples during pauses and freeze/resume active pads. Old sessions
  remove recorded pause intervals while constructing editor and raw timelines.
- Send desktop users to the editor after End Session. Prepare guest tracks and
  automatic alignment there; keep the existing guest-file recovery path.
- Replace old export links with the editor and migrate current export defaults.
- Export a finished WAV, optional MP3, and optional raw tracks. Raw exports keep
  attempts and cough audio and render configured host marker tones into the
  downloaded copy. Finished files apply edits and processing without tones.
- Preserve the completed-export confirmation and add a future AI-tools entry.

## Tests and delivery

- Unit-test the project model, editing commands, alignment, retakes, pauses,
  undo/redo, persistence conflicts, and audio-rendering invariants.
- Add browser coverage for desktop/mobile routing, timeline editing, shortcuts,
  retakes, pauses, FX, playback, imports, autosave/recovery, and exact exports.
- Verify bounded reads and memory on a long segmented project.
- Update README and project, API, deployment, feature, handoff, and roadmap docs.
- Run `npm test`, `npx astro check`, `npx svelte-check`, `npm run build`, and
  `npm run test:browser`. Commit as Tyler Woodward, push `feat/editor-core`,
  then fast-forward and push `feat/ui-build` and `main`.

## Estimate

The complete editor is estimated at 25–35 engineering days: 2–3 for project
persistence, 5–7 for timeline/playback, 5–7 for editing and review, 4–6 for FX
and export, 3–4 for synchronized pause, and 6–8 for coverage, performance,
documentation, and VPS validation.
