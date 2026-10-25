// "Listen on" directories: where the show lives in each podcast app. Pure and
// shared by the studio form (validation) and the public pages (what to render).
// The URL is whatever the directory gave the owner; we only accept https links on
// that directory's own hosts, so a typo or a paste of the wrong thing can't put a
// foreign or javascript: link on the public page.
export const DIRECTORIES = [
  { id: "apple", label: "Apple Podcasts", hint: "https://podcasts.apple.com/…", hosts: ["podcasts.apple.com", "itunes.apple.com"] },
  { id: "spotify", label: "Spotify", hint: "https://open.spotify.com/show/…", hosts: ["open.spotify.com", "spotify.link"] },
  { id: "youtubeMusic", label: "YouTube Music", hint: "https://music.youtube.com/…", hosts: ["music.youtube.com", "youtube.com", "youtu.be"] },
  { id: "pocketCasts", label: "Pocket Casts", hint: "https://pca.st/…", hosts: ["pocketcasts.com", "pca.st"] },
  { id: "overcast", label: "Overcast", hint: "https://overcast.fm/…", hosts: ["overcast.fm"] },
  { id: "amazon", label: "Amazon Music", hint: "https://music.amazon.com/…", hosts: ["music.amazon.com", "music.amazon.co.uk", "music.amazon.ca", "music.amazon.de", "music.amazon.com.au", "amzn.to"] },
] as const;
export type DirectoryId = (typeof DIRECTORIES)[number]["id"];
export type DirectoryLinks = Partial<Record<DirectoryId, string>>;

function hostOk(host: string, allowed: readonly string[]) {
  const h = host.toLowerCase();
  return allowed.some((a) => h === a || h.endsWith(`.${a}`));
}

/** "" → cleared (null). Otherwise an https URL on one of the directory's hosts. */
export function normalizeDirectoryUrl(
  id: DirectoryId,
  raw: string,
): { ok: true; value: string | null } | { ok: false; error: string } {
  const d = DIRECTORIES.find((x) => x.id === id);
  if (!d) return { ok: false, error: "Unknown directory." };
  const value = raw.trim();
  if (!value) return { ok: true, value: null };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, error: `${d.label}: that isn't a full link (start with https://).` };
  }
  if (url.protocol !== "https:") return { ok: false, error: `${d.label}: the link must start with https://.` };
  if (!hostOk(url.hostname, d.hosts)) {
    return { ok: false, error: `${d.label}: that link isn't on ${d.hosts[0]}. Paste the show's page from ${d.label}.` };
  }
  return { ok: true, value: url.toString() };
}

/** Reads the stored map defensively (settings is free-form JSON). */
export function readDirectoryLinks(raw: unknown): DirectoryLinks {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: DirectoryLinks = {};
  for (const d of DIRECTORIES) {
    const v = r[d.id];
    if (typeof v === "string" && normalizeDirectoryUrl(d.id, v).ok && v) out[d.id] = v;
  }
  return out;
}
