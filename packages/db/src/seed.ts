// Seeds the mockup's fixture data (The Mic Drop; Alex Rivera, Dana Ruiz; Ep. 38-43)
// per BUILD_PLAN §6: "use the mockup data... for seeds and Playwright." Idempotent —
// safe to run repeatedly against the same DB file.
import { randomUUID } from "node:crypto";
import { v5 as uuidv5 } from "uuid";
import { db, sqlite, shows, people, episodes, episodePeople } from "./index";
import { eq } from "drizzle-orm";

// README "GUID rules": new show podcast:guid is UUID v5 of this fixed namespace +
// the canonical feed URL with scheme and trailing slashes stripped.
const SHOW_GUID_NAMESPACE = "ead4c236-bf58-58c6-a2c6-a6b28d128cb6";

function canonicalFeedUrl(url: string) {
  return url.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

function seed() {
  const showSlug = "the-mic-drop";
  const feedUrl = `https://studio.tylerwoodward.me/${showSlug}/feed`;
  const podcastGuid = uuidv5(canonicalFeedUrl(feedUrl), SHOW_GUID_NAMESPACE);

  let show = db.select().from(shows).where(eq(shows.slug, showSlug)).get();
  if (!show) {
    show = {
      id: randomUUID(),
      slug: showSlug,
      title: "The Mic Drop",
      podcastGuid,
      feedUrl,
      locked: 0,
      unlockedUntil: null,
      website: null,
      ownerEmail: "tyler@fullymodulated.com",
      timezone: "America/Chicago",
      description:
        "Two voices, one mic, and whatever sports story won't leave us alone this week.",
      language: "en",
      explicit: 0,
      podcastTags: null,
      settings: null,
      theme: null,
      shortStyle: null,
      createdAt: Date.now(),
    };
    db.insert(shows).values(show).run();
    console.log(`seeded show "${show.title}" (${show.id})`);
  } else {
    console.log(`show "${show.title}" already seeded, skipping`);
  }

  const peopleFixtures = [
    { name: "Alex Rivera", role: "host" },
    { name: "Dana Ruiz", role: "guest" },
  ] as const;

  const personIds: Record<string, string> = {};
  for (const p of peopleFixtures) {
    let row = db
      .select()
      .from(people)
      .where(eq(people.showId, show.id))
      .all()
      .find((r) => r.name === p.name);
    if (!row) {
      row = {
        id: randomUUID(),
        showId: show.id,
        name: p.name,
        role: p.role,
        avatar: null,
        website: null,
        socials: null,
        bio: null,
        avatarAssetId: null,
      };
      db.insert(people).values(row).run();
      console.log(`seeded person "${p.name}" (${p.role})`);
    }
    personIds[p.name] = row.id;
  }

  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const episodeFixtures = [
    { number: 38, title: "The Last Honest Mechanic", status: "published", durationS: 51 * 60 + 12, daysAgo: 28 },
    { number: 39, title: "Rebuilding After the Flood", status: "published", durationS: 47 * 60 + 40, daysAgo: 21 },
    { number: 40, title: "What the Scouts Missed", status: "published", durationS: 55 * 60 + 3, daysAgo: 14 },
    { number: 41, title: "Dana's Draft Day Rules", status: "editing", durationS: 49 * 60 + 58, daysAgo: 2 },
    { number: 42, title: "The Transfer Portal, Explained", status: "scheduled", durationS: 44 * 60 + 15, daysAgo: 0 },
    { number: 43, title: "Live From the Parking Lot", status: "recording", durationS: null, daysAgo: 0 },
  ] as const;

  for (const ep of episodeFixtures) {
    const exists = db
      .select()
      .from(episodes)
      .where(eq(episodes.showId, show.id))
      .all()
      .find((r) => r.number === ep.number);
    if (exists) continue;

    const slug = ep.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
    const episodeId = randomUUID();

    db.insert(episodes)
      .values({
        id: episodeId,
        showId: show.id,
        guid: randomUUID(), // new episode: UUID v4 at creation, per GUID rules
        guidIsPermalink: null,
        number: ep.number,
        season: 1,
        title: ep.title,
        subtitle: null,
        slug,
        publicId: randomUUID(),
        status: ep.status,
        visibility: ep.status === "published" ? "public" : "private",
        description: null,
        explicit: 0,
        publishAt: ep.status === "scheduled" ? now + day : null,
        durationS: ep.durationS,
        hasVideo: 0,
        artworkUrl: null,
        branding: null,
        createdAt: now - ep.daysAgo * day,
        updatedAt: now - ep.daysAgo * day,
      })
      .run();

    db.insert(episodePeople)
      .values([
        { episodeId, personId: personIds["Alex Rivera"], role: "host" },
        { episodeId, personId: personIds["Dana Ruiz"], role: "guest" },
      ])
      .run();

    console.log(`seeded episode ${ep.number} "${ep.title}" (${ep.status})`);
  }

  sqlite.close();
}

seed();
