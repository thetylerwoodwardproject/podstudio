# Stage 12: Mobile host app

**Goal:** Record from a phone and finish on the computer.

**Deferred.** Before starting, review real-device/browser capability targets with Tyler. Release 1 and desktop/video work do not depend on mobile recording. Reliable background/locked-screen recording has not been promised.

At the end of this stage the app must still deploy and everything from earlier stages must keep working.

## Screens (ids from the mockup)
- 19 Home
- 20 Choose your mic
- 21 Solo recording
- 22 Invite a guest
- 23 Recording with a guest
- 24 Saved

## Build
- [ ] Installable PWA on the same codebase; Drawer instead of Dialog; 44 px targets
- [ ] Big record button, Retake (same tone + annotation as K), invite code + share sheet
- [ ] Reuse persistent capture/upload recovery; qualify foreground recording, interruption handling and resume on reopen using actual supported devices
- [ ] Distinguish local save, uploading and server-verified completion; warn about suspension/lock limits before recording and report gaps after resuming
- [ ] Use background upload where supported, with foreground/reopen fallback; do not present OS-suspended recording as uninterrupted

## Out of scope
Anything listed in a later stage. Leave stub routes, not half-built features.

## Done when
- [ ] Real iOS Safari/Android Chrome tests measure a 60-second background/locked-screen interruption; document capture/upload behaviour and validate warnings, gap reporting and recovery (viewport emulation is insufficient)
- [ ] Episode recorded on the phone opens in the desktop editor
- [ ] Screens match the mockup at 1440×900 (and 390×844 for phone screens)
- [ ] lint, typecheck, unit and e2e tests pass in CI
- [ ] CHANGELOG.md has an entry for this stage

## Demo for review
Install on a phone, record with a guest, open it on desktop.

## Then
Update `STATUS.md`, write a short summary of what changed and anything that was skipped, and **stop**. Don't start the next stage until Tyler says go.
