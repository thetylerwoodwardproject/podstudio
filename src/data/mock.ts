/*
 * Mock data for the UI build. Every screen reads from here so the backend
 * can replace one module later. Content is copied from the design handoff.
 */

export type SpeakerKey = 'TYLER' | 'SAM' | 'DANA';

export interface Speaker {
  key: SpeakerKey;
  name: string;
  initial: string;
  role: string;
}

export const speakers: Speaker[] = [
  { key: 'TYLER', name: 'Tyler', initial: 'T', role: 'Host' },
  { key: 'SAM', name: 'Sam', initial: 'S', role: 'Co-host' },
  { key: 'DANA', name: 'Dana', initial: 'D', role: 'Guest' },
];

/** CSS color for a speaker, driven by the cast panel's custom properties. */
export const spk = (key: SpeakerKey | '?') =>
  key === '?' ? 'var(--spk-unknown)' : `var(--spk-${key.toLowerCase()})`;

export const speakerByKey = (key: SpeakerKey) => speakers.find((s) => s.key === key)!;

export const user = { name: 'Tyler', username: 'tyler', initial: 'T' };

export const episode = {
  id: '142',
  number: 142,
  title: 'The Transmitter',
  label: 'Ep. 142',
  fullTitle: 'Ep. 142 — The Transmitter',
  joinCode: 'K74-Q2R',
  length: '31:06',
  takeCount: 3,
  words: 412,
};

export interface ScriptLine {
  who: SpeakerKey;
  text: string;
}

export const scriptLines: ScriptLine[] = [
  { who: 'TYLER', text: 'It was a quiet week in the studio, until the new transmitter arrived.' },
  { who: 'SAM', text: 'Four pallets? I heard it was five, and one of them was just foam.' },
  { who: 'TYLER', text: 'Four. I counted. So this episode is about what happens after the crate is open.' },
  { who: 'SAM', text: 'Power, cooling, and the first time we keyed it up.' },
  { who: 'DANA', text: 'And whether the floor could hold it, which, for the record, nobody checked until I asked.' },
  { who: 'TYLER', text: 'We measured it twice. The spec sheet and the building plans did not agree.' },
];

/** The script as one list of words; every prompter uses these indexes. */
export const scriptWords = scriptLines.flatMap((l) => l.text.split(/\s+/).filter(Boolean));

/** Index in scriptWords of the first word of each line. */
export const lineStarts = scriptLines.reduce<number[]>(
  (acc, l, i) => [...acc, i === 0 ? 0 : acc[i - 1] + scriptLines[i - 1].text.split(/\s+/).filter(Boolean).length],
  [],
);

/** Single-speaker narration from the monitor design (1e). */
export const monitorScript =
  'It was a quiet week in the studio, until the new transmitter arrived. Four pallets, one forklift, and a delivery driver who swore he had never seen anything that heavy come off a truck. So this episode is about what happens after the crate is open. Power, cooling, the first time you key it up and watch the meters move.';

/** Script sections; `line` is the first script line of each. */
export const sections = [
  { title: 'Cold open', at: '0:00', line: 0 },
  { title: 'Segment 1 · Install', at: '1:42', line: 2 },
  { title: 'Segment 2 · Key-up', at: '14:50', line: 4 },
  { title: 'Wrap', at: '27:05', line: 5 },
];

export interface Device {
  id: string;
  name: string;
  glyph: string;
  meta: string;
  mic: string | null;
}

export const devices: Device[] = [
  { id: 'mac', name: 'MacBook Pro', glyph: 'LAP', meta: 'Chrome 129 · Shure MV7', mic: 'Shure MV7' },
  { id: 'phone', name: 'iPhone 15 — Chrome', glyph: 'PHN', meta: 'Chrome 129 · Built-in mic', mic: 'Built-in mic' },
  { id: 'mon', name: 'Studio monitor 2', glyph: 'MON', meta: 'Edge 129 · no input', mic: null },
];

