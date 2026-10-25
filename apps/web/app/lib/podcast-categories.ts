// Apple Podcasts' category list: the only values `itunes:category` should carry
// (directories reject or ignore anything else), so the picker is a closed list.
export const PODCAST_CATEGORIES: Record<string, string[]> = {
  Arts: ["Books", "Design", "Fashion & Beauty", "Food", "Performing Arts", "Visual Arts"],
  Business: ["Careers", "Entrepreneurship", "Investing", "Management", "Marketing", "Non-Profit"],
  Comedy: ["Comedy Interviews", "Improv", "Stand-Up"],
  Education: ["Courses", "How To", "Language Learning", "Self-Improvement"],
  Fiction: ["Comedy Fiction", "Drama", "Science Fiction"],
  Government: [],
  "Health & Fitness": ["Alternative Health", "Fitness", "Medicine", "Mental Health", "Nutrition", "Sexuality"],
  History: [],
  "Kids & Family": ["Education for Kids", "Parenting", "Pets & Animals", "Stories for Kids"],
  Leisure: ["Animation & Manga", "Automotive", "Aviation", "Crafts", "Games", "Hobbies", "Home & Garden", "Video Games"],
  Music: ["Music Commentary", "Music History", "Music Interviews"],
  News: ["Business News", "Daily News", "Entertainment News", "News Commentary", "Politics", "Sports News", "Tech News"],
  "Religion & Spirituality": ["Buddhism", "Christianity", "Hinduism", "Islam", "Judaism", "Religion", "Spirituality"],
  Science: ["Astronomy", "Chemistry", "Earth Sciences", "Life Sciences", "Mathematics", "Natural Sciences", "Nature", "Physics", "Social Sciences"],
  "Society & Culture": ["Documentary", "Personal Journals", "Philosophy", "Places & Travel", "Relationships"],
  Sports: ["Baseball", "Basketball", "Cricket", "Fantasy Sports", "Football", "Golf", "Hockey", "Rugby", "Running", "Soccer", "Swimming", "Tennis", "Volleyball", "Wilderness", "Wrestling"],
  Technology: [],
  "True Crime": [],
  "TV & Film": ["After Shows", "Film History", "Film Interviews", "Film Reviews", "TV Reviews"],
};

/** Normalises a stored/submitted pair: unknown primary → none; unknown or mismatched sub → dropped. */
export function cleanCategory(primary: unknown, sub: unknown): { primary: string; sub: string | null } | null {
  if (typeof primary !== "string" || !Object.hasOwn(PODCAST_CATEGORIES, primary)) return null;
  const ok = typeof sub === "string" && PODCAST_CATEGORIES[primary]!.includes(sub);
  return { primary, sub: ok ? (sub as string) : null };
}
