# Stage 02: Storage

**Goal:** Files land in the user’s own S3-compatible bucket.

Confirm the primary target (local MinIO or external S3-compatible provider); home hosting does not imply a bare local-disk adapter. Off-site backups remain independent of the primary server/storage.

At the end of this stage the app must still deploy and everything from earlier stages must keep working.

## Screens (ids from the mockup)
- 17 Storage

## Build
- [ ] storage_targets with provider cards (Linode, B2, Wasabi, R2, AWS, MinIO)
- [ ] Connection test (put/read/delete, required list permissions, browser CORS, public feed reachability and byte-range/HEAD behaviour)
- [ ] Routing rules: raw recordings / exports / feed media / artwork can go to different targets
- [ ] Durable upload_sessions/part acknowledgement manifests, resumable multipart helper, sha256, retries and idempotent finalization
- [ ] Capture chunks use independent objects or aggregation; never send ~720 KB five-second PCM chunks as non-final S3 multipart parts (usual minimum 5 MiB)
- [ ] Explicit asset access/private-public routing; raw/project/recovery/protected-share media private, published feed media intentionally public
- [ ] Interrupted-upload cleanup/retention and recoverable finalization; deleting an incomplete upload cannot delete verified source media

## Out of scope
Anything listed in a later stage. Leave stub routes, not half-built features.

## Done when
- [ ] Connection test passes against MinIO in CI
- [ ] A 1 GB upload resumes after a dropped connection
- [ ] Resume survives page/server restart with recorded acknowledgements; duplicate/reordered chunks do not corrupt the final asset
- [ ] Private objects cannot be fetched through public media URLs; published media supports real external byte-range playback
- [ ] Screens match the mockup at 1440×900 (and 390×844 for phone screens)
- [ ] lint, typecheck, unit and e2e tests pass in CI
- [ ] CHANGELOG.md has an entry for this stage

## Demo for review
Add a MinIO target, run the test, upload a file.

## Then
Update `STATUS.md`, write a short summary of what changed and anything that was skipped, and **stop**. Don't start the next stage until Tyler says go.
