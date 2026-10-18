# Stage 13: Voice-following prompter & polish

**Goal:** The finishing touches.

At the end of this stage the app must still deploy and everything from earlier stages must keep working.

## Screens (ids from the mockup)
- 07 Solo recording (voice-following prompter)
- 02 / 06 polish

## Build
- [ ] Prompter follows live speech-to-text with a fuzzy sliding window; holds when unsure; pauses while a guest talks
- [ ] Show prep polish, keyboard map overlay, empty states
- [ ] Optional OIDC SSO configuration and sign-in button only when configured; preserve email/password and existing show ownership permissions
- [ ] Confirm remote STT streaming/latency capabilities for the prompter; batch transcription alone does not provide live following

## Out of scope
Anything listed in a later stage. Leave stub routes, not half-built features.

## Done when
- [ ] Prompter stays on the right line for a 5-minute read with normal ad-libs
- [ ] Screens match the mockup at 1440×900 (and 390×844 for phone screens)
- [ ] lint, typecheck, unit and e2e tests pass in CI
- [ ] CHANGELOG.md has an entry for this stage

## Demo for review
Read the intro script with the prompter on.

## Then
Update `STATUS.md`, write a short summary of what changed and anything that was skipped, and **stop**. Don't start the next stage until Tyler says go.
