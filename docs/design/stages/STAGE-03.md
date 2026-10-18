# Stage 03: Solo recording

**Goal:** Record yourself in the browser in full quality.

At the end of this stage the app must still deploy and everything from earlier stages must keep working.

## Screens (ids from the mockup)
- 07 Solo recording (without the voice-following prompter yet; plain scrolling script)

## Build
- [ ] PREBUILD-approved AudioWorklet PCM capture → persistent OPFS/IndexedDB journal → verified chunk uploads → 48 kHz WAV finalization; record actual sample rates/channels and resample explicitly
- [ ] Persist sequence/sample count/checksum/ack state; bounded buffering, quota/write-failure reporting and recovery after offline capture, refresh or forced tab closure
- [ ] Separate local-save/upload/server-verification states; retain committed local chunks until verified finalization and report missing/uncommitted tail instead of silently bridging gaps
- [ ] Input picker + live level meter (audiocn Microphone Setup / Level Meter)
- [ ] Retake on K: inject a detectable tone into captured audio and persist a sample-timed annotation; define tone frequency/level/duration in the shared capture contract (not just a monitor beep)
- [ ] Basic playback of the result

## Out of scope
Anything listed in a later stage. Leave stub routes, not half-built features.

## Done when
- [ ] A 30-minute recording uploads fully and plays back with no gaps
- [ ] A 2-hour solo run remains within PREBUILD's memory/buffering budgets; all committed chunks recover after forced interruption and duplicate upload retries
- [ ] The UI measures/reports the lost tail where capture stops and distinguishes incomplete/recovered recordings from fully verified recordings
- [ ] Retake annotations land at the right timestamps (±50 ms)
- [ ] Screens match the mockup at 1440×900 (and 390×844 for phone screens)
- [ ] lint, typecheck, unit and e2e tests pass in CI
- [ ] CHANGELOG.md has an entry for this stage

## Demo for review
Record 2 minutes, press K twice, play it back.

## Then
Update `STATUS.md`, write a short summary of what changed and anything that was skipped, and **stop**. Don't start the next stage until Tyler says go.
