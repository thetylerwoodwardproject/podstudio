# Stage 07: Transcripts & AI help

**Goal:** Searchable transcripts and suggested titles/chapters.

At the end of this stage the app must still deploy and everything from earlier stages must keep working.

## Screens (ids from the mockup)
- 10 Transcript
- 11 Episode details (AI suggestions)

## Build
- [ ] Configurable server-side remote transcription/LLM endpoints, models and secret references; adapters/capability checks for word timings, alignment, diarization and provider limits
- [ ] Transcription job → VTT + canonical timed-word JSON, speaker map and source project revision; transcript-file import supported without a provider call
- [ ] Adapt ElevenLabs Transcript Viewer/Scrub Bar to canonical alignment and the shared media transport; word seeking and per-paragraph speakers
- [ ] Source-to-edited mapping and stale detection after timeline changes; sentence-aware retake refinement adds to the already-working Stage-04 tone/silence cleanup
- [ ] Auto-correct rules and custom vocabulary
- [ ] AI suggestions (titles, description, chapters) as accept/dismiss; nothing auto-applied
- [ ] podcast:transcript and podcast:chapters in the feed

## Out of scope
Anything listed in a later stage. Leave stub routes, not half-built features.

## Done when
- [ ] Measure a 45-minute episode on the configured endpoint; target under 10 minutes and report provider limits/queue time separately rather than claiming an unmeasured hardware-independent SLA
- [ ] Word-level seeking/highlighting and retake refinement stay aligned after linked edits, or clearly require reprocessing; endpoint omissions never fabricate word timing
- [ ] Applying a suggestion is undoable
- [ ] Screens match the mockup at 1440×900 (and 390×844 for phone screens)
- [ ] lint, typecheck, unit and e2e tests pass in CI
- [ ] CHANGELOG.md has an entry for this stage

## Demo for review
Transcribe, fix a name with a rule, accept a chapter suggestion, republish.

## Then
Update `STATUS.md`, write a short summary of what changed and anything that was skipped, and **stop**. Don't start the next stage until Tyler says go.
