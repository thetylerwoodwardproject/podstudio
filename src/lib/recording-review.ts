import { getTake, listTakes, rangesWav, saveRemoteTake, type TakeMeta } from './audio/takes';
import { editorSessions, mergeEditorTakes, remoteSource, type RemoteTake } from './editor-sessions';
import { rawRanges, rawRecordingWav } from './audio/raw-export';
import { hasPads, renderPads, stereoOf } from './audio/pads-export';
import { cleanEditorProject } from './editor-project';
import { libraryWav } from './pads';
import { loadSettings } from './settings';
import { encodeWav } from './audio/wav';
import { download } from './zip';
import type { EditorSourceReader } from './audio/editor-render';

export interface ReviewDownload { id: string; name: string; run: (progress: (message: string) => void) => Promise<void> }
export async function openRecordingReview(episode: string, requested: string | null) {
  const local = await listTakes(episode);
  let remote: RemoteTake[] = [];
  try {
    const response = await fetch(`/api/takes?episode=${encodeURIComponent(episode)}`);
    if (!response.ok) throw new Error(`Recordings unavailable (${response.status})`);
    remote = (await response.json()).takes;
  } catch (error) { if (!local.length) throw error; }
  const all = mergeEditorTakes(local, remote);
  const host = requested ? all.find((t) => t.id === requested) : editorSessions(all)[0];
  if (!host || host.episodeId !== episode) throw new Error(requested ? 'This recording is unavailable.' : 'No completed recording is available yet.');
  const ranges = rawRanges(host);
  const duration = ranges.reduce((n, [a, b]) => n + b - a, 0);
  const tracks = [host, ...all.filter((t) => t.id !== host.id && host.group && t.group === host.group)];
  const localIds = new Set(local.map((t) => t.id));
  let reader: EditorSourceReader | null = null;
  const preview = async (from: number, seconds: number) => {
    const selected: [number, number][] = []; let offset = 0;
    for (const [a, b] of ranges) { const start = Math.max(from, offset), end = Math.min(from + seconds, offset + b - a); if (end > start) selected.push([a + start - offset, a + end - offset]); offset += b - a; }
    if (localIds.has(host.id)) return URL.createObjectURL(await rangesWav(host, selected, [], undefined, [], null));
    if (!reader) {
      const response = await fetch(`/api/takes/${encodeURIComponent(host.id)}`);
      if (!response.ok) throw new Error(`Audio unavailable (${response.status})`);
      const detail = await response.json();
      if (!detail.segmentBytes?.length || detail.segmentBytes.some((n: number) => n <= 0)) throw new Error('Recording segments are still missing. Retry after uploads finish.');
      reader = remoteSource(host, detail.segmentBytes);
    }
    const samples = await Promise.all(selected.map(([a, b]) => reader!.read(a, b - a)));
    return URL.createObjectURL(encodeWav(samples, { sampleRate: host.sampleRate, channels: host.channels ?? 1, bitDepth: host.bitDepth }));
  };
  const ensureLocal = async (track: TakeMeta, progress: (s: string) => void) => {
    if (localIds.has(track.id)) return;
    await saveRemoteTake({ ...track }, async (n) => {
      const response = await fetch(`/api/takes/${encodeURIComponent(track.id)}/segments/${n}`);
      if (!response.ok) throw new Error(`Recording segment unavailable (${response.status})`);
      return response.arrayBuffer();
    }, (n) => progress(`Preparing ${track.speaker || 'audio'} · ${n} of ${track.segments} pieces`));
    localIds.add(track.id);
  };
  const filename = (name: string) => `Ep${episode}_${name.replace(/[^A-Za-z0-9_-]/g, '_')}_raw.wav`;
  const downloads: ReviewDownload[] = tracks.map((track, i) => ({ id: track.id, name: i ? track.speaker || `Guest ${i}` : 'Host', run: async (progress) => {
    await ensureLocal(track, progress); progress('Preparing raw WAV…');
    download(await rawRecordingWav(host, track, loadSettings().recording.tones), filename(i ? track.speaker || `Guest${i}` : 'Host'));
  } }));
  if (hasPads(host)) downloads.push({ id: 'pads', name: 'Pads', run: async (progress) => {
    await ensureLocal(host, progress); await renderPads(host, (done) => progress(`Preparing pads · ${Math.round(done * 100)}%`));
    download(await rawRecordingWav(host, stereoOf(host), loadSettings().recording.tones, 'pads'), filename('Pads'));
  } });
  let project = cleanEditorProject(JSON.parse(localStorage.getItem(`podstudio-editor-${host.id}`) ?? 'null'));
  if (!project) try {
    const response = await fetch(`/api/editor-projects/${encodeURIComponent(host.id)}`);
    if (response.ok) project = cleanEditorProject((await response.json()).project);
  } catch { /* Source recordings remain reviewable offline. */ }
  for (const track of project?.tracks.filter((t) => t.kind === 'import') ?? []) downloads.push({ id: track.id, name: track.name, run: async (progress) => {
    progress(`Preparing ${track.name}…`); download(await libraryWav(track.sourceId.replace(/^media:/, '')), filename(track.name));
  } });
  return { host, tracks, duration, preview, downloads, local: localIds.has(host.id), missingGuest: !!host.guest && tracks.length === 1 };
}
