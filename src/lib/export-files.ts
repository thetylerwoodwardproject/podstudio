/*
 * Every file an export can put in the zip, from the export's settings: its
 * name, group, a line saying what it is, an estimated size, and its kind. The
 * picker shows this list and the zip is written from it (only the ticked
 * names), so the count on the button is always what's in the zip.
 *
 * A kind is the file's role without the episode, the person or the part
 * ("voice_edit_clean.wav"), so a saved selection applies to any episode,
 * guest or split. Design: docs/design/export-files/.
 */

export type FileGroup = 'raw' | 'edit' | 'pub' | 'rep';
export const GROUPS: { id: FileGroup; name: string }[] = [
  { id: 'raw', name: 'Your recording, untouched' },
  { id: 'edit', name: 'The assembled edit' },
  { id: 'pub', name: 'Ready to publish' },
  { id: 'rep', name: 'Markers and reports' },
];

export interface ExportFile {
  name: string;
  kind: string;
  group: FileGroup;
  desc: string;
  bytes: number;
}

export interface Person {
  /** "Tyler", as in the file names */
  name: string;
  host: boolean;
  rate: number;
  /** Bytes per sample frame (bit depth / 8 × channels) */
  frameBytes: number;
  /** A processed copy of their edit: levelled (with any tone), toned only, or none */
  copy: 'levelled' | 'toned' | null;
}

export interface PlanInput {
  /** "Ep142" */
  label: string;
  people: Person[];
  /** Session length, seconds */
  duration: number;
  /** The host's rate and bit depth (the Pads track and the episode use them) */
  rate: number;
  bitDepth: number;
  assembled: boolean;
  pauses: 'cut' | 'keep' | 'split';
  /** Length of each part of the edit (one unless pauses are split); ignored with the edit off */
  editParts: number[];
  ns: number;
  /** Marker tones in your full recording */
  markerTones: boolean;
  pads: boolean;
  roughMix: boolean;
  loudness: 'stereo' | 'mono' | 'off';
  /** Something in the chain changes the sound: for the episode's line */
  toned: boolean;
  markers: number;
  voiceLog: number;
}

const WAV_HEADER = 44;

