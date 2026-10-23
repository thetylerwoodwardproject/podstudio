import { and, desc, eq } from "drizzle-orm";
import { db, shows, episodes } from "@podstudio/db";

// Server-only — same hard rule as every other `.server.ts` file: no
// @podstudio/db access in embeds.tsx itself. See CHANGELOG, "Real bug: two
// sidebar links silently failed to navigate."
//
// Embed config lives under the `embed` key of the existing `shows.settings`
// JSON column (BUILD_PLAN §4 gives embeds no table of their own). The screen
// edits one default configuration for the show; the snippets it generates are
// derived from it, nothing per-snippet is stored.
export const EMBED_SOURCES = ["episode", "latest", "all"] as const;
export const EMBED_PLAYERS = ["audio", "video"] as const;
export const EMBED_THEMES = ["dark", "light", "auto"] as const;
export const EMBED_ACCENTS = ["amber", "teal", "ink"] as const;

export type EmbedSource = (typeof EMBED_SOURCES)[number];
export type EmbedPlayer = (typeof EMBED_PLAYERS)[number];
export type EmbedTheme = (typeof EMBED_THEMES)[number];
export type EmbedAccent = (typeof EMBED_ACCENTS)[number];

export interface EmbedConfig {
  source: EmbedSource;
  /** Public id of the chosen episode; only meaningful when source === "episode". */
  episodePublicId: string | null;
  player: EmbedPlayer;
  theme: EmbedTheme;
  accent: EmbedAccent;
  chapters: boolean;
  transcript: boolean;
  follow: boolean;
}

export const DEFAULT_EMBED_CONFIG: EmbedConfig = {
  source: "latest",
  episodePublicId: null,
  player: "audio",
  theme: "dark",
  accent: "amber",
  chapters: true,
  transcript: true,
  follow: true,
};

function oneOf<T extends string>(allowed: readonly T[], value: unknown, fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

function readConfig(raw: unknown): EmbedConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_EMBED_CONFIG;
  return {
    source: oneOf(EMBED_SOURCES, r.source, d.source),
    episodePublicId: typeof r.episodePublicId === "string" ? r.episodePublicId : null,
    player: oneOf(EMBED_PLAYERS, r.player, d.player),
    theme: oneOf(EMBED_THEMES, r.theme, d.theme),
    accent: oneOf(EMBED_ACCENTS, r.accent, d.accent),
    chapters: typeof r.chapters === "boolean" ? r.chapters : d.chapters,
    transcript: typeof r.transcript === "boolean" ? r.transcript : d.transcript,
    follow: typeof r.follow === "boolean" ? r.follow : d.follow,
  };
}

export function getEmbedContext() {
  const show = db
    .select({ id: shows.id, slug: shows.slug, title: shows.title, settings: shows.settings })
    .from(shows)
    .get();
  if (!show) return null;

  // README: "Only public published episodes are eligible."
  const eligibleEpisodes = db
    .select({
      publicId: episodes.publicId,
      title: episodes.title,
      number: episodes.number,
      hasVideo: episodes.hasVideo,
    })
    .from(episodes)
    .where(
      and(
        eq(episodes.showId, show.id),
        eq(episodes.status, "published"),
        eq(episodes.visibility, "public"),
      ),
    )
    .orderBy(desc(episodes.number))
    .all();

  const settings = (show.settings && typeof show.settings === "object" ? show.settings : {}) as Record<
    string,
    unknown
  >;
  const config = readConfig(settings.embed);
  // A stored episode that's since been unpublished/made private is no longer
  // eligible — treat it as unset rather than emitting a snippet that 404s.
  if (
    config.source === "episode" &&
    !eligibleEpisodes.some((e) => e.publicId === config.episodePublicId)
  ) {
    config.episodePublicId = null;
  }

  return { slug: show.slug, title: show.title, config, eligibleEpisodes };
}

export function saveEmbedConfig(
  input: Partial<Record<keyof EmbedConfig, unknown>>,
): { ok: true } | { ok: false; error: string } {
  const show = db.select({ id: shows.id, settings: shows.settings }).from(shows).get();
  if (!show) return { ok: false, error: "No show seeded yet." };

  const config = readConfig(input);

  if (config.source === "episode") {
    const eligible = db
      .select({ id: episodes.id })
      .from(episodes)
      .where(
        and(
          eq(episodes.showId, show.id),
          eq(episodes.publicId, config.episodePublicId ?? ""),
          eq(episodes.status, "published"),
          eq(episodes.visibility, "public"),
        ),
      )
      .get();
    if (!eligible) {
      return { ok: false, error: "Pick a public, published episode to embed." };
    }
  } else {
    config.episodePublicId = null;
  }

  const settings = (show.settings && typeof show.settings === "object" ? show.settings : {}) as Record<
    string,
    unknown
  >;
  db.update(shows)
    .set({ settings: { ...settings, embed: config } })
    .where(eq(shows.id, show.id))
    .run();
  return { ok: true };
}
