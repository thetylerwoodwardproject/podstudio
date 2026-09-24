import { loadSettings } from './settings';

/** Where "Start take" goes: the mic check first, unless it's turned off in Recording settings. */
export function takeUrl(episodeId: string, fromLine?: number) {
  const q = fromLine != null ? `?from=${fromLine}` : '';
  return loadSettings().recording.micCheck ? `/episodes/${episodeId}/mic-check${q}` : `/episodes/${episodeId}/recording${q}`;
}