export const screenAssignments: { name: string; role: string; who: SpeakerKey | 'ALL' }[] = [
  { name: 'MacBook Pro', role: 'Recorder', who: 'TYLER' },
  { name: 'iPhone 15', role: 'Prompter', who: 'SAM' },
  { name: 'Studio monitor 2', role: 'Display', who: 'ALL' },
];

export const castMeta: Record<SpeakerKey, string> = {
  TYLER: 'Host · 3 lines',
  SAM: 'Co-host · 2 lines',
  DANA: 'Guest · 1 line',
};

export type EpisodeStatus = 'Draft' | 'Transcribed' | 'Published' | 'Recorded';

export const library: {
  title: string;
  status: EpisodeStatus;
  words: string;
  takes: string;
  length: string;
  updated: string;
  href?: string;
}[] = [
  { title: 'Ep. 143 — Antenna Season', status: 'Draft', words: '1,204 words', takes: '—', length: '—', updated: 'Today' },
  { title: 'Ep. 142 — The Transmitter', status: 'Transcribed', words: '412 words', takes: '3 takes', length: '31:06', updated: 'Today', href: '/episodes/142/script' },
  { title: 'Ep. 141 — Rack Room Tour', status: 'Published', words: '2,380 words', takes: '2 takes', length: '44:12', updated: 'Sep 17' },
  { title: 'Ep. 140 — Studio B Rebuild', status: 'Published', words: '1,915 words', takes: '4 takes', length: '38:40', updated: 'Sep 10' },
  { title: 'Ep. 139 — Mailbag', status: 'Recorded', words: '640 words', takes: '1 take', length: '22:03', updated: 'Sep 3' },
  { title: 'Ep. 138 — Grounding, Again', status: 'Published', words: '1,760 words', takes: '2 takes', length: '35:51', updated: 'Aug 27' },
];

export const statusColor: Record<EpisodeStatus, string> = {
  Draft: 'var(--color-muted)',
  Transcribed: 'var(--color-spk-teal)',
  Published: 'var(--color-ok)',
  Recorded: 'var(--color-spk-yellow)',
};

export const storage = { usedGb: 41, totalGb: 46, pct: 88, hoursLeft: 9, free: '5.1 GB' };

export const takes = [
  { name: 'Take 1', kind: 'FULL', range: '00:00 – 10:12', start: 'Starts at Line 1' },
  { name: 'Take 2', kind: 'FULL', range: '00:00 – 18:48', start: 'Starts at Line 1' },
  { name: 'Take 3', kind: 'PUNCH-IN', range: '09:15 – 11:21', start: 'Starts at Line 3 · “Four. I counted.”' },
];

/** Transcript with speakers (matched against the script), for 3c. */
export const speakerTranscript: { t: string; who: SpeakerKey | '?'; text: string }[] = [
  { t: '00:00', who: 'TYLER', text: 'It was a quiet week in the studio, until the new transmitter arrived.' },
  { t: '00:05', who: 'SAM', text: 'Four pallets? I heard it was five, and one of them was just foam.' },
  { t: '00:10', who: 'TYLER', text: 'Four. I counted. So this episode is about what happens after the crate is open.' },
  { t: '00:17', who: 'SAM', text: 'Power, cooling, and the first time we keyed it up.' },
  { t: '00:22', who: 'DANA', text: 'And whether the floor could hold it, which, for the record, nobody checked until I asked.' },
  { t: '01:42', who: 'TYLER', text: 'We measured it twice. The spec sheet and the building plans did not agree.' },
  { t: '02:19', who: '?', text: 'Then there was the question of where the heat was going to go.' },
];

export const speakerTalkTime: Record<SpeakerKey, string> = { TYLER: '14:22', SAM: '11:05', DANA: '5:39' };

