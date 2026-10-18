# Stage 04: Core editor & retake cleanup

**Goal:** Cut and arrange a recording, export WAV.

At the end of this stage the app must still deploy and everything from earlier stages must keep working.

## Screens (ids from the mockup)
- 08 Editor (tracks, clips, playhead, annotations lane; no FX, no video)
- 09 Retake cleanup

## Build
- [ ] @waveform-playlist/browser v16 React components: tracks, clips, split/trim/move, zoom, undo/redo
- [ ] Application-owned versioned project document: source sample positions, links/track locks, ripple and non-ripple editing, clip fades/gain, autosave revisions and conflict handling
- [ ] Original-to-edited time map; linked cuts preserve sync and derived artifacts are remapped or marked stale by source project revision
- [ ] PREBUILD-approved bounded decode/cache strategy and precomputed peaks for 2-hour/approximately 8-track audio projects
- [ ] Upload/drop existing audio files onto new or existing tracks through Stage-02 asset validation; retain source formats privately and decode/resample through the approved pipeline
- [ ] Track headers: name, M/S, resizable height 64–260 px, speaker colour tokens
- [ ] Scoped keyboard map from README, explicit split action and no S=split/S=solo collision; do not intercept text entry
- [ ] Retake cleanup uses annotations/tone detection with silence/VAD cut boundaries, audition/adjustment and checkbox per cut; apply non-destructively across linked tracks as one undoable edit
- [ ] Export WAV (16/24-bit, 44.1/48 kHz) via the approved shared render path in the worker

## Out of scope
Anything listed in a later stage. Leave stub routes, not half-built features.
Sentence-aware retake detection and struck-through transcript text wait for Stage 07; Stage 04 must be usable without transcription.

## Done when
- [ ] Edit decisions survive reload
- [ ] Linked cuts/fades/mutes survive reload and undo; original source media is unchanged
- [ ] Deterministic aligned pre-delivery PCM playback/export residual below −60 dBFS RMS using PREBUILD's timing/latency rules (not a comparison against lossy or normalized delivery)
- [ ] 2-hour/8-track load, seek, editing and peak-memory measurements meet PREBUILD's recorded budgets
- [ ] Screens match the mockup at 1440×900 (and 390×844 for phone screens)
- [ ] lint, typecheck, unit and e2e tests pass in CI
- [ ] CHANGELOG.md has an entry for this stage

## Demo for review
Open the stage-03 recording, apply retake cuts, export WAV.

## Then
Update `STATUS.md`, write a short summary of what changed and anything that was skipped, and **stop**. Don't start the next stage until Tyler says go.
