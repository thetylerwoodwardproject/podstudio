/*
 * After a crash or a closed tab, an unfinished take is waiting in storage.
 * Screens that start work call this on load to offer it back.
 */
import { findCrashedTakes } from './audio/takes';

export async function offerRecovery(episodeId: string) {
  if (!('storage' in navigator) || !navigator.storage.getDirectory) return;
  const crashed = (await findCrashedTakes()).filter((t) => t.episodeId === episodeId && t.samples > 0);
  if (crashed.length) location.href = `/episodes/${episodeId}/recovered?take=${encodeURIComponent(crashed[0].id)}`;
}
