# Stage 10d: Later editor-project interchange

**Goal:** Export editable projects to **Final Cut Pro, Adobe Premiere Pro and DaVinci Resolve** after finished-media exports already work.

This is later scope, not a Release-1 or initial-video-release dependency. All three editors are required eventually; do not reinterpret the finished-media-first decision as cancelling them.

## Before implementation
- [ ] Confirm editor/version, supported interchange dialect and format checkpoint order with Tyler; a filename such as "DaVinci" or "Premiere XML" alone is not a format contract
- [ ] Define portability for paths, original/proxy references, sample/frame timebases, sequences, linked media, fades, transitions, captions and unsupported DSP/layout features
- [ ] Define any baked-stem or rendered-overlay fallback and show which elements are editable versus baked; never silently discard unsupported processing

## Review checkpoints (one editor at a time)
- [ ] Final Cut Pro: verified FCPXML project and media package, tested in the agreed application version
- [ ] Adobe Premiere Pro: verified agreed interchange dialect/media package, tested in the agreed application version
- [ ] DaVinci Resolve: verified agreed interchange dialect/media package, tested in the agreed application version

Follow the agreed order. **After each editor checkpoint, record results in STATUS/CHANGELOG and stop for Tyler's review.** Stage 10d stays current until all three checkpoints pass; approval of one editor is not approval to begin the next automatically.

## Done when
- [ ] Each editor opens its exported project without broken media references; positions/duration, linked cuts and fades match the source revision within one output frame
- [ ] A fixture covers trimmed source in/out, repeated clips, multiple tracks, sample-rate/frame-rate conversion and the declared feature-loss/fallback rules
- [ ] Portability check works from a separate media folder/machine; unsupported features are documented in the package manifest/UI
- [ ] Existing finished WAV/MP3/MP4 exports still pass; lint/typecheck/unit/e2e and format validation checks pass
- [ ] Actual application-open results (not only XML schema validation) are recorded, with editor versions and CHANGELOG entries

## Demo and then
Open the exported fixture in each editor at its checkpoint, compare the timeline and play a linked edit. After all three pass, update STATUS and **stop for review** before Stage 11.
