# Release 1: Solo-audio review gate

**Prerequisite:** PREBUILD and Stages 00–06 have passed their checks and been reviewed. This is a review/cutover decision, not a new feature-building stage.

## Evidence to present
- [ ] Record solo → force interruption → recover committed audio → make a linked edit and retake cut → apply real noise reduction/voice FX → export WAV/MP3 → publish a validated episode.
- [ ] K's recorded tone and annotation are present at matching times; cleanup is reviewed and undoable without altering source media.
- [ ] The 2-hour/approximately 8-track editor fixture meets PREBUILD's agreed budgets on the configured hardware/browser. Four-participant remote recording is later scope, not a Release-1 dependency.
- [ ] Existing-show test import preserves GUID/isPermaLink identities, dates and reviewed metadata, with a complete media inventory and no unresolved cutover blockers.
- [ ] Password-protected listening works, including direct media/range authorization, optional expiry, revoke/password change and exclusion from public discovery.
- [ ] Publication retries/scheduler restart preserve one publication and the last valid feed; delivery loudness/true peak meet the approved contract.
- [ ] Off-site restore evidence covers database/configuration/required secrets and availability/checksums of representative private/published assets.
- [ ] Production ingress/domain/storage/email settings, measured constraints and operational runbook are documented. Relevant lint/typecheck/unit/e2e and long-session qualification results are attached.

## Decision
- [ ] Tyler reviews the demonstration and documented limitations and accepts Release 1, or returns it for specific fixes.
- [ ] If a production feed move/cutover is desired now, agree and record its separate source-host/domain steps; importing a test feed is not authorization to redirect production subscribers.

## Then
Record the decision in STATUS/CHANGELOG. On approval, mark this review complete and Stage 07 current, then **stop**. Begin Stage 07 or production cutover only on Tyler's instruction; preserve Release 1 usability during later work.
