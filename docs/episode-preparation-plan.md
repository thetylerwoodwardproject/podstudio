# Simpler recording and episode preparation

Approved 2026-10-02. Workflow: **Record → Edit → Prepare episode → Download**.
Implemented on `feat/episode-preparation`; final regression verification and publishing follow.

## Phase 1 — Setup and navigation

Production shadcn Dialog/Field replaces browser prompts. Record now opens ad-lib
setup; Add a script opens the script editor. Saved microphone choices remain,
with detailed setup collapsed. The library offers the relevant continuation.
Recommended sound requires preview and an explicit, undoable Apply; existing
projects retain their sound. Targets: −16 LUFS stereo / −19 LUFS mono, −1 dBTP.

## Phase 2 — Permanent session deletion

Recording cards combine local/server groups and guest sources. A shadcn
confirmation describes the irreversible operation. Server tombstones are
committed before filesystem cleanup; interrupted cleanup is retryable, and
stale take/guest uploads cannot recreate deleted audio. Local cleanup includes
editor recovery, waveform and prepared-audio caches. Dependent editor projects
block deletion. Episodes, scripts, approved text and independent library media
remain. Server failure never reports successful server deletion.

## Phase 3 — Real OpenAI configuration and preparation

Settings validates model access and encrypts API keys with AES-256-GCM. The
0600 encryption key lives outside SQLite. Missing credentials disable only AI.
Generation uses a saved, revision-specific, finished edited/mastered WAV.
Browser-compressed, timestamped chunks use whisper-1; writing uses gpt-4.1-mini
with a strict JSON schema. Persistent jobs expose actual stages, cancellation,
explicit retry, and restart recovery. Approved text is never replaced by a job;
people accept suggestions individually. Timed assets track their audio revision
independently. Ten-minute chunks overlap by two seconds, with word timestamps
reconciled at the boundary. Providers are tested with deterministic test doubles;
no paid API request is part of the automated checks.

## Phase 4 — Downloadable package

The preparation screen reviews manual or generated titles, descriptions,
chapters, transcript and editable/playable soundbites. It downloads finished WAV,
optional MP3/raw tracks, approved text, chapter text/JSON, transcript TXT/SRT/VTT
and selected WAV/MP3 clips. Outdated timed materials require review; missing
optional materials do not block download. Independently saved soundbites appear
in the pad library. Phones review text and download prepared files; creating a
finished mix or transcription upload remains a desktop task.

## Phase 5 — Verification and delivery

All five checks are required, plus light/dark and phone screenshot review.
Credential/provider failures, deletion/retries/dependencies, edited-mix identity,
chunk timestamps, stale results, preservation of approved text and ZIP contents
have automated coverage. Verify real iOS/Android and an actual OpenAI account
on the deployed VPS separately. Original VPS MP3 stalls/502 remain open until
verified there. Backup/restore must include `.ai-key`, SQLite and `prepared/`.