export function planFiles(i: PlanInput): ExportFile[] {
  const out: ExportFile[] = [];
  const S = `${i.label}_Session_`;
  const add = (group: FileGroup, name: string, kind: string, desc: string, bytes: number) => out.push({ name, kind, group, desc, bytes: Math.round(bytes) });
  const wav = (seconds: number, rate: number, frameBytes: number) => seconds * rate * frameBytes + WAV_HEADER;
  const parts = i.assembled ? i.editParts : [];
  const split = parts.length > 1;
  const partNote = (k: number) => (split ? ` Part ${k + 1}.` : '');
  const partName = (k: number) => (split ? `_part${k + 1}` : '');

  // Your recording, untouched
  for (const p of i.people) {
    const base = `${S}${p.name}`;
    const desc = p.host
      ? `The whole raw recording, with retake and pause cues and Broadcast WAV timecode${i.markerTones ? ', and a marker tone at each retake' : ''}.`
      : `${p.name}’s whole raw recording, lined up to yours.`;
    add('raw', `${base}.wav`, 'voice.wav', desc, wav(i.duration, p.rate, p.frameBytes));
    if (i.ns) add('raw', `${base}_clean.wav`, 'voice_clean.wav', 'The same recording with noise suppression applied.', wav(i.duration, p.rate, p.frameBytes));
  }
  if (i.pads) add('raw', `${S}Pads.wav`, 'pads.wav', 'Everything played from the hotkey pads, ducked as you heard it.', wav(i.duration, i.rate, 2 * (i.bitDepth / 8)));
  if (i.pads && i.roughMix) add('raw', `${S}RoughMix.wav`, 'roughmix.wav', 'Voices and pads mixed as you heard them, peaks under −1 dBFS.', wav(i.duration, i.rate, 2 * (i.bitDepth / 8)));

  // The assembled edit
  const how = { cut: 'pauses cut and coughs muted', keep: 'pauses kept and marked', split: 'split at each pause' }[i.pauses];
  parts.forEach((len, k) => {
    for (const p of i.people) {
      const file = `${S}${p.name}_edit${partName(k)}`;
      add('edit', `${file}.wav`, 'voice_edit.wav', `The last attempt of each line, ${how}.${partNote(k)}`, wav(len, p.rate, p.frameBytes));
      if (i.ns) add('edit', `${file}_clean.wav`, 'voice_edit_clean.wav', `The same edit, cut from the cleaned audio.${partNote(k)}`, wav(len, p.rate, p.frameBytes));
      if (p.copy)
        add(
          'edit',
          `${file}_${p.copy}.wav`,
          `voice_edit_${p.copy}.wav`,
          `${p.copy === 'levelled' ? 'The edit with tone and levelling applied, for your DAW.' : 'The edit with your EQ and compressor, for your DAW.'}${partNote(k)}`,
          wav(len, p.rate, p.frameBytes),
        );
    }
    if (i.pads) add('edit', `${S}Pads_edit${partName(k)}.wav`, 'pads_edit.wav', `The pads, cut to match the edit.${partNote(k)}`, wav(len, i.rate, 2 * (i.bitDepth / 8)));
  });
  // Without the edit, the processed copies are of the whole recording.
  if (!i.assembled)
    for (const p of i.people)
      if (p.copy)
        add(
          'edit',
          `${S}${p.name}_${p.copy}.wav`,
          `voice_${p.copy}.wav`,
          p.copy === 'levelled' ? 'The whole recording with tone and levelling applied, for your DAW.' : 'The whole recording with your EQ and compressor, for your DAW.',
          wav(i.duration, p.rate, p.frameBytes),
        );

  // Ready to publish
  const episodes = parts.length ? parts : [i.duration];
  const channels = i.loudness === 'mono' ? 1 : 2;
  const chain = [i.ns && 'cleaned', i.toned && 'toned', i.loudness === 'stereo' ? 'set to −16 LUFS' : i.loudness === 'mono' ? 'set to −19 LUFS' : null].filter(Boolean).join(', ');
  episodes.forEach((len, k) => {
    const suffix = split ? `_part${k + 1}` : '';
    add('pub', `${i.label}_Episode${suffix}.wav`, 'episode.wav', `The finished episode${chain ? `: ${chain}` : ''}, peaks under −1 dBTP.${partNote(k)}`, wav(len, i.rate, channels * (i.bitDepth / 8)));
    add('pub', `${i.label}_Episode${suffix}.mp3`, 'episode.mp3', `The same episode as an MP3 with an ID3 tag, ${channels === 2 ? '192 kbps stereo' : '128 kbps mono'}.${partNote(k)}`, (len * (channels === 2 ? 192 : 128) * 1000) / 8);
  });

  // Markers and reports
  add('rep', `${S}markers.txt`, 'markers.txt', 'Markers as Audacity labels.', 40 + i.markers * 48);
  add('rep', `${S}markers.csv`, 'markers.csv', 'Markers as a spreadsheet: time, kind, line, attempt and first words.', 60 + i.markers * 60);
  add('rep', `${S}export.txt`, 'export.txt', 'The export report: timecode, how any guest was lined up, what the episode measured, and the chain used.', 900);
  if (i.voiceLog) add('rep', `${S}voice-log.txt`, 'voice-log.txt', 'What voice follow did during the session, for tracking down a dropout.', 40 + i.voiceLog * 60);
  return out;
}

/** Why some files aren't in the list this time. */
export function missingNotes(i: Pick<PlanInput, 'assembled' | 'ns' | 'people'>): string[] {
  return [
    !i.assembled && 'No edit files: the assembled edit is off.',
    !i.ns && 'No _clean copies: noise suppression is off.',
    i.assembled && i.people.every((p) => !p.copy) && 'No toned copy of the edit: tone and levelling are off.',
  ].filter((x): x is string => !!x);
}

/** Quick picks: which files each ticks. */
export const QUICK: { id: string; label: string; pick: (f: ExportFile) => boolean }[] = [
  { id: 'everything', label: 'Everything', pick: () => true },
  { id: 'publish', label: 'To publish', pick: (f) => f.group === 'pub' },
  { id: 'daw', label: 'For my DAW', pick: (f) => f.group === 'edit' || f.kind === 'markers.txt' || f.kind === 'markers.csv' },
];

/** Whether a file is ticked: chosen here, else by the saved selection, else yes. */
export const picked = (f: ExportFile, picks: Record<string, boolean>, saved: string[] | null) => picks[f.name] ?? (saved ? saved.includes(f.kind) : true);

export function formatSize(bytes: number) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}
