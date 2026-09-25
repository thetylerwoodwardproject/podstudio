/*
 * For episode pages, rendered on the server: the episode and what its pages
 * need up front (script, show setup, pads), from the database. Pages hand the
 * data to <EpisodeData>, which puts it in this browser's storage before the
 * page's scripts run, so they read it as before (and still work offline).
 */
import { context } from '../../server/context.ts';
import type { EpisodeData } from '../../server/library.ts';

export type { EpisodeData };

export function episodePage(id: string | undefined): EpisodeData | null {
  if (!id) return null;
  return context().library.data(id);
}
