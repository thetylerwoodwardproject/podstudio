import { test } from "node:test";
import assert from "node:assert/strict";
import { createEditorProject } from "./editor-project.ts";
import {
  audioConfiguration,
  emptyPackage,
  validMaterials,
  transcriptFiles,
} from "./episode-package.ts";
test("audio identity ignores file format preferences but follows audible edits", () => {
  const p = createEditorProject({
    takeId: "t",
    episodeId: "e",
    name: "Episode",
    sources: [],
  });
  const first = audioConfiguration(p);
  p.name = "Renamed";
  p.master.mp3 = !p.master.mp3;
  p.master.rawTracks = !p.master.rawTracks;
  assert.equal(audioConfiguration(p), first);
  p.master.ceilingDb = -2;
  assert.notEqual(audioConfiguration(p), first);
});
test("approved timing is independent by section and material validation rejects invalid bounds", () => {
  const p = emptyPackage("e");
  p.timingFingerprints.transcript = "abc";
  assert.equal(p.timingFingerprints.chapters, undefined);
  assert.equal(validMaterials(p.materials), true);
  p.materials.soundbites = [
    { id: "b", start: 2, end: 1, title: "Wrong", selected: true },
  ];
  assert.equal(validMaterials(p.materials), false);
});
test("subtitle exports preserve timing and escape cue delimiters", () => {
  assert.deepEqual(
    transcriptFiles([{ start: 60.012, end: 62.345, text: "Hello --> world" }]),
    {
      txt: "Hello --> world",
      srt: "1\n00:01:00,012 --> 00:01:02,345\nHello → world\n",
      vtt: "WEBVTT\n\n00:01:00.012 --> 00:01:02.345\nHello → world\n",
    },
  );
});