/** Raw Whisper transcript shown beside the episode package (2e). */
export const transcript = [
  { t: '00:00', text: 'It was a quiet week in the studio, until the new transmitter arrived.' },
  { t: '00:05', text: 'Four pallets, one forklift, and a delivery driver who swore he had never seen anything that heavy come off a truck.' },
  { t: '00:13', text: 'So this episode is about what happens after the crate is open.' },
  { t: '00:18', text: 'Power, cooling, the first time you key it up and watch the meters move.' },
  { t: '01:42', text: 'We started with the rack. Before a single bolt went in, we measured the floor load twice.' },
  { t: '01:51', text: 'Because the spec sheet and the building plans did not agree, and I was not about to find out which one was wrong the hard way.' },
  { t: '02:06', text: 'So we got the structural drawings out, and honestly, that took most of a morning.' },
  { t: '02:19', text: 'Then there was the question of where the heat was going to go.' },
];

export const pkg = {
  titles: [
    'The Transmitter Arrives',
    'Four Pallets and a Forklift: Installing a New Transmitter',
    'Measure the Floor Twice',
    'Key Up: The First Day on a New Transmitter',
    'What the Spec Sheet Didn’t Tell Us',
  ],
  description:
    'A new transmitter shows up on four pallets, and the real work starts once the crate is open. We walk through the install: checking the floor load twice because the spec sheet and the building plans didn’t agree, getting power and cooling in place, and the first time we keyed it up and watched the meters. We finish with what we’d do differently next time.',
  posts: [
    'Four pallets. One forklift. A driver who’d never seen anything that heavy come off a truck. New episode: installing a transmitter from crate to first key-up.',
    'When the spec sheet and the building plans disagree, you measure the floor twice. The rest of our transmitter install is in this week’s episode.',
    'The first time you key up a new transmitter, you’re not listening to the audio. You’re watching reflected power. Ep. 142 is out now.',
  ],
  chapters: [
    { s: '00:00:00', e: '00:01:42', title: 'Cold open: the transmitter arrives' },
    { s: '00:01:42', e: '00:09:15', title: 'Measuring the floor load twice' },
    { s: '00:09:15', e: '00:14:50', title: 'Power and cooling before the first bolt' },
    { s: '00:14:50', e: '00:21:30', title: 'Keying up and watching reflected power' },
    { s: '00:21:30', e: '00:27:05', title: 'What the spec sheet and building plans missed' },
    { s: '00:27:05', e: '00:31:06', title: 'What we’d do differently next time' },
  ],
  soundbites: [
    { s: '00:03:12', e: '00:03:41', title: 'The spec sheet and the building plans did not agree, so we measured the floor load twice before a single bolt went in.' },
    { s: '00:11:48', e: '00:12:20', title: 'Cooling is the part nobody budgets for, and it is the part that decides whether the transmitter lasts ten years or three.' },
    { s: '00:15:05', e: '00:15:33', title: 'The first time you key it up, you are not listening to the audio. You are watching reflected power and hoping it stays low.' },
    { s: '00:28:10', e: '00:28:52', title: 'If we did it again, we would get the rack, the power, and the cooling signed off in writing before the truck ever left the warehouse.' },
  ],
};

export const limits = { chapterTitle: 45, soundbiteTitle: 128 };

export const transcribeSteps = [
  { label: 'Compress for upload', meta: 'FLAC · 18.4 MB', at: 0 },
  { label: 'Whisper transcription', meta: 'segments + timestamps', at: 20 },
  { label: 'Align to script', meta: '', at: 70 },
  { label: 'Write titles, description, posts, chapters, soundbites', meta: 'gpt-4o-mini', at: 90 },
];

export const tracks: {
  who: SpeakerKey;
  device: string;
  exportDevice: string;
  status: string;
  statusColor: string;
  offset: string;
}[] = [
  { who: 'TYLER', device: 'MacBook Pro · studio', exportDevice: 'Studio · MacBook Pro', status: 'Local', statusColor: 'var(--color-ok)', offset: 'Clock offset 0 ms' },
  { who: 'SAM', device: 'iPhone 15 · remote', exportDevice: 'Remote · iPhone 15', status: 'Uploaded · live', statusColor: 'var(--color-ok)', offset: 'Clock offset +2 ms' },
  { who: 'DANA', device: 'Laptop · remote', exportDevice: 'Remote · laptop', status: 'Uploading · 2 chunks behind', statusColor: 'var(--color-warn)', offset: 'Clock offset −4 ms' },
];

