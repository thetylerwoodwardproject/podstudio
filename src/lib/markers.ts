/* How session markers are named and counted on screen and in exports. */
import type { SessionMarker } from './audio/assemble';

export const markerName: Record<SessionMarker['kind'], string> = {
  retake: 'Retake',
  pause: 'Pause',
  adlib: 'Ad-lib',
  cut: 'Cough (muted)',
  gap: 'Mic stopped',
  pad: 'Pad',
};

/** "Pad 3 · Four pallets bite" */
export const padLabel = (m: SessionMarker) => (m.pad ? `Pad ${m.pad.key} · ${m.pad.name}` : 'Pad');

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "3 retakes · 2 cuts · 1 ad-lib": the kinds present, in this order. */
export function markerCounts(markers: SessionMarker[]): string {
  const n = (kind: SessionMarker['kind']) => markers.filter((m) => m.kind === kind).length;
  return (
    [
      [n('retake'), 'retake'],
      [n('cut'), 'cough'],
      [n('adlib'), 'ad-lib'],
      [n('pause'), 'pause'],
      [n('gap'), 'gap'],
      [n('pad'), 'pad'],
    ] as const
  )
    .filter(([count]) => count)
    .map(([count, word]) => plural(count, word))
    .join(' · ');
}
