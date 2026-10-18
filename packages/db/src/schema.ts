// Drizzle schema (SQLite via better-sqlite3), subset of BUILD_PLAN.md §4 needed for
// tonight's shell: users, shows, people, episodes, episode_people. Later stages add
// the remaining tables (projects, assets, recordings, feed_revisions, jobs, ...) as
// their stage starts, per BUILD_PLAN §4's own instruction not to introduce them all
// in Foundation.
//
// Conventions: ids are text UUIDv4, timestamps are integer unix-ms, booleans are
// integer 0/1, JSON blobs are stored as text.
import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  emailVerifiedAt: integer("email_verified_at"),
  name: text("name").notNull(),
  role: text("role", { enum: ["admin", "editor"] }).notNull().default("editor"),
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch('now','subsec')*1000)`),
});

export const shows = sqliteTable("shows", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  // Immutable once set — enforce with a BEFORE UPDATE trigger in a later migration
  // once imports (Stage 06) can actually populate/compare it.
  podcastGuid: text("podcast_guid").notNull().unique(),
  feedUrl: text("feed_url"),
  locked: integer("locked").notNull().default(0),
  unlockedUntil: integer("unlocked_until"),
  website: text("website"),
  ownerEmail: text("owner_email").notNull(),
  timezone: text("timezone").notNull().default("UTC"),
  settings: text("settings", { mode: "json" }),
  theme: text("theme", { mode: "json" }),
  shortStyle: text("short_style", { mode: "json" }),
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch('now','subsec')*1000)`),
});

export const people = sqliteTable("people", {
  id: text("id").primaryKey(),
  showId: text("show_id")
    .notNull()
    .references(() => shows.id),
  name: text("name").notNull(),
  role: text("role"), // host | guest | music | sfx (free text for now)
  avatar: text("avatar"),
  website: text("website"),
  socials: text("socials", { mode: "json" }),
});

export const episodeStatus = [
  "recording",
  "editing",
  "scheduled",
  "published",
] as const;
export type EpisodeStatus = (typeof episodeStatus)[number];

export const episodes = sqliteTable(
  "episodes",
  {
    id: text("id").primaryKey(),
    showId: text("show_id")
      .notNull()
      .references(() => shows.id),
    // Immutable on import; UUID v4 generated once at creation for new episodes.
    guid: text("guid").notNull(),
    guidIsPermalink: integer("guid_is_permalink"), // null = attribute absent
    number: integer("number"),
    season: integer("season"),
    title: text("title").notNull(),
    subtitle: text("subtitle"),
    slug: text("slug").notNull(),
    publicId: text("public_id").notNull().unique(),
    status: text("status", { enum: episodeStatus }).notNull().default("recording"),
    visibility: text("visibility", { enum: ["private", "unlisted", "public"] })
      .notNull()
      .default("private"),
    description: text("description"),
    explicit: integer("explicit").notNull().default(0),
    publishAt: integer("publish_at"),
    durationS: integer("duration_s"),
    hasVideo: integer("has_video").notNull().default(0),
    artworkUrl: text("artwork_url"),
    branding: text("branding", { mode: "json" }),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch('now','subsec')*1000)`),
    updatedAt: integer("updated_at")
      .notNull()
      .default(sql`(unixepoch('now','subsec')*1000)`),
  },
  (t) => [uniqueIndex("episodes_show_guid_unique").on(t.showId, t.guid)],
);

export const episodePeople = sqliteTable("episode_people", {
  episodeId: text("episode_id")
    .notNull()
    .references(() => episodes.id),
  personId: text("person_id")
    .notNull()
    .references(() => people.id),
  role: text("role"), // host | guest
});
