# Stage 10a: Camera ingest, synchronization & basic MP4

**Goal:** Bring real camera originals into the versioned project and export a basic finished video before advanced layouts or project interchange.

## Screens
- 03/04/06 optional local-camera recording status, separate from live call video
- 08 video source/monitor and linked timeline
- 12 basic Video export

## Build
- [ ] Capture local camera originals alongside the existing PCM audio journal; runtime codec/container probing per supported browser, actual dimensions/frame rates and explicit unsupported-device feedback
- [ ] Camera chunk manifests, persistent recovery and interrupted-container finalization; define browser-specific mux/header/keyframe constraints rather than assuming each MediaRecorder chunk is independently playable
- [ ] Manual video upload/import with codec validation, metadata extraction and immutable source assets
- [ ] Map camera sources to participants; persist rational timebases, A/V offsets and drift; handle variable-frame-rate inputs explicitly
- [ ] Generate bounded-size edit proxies and precomputed thumbnails; original/proxy/time-map references remain tied to a project revision
- [ ] Linked audio/video split/trim/move/ripple cuts and undo using the existing project model
- [ ] Basic single-camera monitor and worker H.264/AAC MP4 export with approved audio processing; no substitution of the LiveKit stream for originals

## Out of scope
Advanced shot switching/transitions/branding (10b), clips/audiograms (10c), editor-project interchange (10d), mobile host recording (12).

## Done when
- [ ] Local camera capture and manual import both produce usable sources; interrupted uploads/reopens recover committed data with gaps/limits reported
- [ ] A/V remains aligned within one output frame through a long fixture and linked cuts, with variable-frame-rate and mismatched-clock examples covered
- [ ] Proxy/original relinking preserves frame/sample positions and fits measured memory/disk budgets
- [ ] Basic finished MP4 opens/plays with correct length, sync and audio delivery metrics before any project-export feature exists
- [ ] Relevant desktop mockup regions match; lint, typecheck, unit/e2e and media qualification checks pass; CHANGELOG records evidence

## Demo and then
Record/import a camera source, interrupt/recover its upload, make a linked cut and export a finished MP4. Update STATUS and **stop for review** before 10b.
