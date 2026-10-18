# Stage PREBUILD: Technical validation

**Goal:** Prove the high-risk integration contracts before Foundation. This is a bounded feasibility stage, not production feature delivery.

Read BUILD_PLAN §1–3 and README's release boundaries first. Only this stage is current. Do not scaffold the full app or mark later stages complete based on prototypes.

## Inputs and evidence
- [ ] Confirm home-server CPU/RAM/disk/OS, usable upload bandwidth, domain/public ingress and CGNAT status; document what is measured versus still unavailable.
- [ ] Confirm supported desktop browsers. Record the machine, browser versions, fixture characteristics and explicit load/seek/interaction/peak-memory budgets before judging the performance proof.
- [ ] Create `validation/RESULTS.md` with reproducible commands, exact dependency versions, measurements, captures and pass/fail decisions. No fixture or result is pre-approved by this checklist.

## Proofs
### 1. Dependencies and UI
- [ ] Verify React 19.2+, Router framework mode, Tailwind v4, shadcn primitives and audiocn knobs/meters/mic setup together.
- [ ] Use `@audiocn/mic-setup`; reconcile Base UI block APIs and the selected primitives, package-local aliases and CSS path. Prevent competing microphone owners.
- [ ] Pin waveform-playlist browser v16 plus compatible core/playout/recording/annotations packages and peers; verify dnd-kit ^0.5 entry points, styled-components and Tone imports/worklet assets. Record registry/CLI versions and licences for copied code.
- [ ] Show representative controls and a tiny playlist without hydration errors, broken keyboard semantics or failed audio startup.

### 2. Durable capture and recovery
- [ ] Compare OPFS/IndexedDB support and select persistence/fallback. Capture PCM through AudioWorklet without retaining the whole session in RAM.
- [ ] Journal chunk sequence/sample counts/checksum/ack state; show distinct local and server durability. Define maximum uncommitted tail and missing-gap presentation.
- [ ] Force offline capture, tab closure/reopen, upload interruption, duplicate/reordered upload and a storage/quota failure. Recover all committed chunks with no silent duplication or gap; report unrecoverable tail honestly.
- [ ] Prove chunk objects or aggregated multipart uploads respect S3 minimum part sizes. Verify manifest finalization/checksums.
- [ ] Inject K's tone into captured audio and persist the matching sample-timed annotation; a monitoring-only beep does not pass.

### 3. Long-session editing
- [ ] Load/edit/play a representative 2-hour, approximately 8-audio-track fixture with real decoded-audio costs; do not qualify only waveform peaks or tiny files.
- [ ] Measure against the agreed budgets on the target hardware/browser. Select bounded decode/cache/proxy behaviour and document fallbacks before committing to waveform-playlist integration.
- [ ] Prototype application-owned, versioned sample/frame timing, linked edits and source-to-edited mapping. Demonstrate one linked ripple cut, undo and saved revision reload.

### 4. Processing and render consistency
- [ ] Select an actual noise-reduction algorithm and a shared preview/export strategy. Define filter/EQ/compressor implementations, FX order, algorithm versions, percentage mappings and latency/tail handling.
- [ ] Render an edited voice/music fixture with fades and FX through preview and export. For deterministic processing, aligned pre-delivery PCM residual is below −60 dBFS RMS. For any non-deterministic stage, record an agreed repeatable signal/quality test instead of claiming a null match.
- [ ] Separately demonstrate delivery normalization/encoding at −16 LUFS stereo / −19 LUFS mono (±0.5 LU), and finalize the proposed ≤ −1 dBTP post-encode ceiling. Include quiet/silent/short-material failure handling.

## Done when
- [ ] All four proofs have evidence; no critical recovery, memory or processing assumption is merely described as feasible.
- [ ] Chosen dependencies/contracts are written back into BUILD_PLAN/README and matching implementation checklists.
- [ ] Any failed proof has a proposed change and remains a blocker until reviewed; scope reduction needs Tyler's decision.
- [ ] Reproducible proof checks pass; record the exact commands. Full production lint/typecheck/unit/e2e CI is established in Stage 00, not falsely claimed here.
- [ ] CHANGELOG records the proof results, not just the intent to run them.

## Demo for review
Show an interrupted recording recovering, a 2-hour/8-track edit under the measured budgets, and an exported voice fixture with real noise reduction and measured delivery compliance.

## Then
Update STATUS only after passing the checks and **stop**. Foundation starts only after Tyler reviews the results and says go.
