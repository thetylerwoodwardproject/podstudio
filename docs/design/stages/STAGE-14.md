# Stage 14: Hardening

**Goal:** Expand operational resilience and portability beyond the baseline already required before the first real release.

At the end of this stage the app must still deploy and everything from earlier stages must keep working.

## Screens (ids from the mockup)
- None new

## Build
- [ ] Extend early off-site backups (Litestream plus independent media protection/versioning); full restore runbook covers database, configuration, required secrets, primary/private/public media and endpoint changes
- [ ] Test a supported point-in-time database restore and reconcile media versions/manifests; a database-only restore is not a complete studio restore
- [ ] Extend the rate limits/audit events already introduced with accounts, sharing, publishing and guest codes; operational monitoring, storage/quota alerts and worker/backlog diagnostics
- [ ] Per-show export (ZIP + OPML); update channel; docs

## Out of scope
Anything listed in a later stage. Leave stub routes, not half-built features.

## Done when
- [ ] Restore service/database/configuration onto a clean home/local-server test environment with a target under 30 minutes; measure media recovery separately and verify access/checksums for representative private, published and protected assets
- [ ] Restore drill demonstrates ownership/auth, an existing feed, a recoverable upload and a valid protected share; no new screen-fidelity gate for this no-new-screens stage
- [ ] lint, typecheck, unit and e2e tests pass in CI
- [ ] CHANGELOG.md has an entry for this stage

## Demo for review
Do a full restore drill.

## Then
Update `STATUS.md`, write a short summary of what changed and anything that was skipped, and **stop**. Don't start the next stage until Tyler says go.