export const trustedDevices = [
  { name: 'MacBook Pro · Chrome', meta: 'This device · expires Oct 24' },
  { name: 'iPhone 15 · Chrome', meta: 'Last used today · expires Oct 20' },
  { name: 'Studio monitor 2 · Edge', meta: 'Last used today · expires Oct 18' },
];

export const users = [
  { who: 'TYLER' as SpeakerKey, name: 'Tyler', username: 'tyler', role: 'Admin', state: '2FA ON' },
  { who: 'SAM' as SpeakerKey, name: 'Sam', username: 'sam', role: 'Host', state: '2FA ON' },
  { who: 'DANA' as SpeakerKey, name: 'Dana', username: '—', role: 'Guest · Ep. 142 only', state: 'INVITED' },
];

export const shortcuts = [
  { action: 'Pause / resume', keys: 'Space' },
  { action: 'Faster / slower (manual mode)', keys: '↑ ↓' },
  { action: 'Previous / next line', keys: '← →' },
  { action: 'Jump to last voice match', keys: 'J' },
  { action: 'Record from current line', keys: 'R' },
  { action: 'Mirror this screen', keys: 'M' },
  { action: 'Text size', keys: '+ −' },
];

export const server = {
  version: '0.1.4',
  latest: '0.2.0',
  address: 'podstudio.example.com',
  localAddress: 'podstudio.local:4321',
  inviteLink: 'https://podstudio.example.com/invite/8f2k-q7mz',
};

export const setupSteps = [
  { label: 'Server check' },
  { label: 'Admin account' },
  { label: 'Two-factor auth' },
  { label: 'OpenAI key' },
  { label: 'Domain & HTTPS', optional: true },
  { label: 'Done' },
];

/** What the import dialog shows for the example .docx before anything is dropped. */
export const importPreview = {
  file: 'transmitter-v3.docx',
  meta: '412 words · 42 lines · 3 sections',
  speakers: [
    { who: 'TYLER' as SpeakerKey, lines: 22 },
    { who: 'SAM' as SpeakerKey, lines: 14 },
    { who: 'DANA' as SpeakerKey, lines: 6 },
  ],
  section: 'Cold open',
  lines: [
    { who: 'TYLER' as SpeakerKey, text: 'It was a quiet week in the studio, until the new transmitter arrived.' },
    { who: 'SAM' as SpeakerKey, text: 'Four pallets? I heard it was five, and one of them was just foam.' },
    { who: 'TYLER' as SpeakerKey, text: 'Four. I counted.' },
    { who: 'DANA' as SpeakerKey, text: 'And whether the floor could hold it…' },
  ],
  target: 'Ep. 143',
};

/** Static paths for /episodes/[id]/…; only the example episode has data. */
export const episodePaths = () => [{ params: { id: episode.id } }];

/** The script as the studio screen shows it: sections, paragraphs, cues. */
export const studioScript: ({ kind: 'section'; text: string } | { kind: 'p' | 'cue'; text: string; caret?: boolean })[] = [
  { kind: 'section', text: 'Cold open' },
  { kind: 'p', text: 'It was a quiet week in the studio, until the new transmitter arrived. Four pallets, one forklift, and a delivery driver who swore he had never seen anything that heavy come off a truck.' },
  { kind: 'p', text: 'So this episode is about what happens after the crate is open. Power, cooling, the first time you key it up and watch the meters move.' },
  { kind: 'section', text: 'Segment 1 · Install' },
  { kind: 'p', text: 'We started with the rack. Before a single bolt went in, we measured the floor load twice, because the spec sheet and the building plans did not agree', caret: true },
  { kind: 'cue', text: '[pause — sound bite from site visit]' },
];
