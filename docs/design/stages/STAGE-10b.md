# Stage 10b: Shots, transitions & branding

**Goal:** Finish video episodes with predictable preview/export layout.

## Screens
- 08 video monitor, shot lane, Video inspector and branding slots
- 12 finished Video export; 25/28/30 playback of verified public video renditions

## Build
- [ ] Monitor aspects 16:9 / 9:16 / 1:1; Auto/Host/Guest/Side-by-side (A/H/G/D), From playhead/Whole episode and persisted shot events
- [ ] Speaker-driven shots use measured activity/approved timing, with stable switching and manual overrides; support the defined participant baseline, not only two hardcoded names
- [ ] Cut/Crossfade/Dip transitions; tile shape, padding, radius and fill, all in a shared versioned layout specification
- [ ] Name tag/captions/logo/artwork each toggleable in tl/tc/tr/bl/bc/br; 1fr 1.6fr 1fr grid with wrapping, maximum lines, scaling/overflow and aspect-specific bounds
- [ ] Shared pinned fonts, caption line breaking, placement and animation rules for preview and worker; edited transcript/project revision is authoritative
- [ ] Worker renders immutable finished H.264/AAC MP4 renditions with approved audio; cancellation/retries cannot replace the live publication with a partial file
- [ ] Public video alternate-enclosure/player support, without exposing private WAV/raw sources or protected media

## Out of scope
Social clips/styles/audiograms (10c) and editor-project interchange (10d).

## Done when
- [ ] Shots/transition boundaries match the edit revision; preview/export frame fixtures cover all aspects and long names/captions without unintended overlap
- [ ] Every branding slot renders correctly at 1080p landscape and 1080×1920 portrait; shared fonts/wrapping are verified, not inferred from matching settings
- [ ] Exported video preserves one-frame A/V synchronization and final audio loudness/true peak; public players load verified renditions only
- [ ] Relevant screens match the mockup plus README overrides; lint/typecheck/unit/e2e and media checks pass; CHANGELOG updated

## Demo and then
Switch shots, test a long caption/name, place the logo top-right and export landscape/portrait finished files. Update STATUS and **stop for review** before 10c.
