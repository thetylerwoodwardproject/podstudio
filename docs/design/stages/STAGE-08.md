# Stage 08: Remote guests & optional live video

**Goal:** Record a guest anywhere, each side in full quality.

At the end of this stage the app must still deploy and everything from earlier stages must keep working.

## Screens (ids from the mockup)
- 03 Remote session
- 04 Guest join
- 05 Guest phone
- 06 Recording with a guest + show prep

## Build
- [ ] Self-hosted single-node LiveKit in docker-compose, scoped token service and audio-only/optional live-video call modes; raw audio stays local-quality
- [ ] External home-server ICE/UDP/TCP and TURN connectivity, certificates/firewall/ingress documented and tested outside the LAN; don't infer success from HTTPS alone
- [ ] Six-digit, single-use, revocable invitation codes expire after **24 hours**; rate-limited redemption atomically issues separate scoped participant/recovery credentials
- [ ] Guest join (paper theme, no account): mic/cam, how will you listen, checks
- [ ] Reuse Stage-03 persistent audio capture per participant, checksummed upload/finalization and recovery after reconnect/reopen; consumed invitation codes are not recovery credentials
- [ ] Capture-clock offset and sample-rate drift estimation/correction, session origin and source-to-edited mapping; report actual alignment quality separately from call latency
- [ ] Up to 4 participants and approximately 8 audio tracks in a 2-hour project; preserve individual recording/upload status
- [ ] Prep pane tabs 1–4 and ⌘K commands; ParticipantTile with speaker-colour ring

## Out of scope
Anything listed in a later stage. Leave stub routes, not half-built features.
Local camera-original capture/import/proxies are Stage 10a. Optional live call video does not imply a camera recording has been saved. The mobile host app remains deferred; guest-phone foreground joining is not a background-recording guarantee.

## Done when
- [ ] 30-minute two-person test: two local-quality WAVs, drift under 10 ms after alignment
- [ ] Closing the guest tab resumes committed-chunk uploads on rejoin using the recovery credential; report the gap during closure rather than implying uninterrupted capture
- [ ] A 2-hour/4-participant qualification meets recorded hardware/network budgets; drift correction is measured at start/end and checkpoints, including a device with a different sample-clock rate
- [ ] Optional live video and audio-only calls work from outside the LAN, including a restricted-network/TURN test; no UI claims that camera originals exist before Stage 10a
- [ ] Expired/used/revoked invitation codes cannot redeem again; valid recovery credentials can restore only their participant's recording
- [ ] Screens match the mockup at 1440×900 (and 390×844 for phone screens)
- [ ] lint, typecheck, unit and e2e tests pass in CI
- [ ] CHANGELOG.md has an entry for this stage

## Demo for review
Invite yourself on a phone, record 5 minutes, open both tracks in the editor.

## Then
Update `STATUS.md`, write a short summary of what changed and anything that was skipped, and **stop**. Don't start the next stage until Tyler says go.
