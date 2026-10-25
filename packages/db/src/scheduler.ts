import type { Database } from "better-sqlite3";

// Scheduled publishing. An episode in status "scheduled" goes live once its
// publish_at has passed: status -> published, visibility -> public. publish_at is
// left as the scheduled time (it becomes the item's pubDate). Only episodes whose
// audio is a *verified* asset are published — the same rule as "Publish now"; a
// due episode without it stays scheduled and is reported as blocked.
//
// One transaction, state-based and idempotent: running it twice, or from two
// processes, publishes each episode once (the second run finds nothing due).
// Takes the handle as a parameter so it carries no import-time DB connection.
export function publishDueEpisodes(
  sqlite: Database,
  now = Date.now(),
): { published: string[]; blocked: string[] } {
  const due = sqlite.prepare(
    `select e.id as id, (a.id is not null) as hasAudio
       from episodes e
       left join assets a on a.id = e.audio_asset_id and a.status = 'verified'
      where e.status = 'scheduled' and e.publish_at is not null and e.publish_at <= ?`,
  );
  const publish = sqlite.prepare(
    `update episodes set status = 'published', visibility = 'public', updated_at = ?
      where id = ? and status = 'scheduled'`,
  );
  return sqlite.transaction(() => {
    const published: string[] = [];
    const blocked: string[] = [];
    for (const row of due.all(now) as { id: string; hasAudio: number }[]) {
      if (!row.hasAudio) blocked.push(row.id);
      else if (publish.run(now, row.id).changes === 1) published.push(row.id);
    }
    return { published, blocked };
  }).immediate();
}
