import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBluesky,
  faFacebook,
  faInstagram,
  faLinkedin,
  faMastodon,
  faThreads,
  faTiktok,
  faXTwitter,
  faYoutube,
  type IconDefinition,
} from "@fortawesome/free-brands-svg-icons";
import {
  faCopy,
  faRotate,
  faWandMagicSparkles,
  faFeather,
  faDownload,
  faPaperPlane,
  faArrowRotateLeft,
  faCheck,
  faPlay,
  faPause,
  faImage,
  faMusic,
  faXmark,
  faFont,
  faUpload,
} from "@fortawesome/free-solid-svg-icons";
import { listEpisodeRows } from "~/lib/episodes.server";
import { artworkFile, getShowArtwork } from "~/lib/artwork.server";
import { getSocialBrandInfo } from "~/lib/social.server";
import { getEpisodeArtAdmin } from "~/lib/episode-art.server";
import { accentHex, BRAND_PRESETS, normalizeHex, readBrandTheme } from "~/lib/brand-theme";
import { draw as drawPost, fontSpecs, formats, setBrand } from "~/lib/social-render/render";
import { autoLayout, darkens, layoutLabels, type Layout } from "~/lib/social-render/layout";
import { drawReel, REEL_H, REEL_W } from "~/lib/social-render/video";
import { drawSlide, SLIDE_H, SLIDE_W, type Slide } from "~/lib/social-render/carousel";
import { artFormats, drawArtwork } from "~/lib/social-render/artwork";
import { analyse, BAR_COUNT, decodeAudio, FPS } from "~/lib/social-render/audio";
import { Page, PageHeader } from "~/components/layout/page";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardAction, CardFooter } from "~/components/ui/card";
import { FormSelect } from "~/components/ui/form-select";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Separator } from "~/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger, SheetFooter } from "~/components/ui/sheet";
import { Slider } from "~/components/ui/slider";
import { Switch } from "~/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { Textarea } from "~/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";

// MOCKUP of the social tools planned for Stage 07 (post copy) and Stage 10c
// (graphics, carousel, reels). Graphics, carousel slides and reels are drawn by
// the TWP social generator's own canvas renderer (lib/social-render), so they
// match tylerwoodward.me/social-generator exactly. Post text is sample text built
// from the episode and the Customize settings; nothing calls an AI provider or a
// platform. Settings are kept in this browser only (the real build saves them
// with the show). Design notes: docs/notes/social-generator.md.
export async function loader({ request }: { request: Request }) {
  const { show, rows } = listEpisodeRows();
  const art = getShowArtwork();
  const info = getSocialBrandInfo();
  let domain = new URL(request.url).host;
  try {
    if (info.website) domain = new URL(info.website).host.replace(/^www\./, "");
  } catch {
    /* keep the request host */
  }
  return {
    showTitle: show?.title ?? "Your show",
    host: info.host ?? show?.title ?? "",
    domain,
    brandAccent: accentHex(readBrandTheme(show?.theme)),
    artUrl: art ? `/${art.slug}/artwork/${artworkFile(art)}` : null,
    // Oldest first gets ordinal 0, so each episode keeps its place in the layout rotation.
    episodes: rows.slice(0, 24).map((r, i) => ({ id: r.id, number: r.number, title: r.title, guest: r.guest, ordinal: rows.length - 1 - i, art: getEpisodeArtAdmin(r.id)?.url ?? null })),
  };
}

type Ep = Awaited<ReturnType<typeof loader>>["episodes"][number];

// ---------------------------------------------------------------- settings

type PlatformId = "bluesky" | "threads" | "mastodon" | "x" | "facebook" | "instagram" | "linkedin" | "youtube";
const LAYOUT_NAMES = Object.keys(layoutLabels); // Split, Full bleed, Framed, Corner, Band, None
type Wordmark = "Stacked" | "Domain" | "Logo";

// Faces for headlines and wordmarks. All self-hosted (app.css), so nothing loads from a third party.
interface FontDef {
  id: string;
  label: string;
  kind: string;
  family: string;
  /** Weight the wordmark uses with this face. */
  mark: number;
  mono?: boolean;
}
const FONTS: FontDef[] = [
  { id: "archivo", label: "Archivo", kind: "Sans", family: 'Archivo, "Archivo Fallback", sans-serif', mark: 600 },
  { id: "geist", label: "Geist", kind: "Sans", family: "Geist, sans-serif", mark: 700 },
  { id: "space-grotesk", label: "Space Grotesk", kind: "Sans", family: '"Space Grotesk", sans-serif', mark: 700 },
  { id: "oswald", label: "Oswald", kind: "Condensed", family: "Oswald, sans-serif", mark: 600 },
  { id: "dm-serif", label: "DM Serif Display", kind: "Serif", family: '"DM Serif Display", serif', mark: 400 },
  { id: "jetbrains", label: "JetBrains Mono", kind: "Mono", family: '"JetBrains Mono", ui-monospace, monospace', mark: 700, mono: true },
  { id: "space-mono", label: "Space Mono", kind: "Mono", family: '"Space Mono", ui-monospace, monospace', mark: 700, mono: true },
  { id: "plex-mono", label: "IBM Plex Mono", kind: "Mono", family: '"IBM Plex Mono", ui-monospace, monospace', mark: 600, mono: true },
];
interface CustomFont {
  id: string;
  label: string;
  data: string; // data: URL, so it survives a reload
}

interface Settings {
  posts: {
    platforms: PlatformId[];
    length: "short" | "standard" | "long";
    hashtags: number;
    emoji: boolean;
    tagGuests: boolean;
    link: boolean;
    cta: "listen" | "out-now" | "none";
  };
  look: { template: "headline" | "quote"; layout: string; accent: string; darken: number; wordmark: Wordmark; waveform: boolean };
  carousel: { slides: number; numbers: boolean; quotes: boolean; swipe: boolean };
  clips: { layout: string; darken: number; wordmark: Wordmark; progress: boolean; safeZones: boolean };
  /** Show-level wordmark and fonts, used by every graphic. null = follow the show. */
  brand: { lines: string | null; domain: string | null; headFont: string; markFont: string; tint: "original" | "white" | "accent" };
}

const DEFAULTS: Settings = {
  posts: { platforms: ["bluesky", "threads", "mastodon", "facebook", "instagram", "youtube"], length: "standard", hashtags: 2, emoji: false, tagGuests: true, link: true, cta: "listen" },
  look: { template: "headline", layout: "auto", accent: "brand", darken: 60, wordmark: "Stacked", waveform: true },
  carousel: { slides: 6, numbers: true, quotes: true, swipe: true },
  clips: { layout: "auto", darken: 60, wordmark: "Stacked", progress: true, safeZones: false },
  brand: { lines: null, domain: null, headFont: "archivo", markFont: "jetbrains", tint: "original" },
};

const STORE = "podstudio.social.settings.v3";

function useSettings() {
  const [s, setS] = useState<Settings>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) {
        const v = JSON.parse(raw);
        setS({
          posts: { ...DEFAULTS.posts, ...v.posts },
          look: { ...DEFAULTS.look, ...v.look },
          carousel: { ...DEFAULTS.carousel, ...v.carousel },
          clips: { ...DEFAULTS.clips, ...v.clips },
          brand: { ...DEFAULTS.brand, ...v.brand },
        });
      }
    } catch {
      /* storage can be blocked; defaults work */
    }
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(STORE, JSON.stringify(s));
    } catch {
      /* ignore */
    }
  }, [s, loaded]);
  const set = <K extends keyof Settings>(k: K, patch: Partial<Settings[K]>) => setS((cur) => ({ ...cur, [k]: { ...cur[k], ...patch } }));
  const reset = (k: keyof Settings) => setS((cur) => ({ ...cur, [k]: DEFAULTS[k] }));
  return { s, set, reset };
}

// ---------------------------------------------------------------- platform rules

const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter("en", { granularity: "grapheme" }) : null;
const graphemes = (t: string) => (segmenter ? [...segmenter.segment(t)].length : [...t].length);
const codePoints = (t: string) => [...t].length;
const linksAs23 = (t: string) => codePoints(t.replace(/https?:\/\/\S+/g, "x".repeat(23)));

interface Platform {
  id: PlatformId;
  name: string;
  icon: IconDefinition;
  limit: number;
  count: (t: string) => number;
  rule: string;
  maxTags: number;
  linkInText: boolean;
}
const PLATFORMS: Platform[] = [
  { id: "bluesky", name: "Bluesky", icon: faBluesky, limit: 300, count: graphemes, rule: "Link becomes a card", maxTags: 3, linkInText: false },
  { id: "threads", name: "Threads", icon: faThreads, limit: 500, count: codePoints, rule: "No hashtags · one topic", maxTags: 0, linkInText: false },
  { id: "mastodon", name: "Mastodon", icon: faMastodon, limit: 500, count: linksAs23, rule: "Links count as 23", maxTags: 5, linkInText: true },
  { id: "x", name: "X", icon: faXTwitter, limit: 280, count: linksAs23, rule: "Links count as 23", maxTags: 2, linkInText: true },
  { id: "facebook", name: "Facebook", icon: faFacebook, limit: 2000, count: codePoints, rule: "Longer is fine", maxTags: 3, linkInText: true },
  { id: "instagram", name: "Instagram", icon: faInstagram, limit: 2200, count: codePoints, rule: "“Link in bio”", maxTags: 5, linkInText: false },
  { id: "linkedin", name: "LinkedIn", icon: faLinkedin, limit: 3000, count: codePoints, rule: "Professional angle", maxTags: 3, linkInText: true },
  { id: "youtube", name: "YouTube", icon: faYoutube, limit: 5000, count: codePoints, rule: "Description with chapters", maxTags: 3, linkInText: true },
];

const TAG_POOL = ["podcast", "radio", "broadcasting", "tech", "audio"];
const LINK = "https://example.com/episode";

// ---------------------------------------------------------------- sample drafts

function composePost(p: Platform, ep: Ep | undefined, o: Settings["posts"], variant: number): string {
  const title = ep?.title ?? "the new episode";
  const n = ep?.number != null ? `Ep. ${ep.number}` : "The new episode";
  const v = variant % 3;
  const guest = ep?.guest ? (o.tagGuests ? ` with @${ep.guest.replace(/\s+/g, "")}` : ` with ${ep.guest}`) : "";
  const emoji = o.emoji ? " 🎙️" : "";
  const opener = [`${n} is out: ${title}${guest}.${emoji}`, `New episode: ${title}${guest}.${emoji}`, `${title}${guest}.${emoji}`][v];
  const mid = [
    "One conversation, no filler, and a few things I got wrong last time.",
    "I went in expecting one answer and came out with a better question.",
    "The part I keep thinking about is in the last ten minutes.",
  ][v];
  const more = "We get into how it really works, what most people miss, and what I'd change if I were starting over.";
  const cta = { listen: "Listen wherever you get podcasts.", "out-now": "Out now.", none: "" }[o.cta];

  if (p.id === "youtube") {
    return [`${title}${guest}.`, mid, "", "Chapters", "00:00 Intro", "04:12 The setup", "18:40 What went wrong", "31:05 What I'd do now", "", `Show notes and transcript: ${LINK}`].join("\n");
  }
  if (p.id === "linkedin") {
    return [`In ${ep?.number != null ? n : "the new episode"} I talk through ${title.toLowerCase()}${guest}.`, "", "Three takeaways for anyone in the field:", "1. Start with the signal path.", "2. Document what you change.", "3. Test it the way listeners hear it.", o.link ? `\n${LINK}` : ""].join("\n").trim();
  }

  const body = o.length === "short" || p.id === "x" ? [opener] : o.length === "standard" ? [opener, mid] : [opener, mid, more];
  if (p.id === "instagram") body.push("Full episode: link in bio.");
  else if (cta) body.push(cta);

  let text = body.join(p.id === "instagram" || o.length === "long" ? "\n\n" : " ");
  if (o.link && p.linkInText) text += `\n\n${LINK}`;
  const tags = Math.min(o.hashtags, p.maxTags);
  if (tags > 0) text += `\n\n${TAG_POOL.slice(0, tags).map((t) => `#${t}`).join(" ")}`;
  return text;
}

const DEFAULT_VOICE = `First person, plain and conversational, like talking to someone who works in the same building. Short sentences. Specific over general.

Lead with the interesting fact or the point, not with "In this episode" or "Check out".

No hype words (game-changer, dive in, unpack), no clickbait, no rhetorical-question openers, at most one emoji, no exclamation-mark pile-ups.

Never invent facts, quotes, numbers or guests. Quotes are word for word from the transcript.`;

// ---------------------------------------------------------------- page

interface Audio {
  name: string;
  buf: AudioBuffer;
  bars: Float32Array;
}

interface Ctx {
  ep: Ep | undefined;
  showTitle: string;
  host: string;
  domain: string;
  artUrl: string | null;
  accent: string;
  brandAccent: string;
  s: Settings;
  set: <K extends keyof Settings>(k: K, patch: Partial<Settings[K]>) => void;
  reset: (k: keyof Settings) => void;
  flash: (m: string) => void;
  /** The show's art (or an upload), loaded and ready to draw; null until then. */
  image: HTMLImageElement | null;
  upload: string | null;
  setUpload: (url: string | null) => void;
  /** Changes whenever a face loads or the wordmark/fonts change, so every canvas redraws. */
  fonts: string;
  logo: string | null;
  setLogo: (l: string | null) => void;
  custom: CustomFont[];
  addFont: (f: CustomFont) => void;
  allFonts: FontDef[];
  stackedAuto: string[];
  audio: Audio | null;
  setAudio: (a: Audio | null) => void;
  /** Points the ported renderer at this show before each draw. */
  brand: () => void;
}

// "The Tyler Woodward Project" -> TYLER / WOODWARD / PROJECT, like the TWP wordmark.
function stackWords(title: string) {
  const all = title.toUpperCase().split(/\s+/).filter(Boolean);
  // Drop a leading "The" only when two or more words remain ("The Daily" stays THE / DAILY).
  const words = all[0] === "THE" && all.length > 2 ? all.slice(1) : all;
  if (words.length <= 3) return words.length ? words : ["PODCAST"];
  const lines: string[] = [];
  const per = Math.ceil(words.length / 3);
  for (let i = 0; i < words.length; i += per) lines.push(words.slice(i, i + per).join(" "));
  return lines;
}

function useImage(url: string | null) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    setImg(null);
    if (!url) return;
    const i = new Image();
    i.onload = () => setImg(i);
    i.src = url;
  }, [url]);
  return img;
}

const ASSETS = "podstudio.social.assets.v1";

function useAssets() {
  const [logo, setLogoState] = useState<string | null>(null);
  const [custom, setCustom] = useState<CustomFont[]>([]);
  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem(ASSETS) ?? "{}");
      if (typeof v.logo === "string") setLogoState(v.logo);
      if (Array.isArray(v.fonts)) setCustom(v.fonts);
    } catch {
      /* ignore */
    }
  }, []);
  const save = (next: { logo: string | null; fonts: CustomFont[] }) => {
    try {
      localStorage.setItem(ASSETS, JSON.stringify(next));
    } catch {
      /* too big or blocked: it still works until reload */
    }
  };
  return {
    logo,
    custom,
    setLogo: (l: string | null) => {
      setLogoState(l);
      save({ logo: l, fonts: custom });
    },
    addFont: (f: CustomFont) => {
      const fonts = [...custom.filter((x) => x.id !== f.id), f];
      setCustom(fonts);
      save({ logo, fonts });
    },
  };
}

const readDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });

/** The logo, rasterized (SVGs without a size get one) and recolored when asked. */
function useLogo(src: string | null, tint: Settings["brand"]["tint"], accent: string) {
  const img = useImage(src);
  return useMemo(() => {
    if (!img || typeof document === "undefined") return null;
    const w0 = img.naturalWidth || 1200,
      h0 = img.naturalHeight || 1200;
    const k = 1200 / Math.max(w0, h0);
    const c = document.createElement("canvas");
    c.width = Math.round(w0 * k);
    c.height = Math.round(h0 * k);
    const g = c.getContext("2d");
    if (!g) return null;
    g.drawImage(img, 0, 0, c.width, c.height);
    if (tint !== "original") {
      g.globalCompositeOperation = "source-in";
      g.fillStyle = tint === "white" ? "#f5f5f2" : accent;
      g.fillRect(0, 0, c.width, c.height);
    }
    return c;
  }, [img, tint, accent]);
}

function useFonts() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    Promise.all(fontSpecs.map((f) => document.fonts.load(f)))
      .catch(() => {})
      .then(() => setReady(true));
  }, []);
  return ready;
}

export default function Social({ loaderData }: { loaderData: Awaited<ReturnType<typeof loader>> }) {
  const { showTitle, host, domain, episodes, artUrl, brandAccent } = loaderData;
  const [epId, setEpId] = useState(episodes[0]?.id ?? "");
  const ep = episodes.find((e) => e.id === epId);
  const { s, set, reset } = useSettings();
  const [toast, setToast] = useState<string | null>(null);
  const [upload, setUpload] = useState<string | null>(null);
  const [audio, setAudio] = useState<Audio | null>(null);
  const art = ep?.art ?? artUrl;
  const image = useImage(upload ?? art);
  const baseFonts = useFonts();
  const { logo, setLogo, custom, addFont } = useAssets();
  const [fontRev, setFontRev] = useState(0);
  const allFonts = useMemo<FontDef[]>(
    () => [...FONTS, ...custom.map((f) => ({ id: f.id, label: f.label, kind: "Your fonts", family: `"${f.id}"`, mark: 400 }))],
    [custom],
  );
  // Register uploaded faces with the document, then load whichever faces are picked.
  useEffect(() => {
    for (const f of custom) {
      if ([...document.fonts].some((x) => x.family === f.id)) continue;
      const face = new FontFace(f.id, `url(${f.data})`);
      document.fonts.add(face);
      face.load().then(() => setFontRev((r) => r + 1)).catch(() => {});
    }
  }, [custom]);
  const headFace = allFonts.find((f) => f.id === s.brand.headFont) ?? FONTS[0];
  const markFace = allFonts.find((f) => f.id === s.brand.markFont) ?? FONTS[5];
  useEffect(() => {
    Promise.all([document.fonts.load(`500 40px ${headFace.family}`), document.fonts.load(`${markFace.mark} 40px ${markFace.family}`)])
      .catch(() => {})
      .then(() => setFontRev((r) => r + 1));
  }, [headFace.family, markFace.family, markFace.mark]);
  const fontsReady = baseFonts ? fontRev + 1 : 0;
  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 1600);
  };
  const accent = s.look.accent === "brand" ? brandAccent : (normalizeHex(s.look.accent) ?? brandAccent);
  const stackedAuto = useMemo(() => stackWords(showTitle), [showTitle]);
  const lines = s.brand.lines?.split("\n").map((x) => x.trim()).filter(Boolean);
  const stacked = lines?.length ? lines : stackedAuto;
  const logoCanvas = useLogo(logo, s.brand.tint, accent);
  const brand = () =>
    setBrand({
      stacked,
      domain: s.brand.domain?.trim() || domain,
      signal: accent,
      speaker: ep?.guest ?? host,
      sans: headFace.family,
      markFamily: markFace.family,
      markWeight: markFace.mark,
      markSpacing: markFace.mono ? 0.06 : 0.02,
      logo: logoCanvas,
    });
    const fonts = JSON.stringify({ fontsReady, b: s.brand, logo: !!logoCanvas, host, domain });
  const ctx: Ctx = { ep, showTitle, host, domain, artUrl: art, accent, s, set, reset, flash, brandAccent, image, upload, setUpload, fonts, audio, setAudio, brand, logo, setLogo, custom, addFont, allFonts, stackedAuto };

  return (
    <TooltipProvider delayDuration={250}>
      <Page width="wide" className="max-w-[1320px]">
        <PageHeader
          eyebrow="Publish & share"
          title="Social"
          description="Posts, graphics, carousels and reels for every platform, made from your episode. Review, tweak and copy; nothing posts on its own."
          actions={
            <>
              <FormSelect
                aria-label="Episode"
                value={epId}
                onValueChange={setEpId}
                className="w-full sm:w-[300px]"
                placeholder="Pick an episode"
                options={episodes.map((e) => ({ value: e.id, label: `${e.number != null ? `Ep. ${e.number} · ` : ""}${e.title}` }))}
              />
              <BrandSheet {...ctx} />
              <VoiceSheet onSave={() => flash("Voice saved")} />
            </>
          }
          below={
            <Badge variant="secondary" className="font-normal text-muted-foreground">
              Preview · sample text until AI writing arrives
            </Badge>
          }
        />

        {episodes.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-[13.5px] text-muted-foreground">Create an episode first; social posts are written from it.</CardContent>
          </Card>
        ) : (
          <Tabs defaultValue="posts" className="gap-5">
            <TabsList className="w-full justify-start sm:w-fit">
              <TabsTrigger value="posts">Posts</TabsTrigger>
              <TabsTrigger value="graphics">Graphics</TabsTrigger>
              <TabsTrigger value="carousel">Carousel</TabsTrigger>
              <TabsTrigger value="clips">Reels</TabsTrigger>
            </TabsList>
            <TabsContent value="posts">
              <PostsTab {...ctx} />
            </TabsContent>
            <TabsContent value="graphics">
              <GraphicsTab {...ctx} />
            </TabsContent>
            <TabsContent value="carousel">
              <CarouselTab {...ctx} />
            </TabsContent>
            <TabsContent value="clips">
              <ClipsTab {...ctx} />
            </TabsContent>
          </Tabs>
        )}

        {toast && (
          <div role="status" className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full bg-foreground px-4 py-2 text-[13px] font-medium text-background shadow-lg">
            <FontAwesomeIcon icon={faCheck} className="text-[11px]" />
            {toast}
          </div>
        )}
      </Page>
    </TooltipProvider>
  );
}

// ---------------------------------------------------------------- shared bits

function Workspace({ panel, children }: { panel: ReactNode; children: ReactNode }) {
  return (
    <div className="grid items-start gap-5 lg:grid-cols-[292px_minmax(0,1fr)]">
      <div className="lg:sticky lg:top-4">{panel}</div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Panel({ title, onReset, children, footer }: { title: string; onReset: () => void; children: ReactNode; footer?: ReactNode }) {
  return (
    <Card className="gap-0 py-0">
      <div className="flex items-center justify-between px-4 pb-2 pt-3.5">
        <span className="text-[13px] font-semibold">{title}</span>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-[12px] text-muted-foreground" onClick={onReset}>
          <FontAwesomeIcon icon={faArrowRotateLeft} className="text-[10px]" />
          Reset
        </Button>
      </div>
      <Separator />
      <div className="flex flex-col gap-4 px-4 py-4">{children}</div>
      {footer && (
        <>
          <Separator />
          <div className="px-4 py-3">{footer}</div>
        </>
      )}
    </Card>
  );
}

function Field({ label, hint, children, inline }: { label: string; hint?: string; children: ReactNode; inline?: boolean }) {
  if (inline)
    return (
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[12.5px] font-medium">{label}</div>
          {hint && <div className="text-[11.5px] leading-snug text-muted-foreground">{hint}</div>}
        </div>
        {children}
      </div>
    );
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12.5px] font-medium">{label}</span>
        {hint && <span className="text-[11.5px] text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; disabled?: boolean }[]; label: string }) {
  return (
    <ToggleGroup type="single" variant="outline" size="sm" value={value} onValueChange={(v) => v && onChange(v as T)} className="w-full" aria-label={label}>
      {options.map((o) => (
        <ToggleGroupItem key={o.value} value={o.value} disabled={o.disabled} className="flex-1 px-1.5 text-[12px]">
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

function AccentPicker({ value, brand, onChange }: { value: string; brand: string; onChange: (v: string) => void }) {
  const presets = Object.values(BRAND_PRESETS).filter((p) => p.hex !== "#000000" && p.hex !== brand.toLowerCase());
  const custom = value !== "brand" && !presets.some((p) => p.hex === value);
  const swatch = (hex: string, active: boolean, label: string, onClick: () => void) => (
    <Tooltip key={label}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={active}
          onClick={onClick}
          className={cn("size-7 rounded-full ring-offset-2 ring-offset-card transition-shadow", active ? "ring-2 ring-foreground" : "ring-1 ring-border hover:ring-foreground/50")}
          style={{ background: hex }}
        />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
  return (
    <div className="flex flex-wrap items-center gap-2">
      {swatch(brand, value === "brand", "Brand accent", () => onChange("brand"))}
      <span className="h-5 w-px bg-border" aria-hidden />
      {presets.map((p) => swatch(p.hex, value === p.hex, p.label, () => onChange(p.hex)))}
      <label className={cn("relative size-7 cursor-pointer overflow-hidden rounded-full ring-offset-2 ring-offset-card", custom ? "ring-2 ring-foreground" : "ring-1 ring-border")} title="Custom color">
        <span className="absolute inset-0" style={{ background: custom ? value : "conic-gradient(#ff807f,#fabf47,#beff00,#00fff5,#c7bff6,#ff807f)" }} />
        <input type="color" aria-label="Custom color" className="absolute inset-0 cursor-pointer opacity-0" value={custom ? value : brand} onChange={(e) => onChange(e.target.value)} />
      </label>
    </div>
  );
}

// ---------------------------------------------------------------- posts

function PostsTab({ ep, s, set, reset, flash }: Ctx) {
  const o = s.posts;
  const [variants, setVariants] = useState<Record<string, number>>({});
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [topic, setTopic] = useState("Radio and Broadcasting");
  const key = ep?.id ?? "";
  const text = (p: Platform) => edits[`${key}:${p.id}`] ?? composePost(p, ep, o, variants[p.id] ?? 0);
  const active = PLATFORMS.filter((p) => o.platforms.includes(p.id));
  const clearEdit = (id: string) =>
    setEdits((cur) => {
      const next = { ...cur };
      delete next[`${key}:${id}`];
      return next;
    });

  const panel = (
    <Panel
      title="Customize"
      onReset={() => reset("posts")}
      footer={
        <Button
          className="w-full"
          onClick={() => {
            setVariants((v) => Object.fromEntries(PLATFORMS.map((p) => [p.id, (v[p.id] ?? 0) + 1])));
            setEdits({});
            flash(`${active.length} posts rewritten`);
          }}
        >
          <FontAwesomeIcon icon={faWandMagicSparkles} />
          Rewrite all
        </Button>
      }
    >
      <Field label="Platforms" hint={`${active.length} on`}>
        <div className="grid grid-cols-4 gap-1.5">
          {PLATFORMS.map((p) => {
            const on = o.platforms.includes(p.id);
            return (
              <Tooltip key={p.id}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-pressed={on}
                    aria-label={p.name}
                    onClick={() => set("posts", { platforms: on ? o.platforms.filter((x) => x !== p.id) : [...o.platforms, p.id] })}
                    className={cn(
                      "flex h-9 items-center justify-center rounded-md border text-[15px] transition-colors",
                      on ? "border-foreground/30 bg-secondary text-foreground" : "border-border text-muted-foreground/50 hover:text-muted-foreground",
                    )}
                  >
                    <FontAwesomeIcon icon={p.icon} />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{p.name}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </Field>
      <Field label="Length">
        <Segmented
          label="Length"
          value={o.length}
          onChange={(length) => set("posts", { length })}
          options={[
            { value: "short", label: "Short" },
            { value: "standard", label: "Standard" },
            { value: "long", label: "Long" },
          ]}
        />
      </Field>
      <Field label="Hashtags" hint={o.hashtags === 0 ? "None" : `Up to ${o.hashtags}`}>
        <Slider min={0} max={5} step={1} value={[o.hashtags]} onValueChange={([v]) => set("posts", { hashtags: v })} aria-label="Hashtags" />
      </Field>
      <Field label="Call to action">
        <FormSelect
          aria-label="Call to action"
          value={o.cta}
          onValueChange={(v) => set("posts", { cta: v as Settings["posts"]["cta"] })}
          options={[
            { value: "listen", label: "Listen wherever you get podcasts" },
            { value: "out-now", label: "Out now" },
            { value: "none", label: "None" },
          ]}
        />
      </Field>
      <Separator />
      <Field inline label="Tag guests" hint="Uses handles from Hosts & guests">
        <Switch checked={o.tagGuests} onCheckedChange={(tagGuests) => set("posts", { tagGuests })} aria-label="Tag guests" />
      </Field>
      <Field inline label="Episode link" hint="Where the platform allows it">
        <Switch checked={o.link} onCheckedChange={(link) => set("posts", { link })} aria-label="Episode link" />
      </Field>
      <Field inline label="Emoji" hint="At most one">
        <Switch checked={o.emoji} onCheckedChange={(emoji) => set("posts", { emoji })} aria-label="Emoji" />
      </Field>
    </Panel>
  );

  return (
    <Workspace panel={panel}>
      {active.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-[13.5px] text-muted-foreground">Turn on a platform to write a post for it.</CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {active.map((p) => {
            const t = text(p);
            const n = p.count(t);
            const pct = Math.min(1, n / p.limit);
            const over = n > p.limit;
            const edited = edits[`${key}:${p.id}`] !== undefined;
            return (
              <Card key={p.id} className="gap-3 py-4">
                <CardHeader className="px-4">
                  <CardTitle className="flex items-center gap-2 text-[14px]">
                    <span className="flex size-7 items-center justify-center rounded-md bg-secondary text-[13px]">
                      <FontAwesomeIcon icon={p.icon} />
                    </span>
                    {p.name}
                    {edited && <span className="text-[11px] font-normal text-muted-foreground">· edited</span>}
                  </CardTitle>
                  <CardDescription className="text-[11.5px]">{p.rule}</CardDescription>
                  <CardAction className="flex flex-col items-end gap-1">
                    <span className={cn("font-mono text-[11.5px] tabular-nums", over ? "font-semibold text-destructive" : "text-muted-foreground")}>
                      {n.toLocaleString("en-US")} / {p.limit.toLocaleString("en-US")}
                    </span>
                    <span className="h-1 w-16 overflow-hidden rounded-full bg-secondary" aria-hidden>
                      <span className={cn("block h-full rounded-full", over ? "bg-destructive" : pct > 0.85 ? "bg-host" : "bg-foreground/40")} style={{ width: `${pct * 100}%` }} />
                    </span>
                  </CardAction>
                </CardHeader>
                <CardContent className="flex flex-col gap-2.5 px-4">
                  <Textarea
                    aria-label={`${p.name} post`}
                    value={t}
                    onChange={(e) => setEdits((cur) => ({ ...cur, [`${key}:${p.id}`]: e.target.value }))}
                    className="min-h-[132px] resize-none text-[13.5px] leading-relaxed"
                    aria-invalid={over}
                  />
                  {p.id === "threads" && (
                    <div className="flex items-center gap-2">
                      <Label htmlFor="topic" className="shrink-0 text-[12px] text-muted-foreground">
                        Topic
                      </Label>
                      <Input id="topic" value={topic} maxLength={50} onChange={(e) => setTopic(e.target.value.replace(/[.&]/g, ""))} className="h-8 text-[13px]" />
                    </div>
                  )}
                </CardContent>
                <CardFooter className="gap-1.5 px-4">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setVariants((v) => ({ ...v, [p.id]: (v[p.id] ?? 0) + 1 }));
                      clearEdit(p.id);
                    }}
                  >
                    <FontAwesomeIcon icon={faRotate} />
                    Rewrite
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      void navigator.clipboard?.writeText(t).catch(() => {});
                      flash(`${p.name} post copied`);
                    }}
                  >
                    <FontAwesomeIcon icon={faCopy} />
                    Copy
                  </Button>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="ml-auto">
                        <Button size="sm" variant="ghost" disabled>
                          <FontAwesomeIcon icon={faPaperPlane} />
                          Post
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>Posting from Podstudio comes later</TooltipContent>
                  </Tooltip>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}
    </Workspace>
  );
}

// ---------------------------------------------------------------- canvas plumbing

const layoutOf = (choice: string, ep: Ep | undefined): Layout => (choice === "auto" ? autoLayout(ep?.ordinal ?? 0) : (layoutLabels[choice] ?? "split"));
const autoName = (ep: Ep | undefined) => LAYOUT_NAMES.find((k) => layoutLabels[k] === autoLayout(ep?.ordinal ?? 0)) ?? "Split";
const defaultMeta = (ep: Ep | undefined) => [ep?.number != null ? `Ep ${ep.number}` : null, ep?.guest ? `with ${ep.guest}` : null].filter(Boolean).join(" · ") || "New episode";

/** A canvas the ported renderer paints at full export size; CSS scales it down. */
function CanvasView({ w, h, paint, deps, label, className }: { w: number; h: number; paint: (c: HTMLCanvasElement) => void; deps: unknown[]; label: string; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) paint(ref.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return <canvas ref={ref} width={w} height={h} role="img" aria-label={label} className={cn("block", className)} />;
}

function Tile({ name, size, children }: { name: string; size: string; children: ReactNode }) {
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex h-[300px] items-center justify-center bg-secondary/40 p-5 [&_canvas]:h-auto [&_canvas]:max-h-full [&_canvas]:w-auto [&_canvas]:max-w-full [&_canvas]:shadow-xl">{children}</div>
      <div className="flex items-center justify-between border-t px-4 py-2.5">
        <div>
          <div className="text-[13px] font-medium">{name}</div>
          <div className="font-mono text-[11px] text-muted-foreground">{size}</div>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button size="icon" variant="ghost" disabled aria-label={`Download ${name}`}>
                <FontAwesomeIcon icon={faDownload} />
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>PNG download arrives with Stage 10c</TooltipContent>
        </Tooltip>
      </div>
    </Card>
  );
}

function ImageSource({ upload, setUpload, artUrl }: Pick<Ctx, "upload" | "setUpload" | "artUrl">) {
  return (
    <div className="flex items-center gap-3">
      {upload ?? artUrl ? <img src={upload ?? artUrl ?? ""} alt="" className="size-11 shrink-0 object-cover ring-1 ring-border" /> : <div className="size-11 shrink-0 bg-secondary" />}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex gap-1.5">
          <Button asChild size="sm" variant="outline" className="h-7 px-2.5 text-[12px]">
            <label className="cursor-pointer">
              <FontAwesomeIcon icon={faImage} />
              Upload
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) setUpload(URL.createObjectURL(f));
                  e.target.value = "";
                }}
              />
            </label>
          </Button>
          {upload && (
            <Button size="sm" variant="ghost" className="h-7 px-2 text-[12px]" onClick={() => setUpload(null)}>
              Use show art
            </Button>
          )}
        </div>
        <span className="truncate text-[11.5px] text-muted-foreground">{upload ? "Your image" : "Episode art (or the show art)"}</span>
      </div>
    </div>
  );
}

function LayoutField({ value, ep, onChange }: { value: string; ep: Ep | undefined; onChange: (v: string) => void }) {
  return (
    <Field label="Layout">
      <FormSelect aria-label="Layout" value={value} onValueChange={onChange} options={[{ value: "auto", label: `Rotate per episode (${autoName(ep)})` }, ...LAYOUT_NAMES.map((x) => ({ value: x, label: x }))]} />
    </Field>
  );
}

// ---------------------------------------------------------------- graphics

const SAMPLE_QUOTE = "If you can't explain where the audio goes, you don't really know where it goes.";

function GraphicsTab(ctx: Ctx) {
  const { ep, s, set, reset, brandAccent, image, fonts, accent, brand } = ctx;
  const l = s.look;
  const [headline, setHeadline] = useState(ep?.title ?? "");
  const [meta, setMeta] = useState(defaultMeta(ep));
  const [quote, setQuote] = useState(SAMPLE_QUOTE);
  const layout = layoutOf(l.layout, ep);
  const scene = { template: l.template, headline, meta, quote, wordmark: l.wordmark, waveform: l.waveform, layout, image, dim: l.darken / 100 };
  const deps = [fonts, image, accent, JSON.stringify({ ...scene, image: !!image })];

  const panel = (
    <Panel title="Customize" onReset={() => reset("look")}>
      <Field label="Template">
        <Segmented
          label="Template"
          value={l.template}
          onChange={(template) => set("look", { template })}
          options={[
            { value: "headline", label: "Headline" },
            { value: "quote", label: "Quote" },
          ]}
        />
      </Field>
      <LayoutField value={l.layout} ep={ep} onChange={(v) => set("look", { layout: v })} />
      {layout !== "none" && (
        <Field label="Image">
          <ImageSource {...ctx} />
        </Field>
      )}
      {darkens(layout) && (
        <Field label="Darken" hint={`${l.darken}%`}>
          <Slider min={0} max={90} step={5} value={[l.darken]} onValueChange={([v]) => set("look", { darken: v })} aria-label="Darken" />
        </Field>
      )}
      <Field label="Wordmark">
        <Segmented label="Wordmark" value={l.wordmark} onChange={(wordmark) => set("look", { wordmark })} options={[{ value: "Stacked", label: "Stacked" }, { value: "Domain", label: "Domain" }, { value: "Logo", label: "Logo", disabled: !ctx.logo }]} />
      </Field>
      <Field inline label="Waveform">
        <Switch checked={l.waveform} onCheckedChange={(waveform) => set("look", { waveform })} aria-label="Waveform" />
      </Field>
      <Field label="Accent" hint="Waveform and reel bars">
        <AccentPicker value={l.accent} brand={brandAccent} onChange={(a) => set("look", { accent: a })} />
      </Field>
      <Separator />
      <Field label="Headline">
        <Textarea aria-label="Headline" rows={2} value={headline} onChange={(e) => setHeadline(e.target.value)} className="min-h-0 resize-none text-[13px]" />
      </Field>
      <Field label="Meta line">
        <Input aria-label="Meta line" value={meta} onChange={(e) => setMeta(e.target.value)} className="h-8 font-mono text-[12.5px]" />
      </Field>
      {l.template === "quote" && (
        <Field label="Quote" hint="Word for word from the transcript">
          <Textarea aria-label="Quote" rows={3} value={quote} onChange={(e) => setQuote(e.target.value)} className="min-h-0 resize-none text-[13px]" />
        </Field>
      )}
    </Panel>
  );

  return (
    <Workspace panel={panel}>
      <div className="grid gap-4 md:grid-cols-2">
        {formats.map((f) => (
          <Tile key={f.id} name={f.name} size={`${f.w} × ${f.h}`}>
            <CanvasView
              w={f.w}
              h={f.h}
              label={`${f.name} preview`}
              deps={deps}
              paint={(c) => {
                brand();
                drawPost(c, f, scene);
              }}
            />
          </Tile>
        ))}
        {artFormats.map((f) => (
          <Tile key={f.id} name={f.name} size={`${f.w} × ${f.h}`}>
            <CanvasView
              w={f.w}
              h={f.h}
              label={`${f.name} preview`}
              deps={deps}
              paint={(c) => {
                brand();
                drawArtwork(c, f, { title: headline, kicker: ep?.number != null ? `Ep ${ep.number}` : "", wordmark: l.wordmark, waveform: l.waveform, backdrop: layout === "none" ? null : image, dim: l.darken / 100 });
              }}
            />
          </Tile>
        ))}
      </div>
    </Workspace>
  );
}

// ---------------------------------------------------------------- carousel

const SLIDE_POOL: Omit<Slide, "id">[] = [
  { type: "text", heading: "Start with the signal path", body: "Most problems show up long before the transmitter. Trace it from the mic forward." },
  { type: "quote", heading: "", body: "If you can't explain where the audio goes, you don't really know where it goes." },
  { type: "text", heading: "Write it down", body: "Every change, every setting. Future you is the one who fixes it at 2 a.m." },
  { type: "text", heading: "Test like a listener", body: "Car radio, cheap earbuds, a phone speaker. That's the real mix." },
  { type: "quote", heading: "", body: "Everybody blames the transmitter. It's almost never the transmitter." },
  { type: "text", heading: "Keep one spare", body: "The part you don't have on the shelf is the part that fails." },
];

function CarouselTab(ctx: Ctx) {
  const { ep, s, set, reset, image, fonts, accent, brand, flash } = ctx;
  const c = s.carousel;
  const l = s.look;
  const title = ep?.title ?? "Episode title";
  const middle = SLIDE_POOL.filter((x) => c.quotes || x.type !== "quote").slice(0, Math.max(1, c.slides - 2));
  const slides: Slide[] = [
    { id: 0, type: "cover", heading: title, body: defaultMeta(ep) },
    ...middle.map((x, i) => ({ ...x, id: i + 1 })),
    { id: 99, type: "cta", heading: "Listen to the full episode", body: "Wherever you get podcasts." },
  ];
  const opts = { wordmark: l.wordmark, waveform: l.waveform, numbers: c.numbers, swipe: c.swipe, art: image, layout: layoutOf(l.layout, ep), dim: l.darken / 100 };
  const deps = [fonts, image, accent, JSON.stringify({ ...opts, art: !!image }), title, slides.length];
  const caption = `${title}${ep?.guest ? ` with ${ep.guest}` : ""}.\n\nThe short version is in the slides. The long version is the episode.\n\nFull episode: link in bio.\n\n#podcast #radio #broadcasting`;

  const panel = (
    <Panel title="Customize" onReset={() => reset("carousel")}>
      <Field label="Slides" hint={`${slides.length} total`}>
        <Slider min={3} max={8} step={1} value={[c.slides]} onValueChange={([v]) => set("carousel", { slides: v })} aria-label="Slides" />
      </Field>
      <Field inline label="Quote slides" hint="Word for word from the transcript">
        <Switch checked={c.quotes} onCheckedChange={(quotes) => set("carousel", { quotes })} aria-label="Quote slides" />
      </Field>
      <Field inline label="Slide numbers">
        <Switch checked={c.numbers} onCheckedChange={(numbers) => set("carousel", { numbers })} aria-label="Slide numbers" />
      </Field>
      <Field inline label="Swipe cue" hint="On the cover">
        <Switch checked={c.swipe} onCheckedChange={(swipe) => set("carousel", { swipe })} aria-label="Swipe cue" />
      </Field>
      <Separator />
      <p className="text-[11.5px] leading-snug text-muted-foreground">The cover's layout, image, wordmark and waveform follow the Graphics tab.</p>
    </Panel>
  );

  return (
    <Workspace panel={panel}>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {slides.map((sl, i) => (
            <figure key={`${sl.id}-${i}`} className="flex flex-col gap-1.5">
              <CanvasView
                w={SLIDE_W}
                h={SLIDE_H}
                label={`Slide ${i + 1}`}
                deps={[...deps, i]}
                className="h-auto w-full shadow-md ring-1 ring-border"
                paint={(cv) => {
                  brand();
                  drawSlide(cv, sl, i, slides.length, opts);
                }}
              />
              <figcaption className="px-0.5 text-[11.5px] text-muted-foreground">{sl.type === "cta" ? "Listen" : sl.type === "cover" ? "Cover" : sl.type === "quote" ? "Quote" : "Point"}</figcaption>
            </figure>
          ))}
        </div>
        <Card className="gap-3 py-4">
          <CardHeader className="px-4">
            <CardTitle className="flex items-center gap-2 text-[14px]">
              <FontAwesomeIcon icon={faInstagram} className="text-muted-foreground" />
              Caption
            </CardTitle>
            <CardDescription className="text-[12px]">Written to go with these slides.</CardDescription>
            <CardAction className="flex gap-1.5">
              <Button size="sm" variant="outline" onClick={() => flash("Slides rewritten")}>
                <FontAwesomeIcon icon={faRotate} />
                Rewrite
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard?.writeText(caption).catch(() => {});
                  flash("Caption copied");
                }}
              >
                <FontAwesomeIcon icon={faCopy} />
                Copy
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="px-4">
            <Textarea aria-label="Carousel caption" defaultValue={caption} key={ep?.id} className="min-h-[150px] resize-none text-[13px] leading-relaxed" />
          </CardContent>
        </Card>
      </div>
    </Workspace>
  );
}

// ---------------------------------------------------------------- reels

const CLIPS = [
  { start: "04:12", end: "05:03", secs: 51, hook: "Nobody checks this first", quote: "Everybody blames the transmitter. It's almost never the transmitter." },
  { start: "18:40", end: "19:52", secs: 72, hook: "The 2 a.m. fix", quote: "I had one note in the log, and that note saved the whole night." },
  { start: "31:05", end: "31:58", secs: 53, hook: "What I'd do now", quote: "Test it the way your listeners actually hear it, not the way you do." },
];
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
// The reel's safe zones (video.ts: 17 and 27 percent of the width), as shares of its height.
const SAFE_TOP = (17 * (REEL_W / 100)) / REEL_H;
const SAFE_BOTTOM = (27 * (REEL_W / 100)) / REEL_H;

// Stand-in band levels when no audio file is loaded: low bands move more.
function cannedBars(t: number, seed: number) {
  return Float32Array.from({ length: BAR_COUNT }, (_, i) => {
    const a = Math.abs(Math.sin(t * (5.3 + (i % 5) * 0.7) + i * 0.9 + seed));
    const b = Math.abs(Math.sin(t * 2.1 + i * 1.7 + seed * 2));
    return Math.min(1, 0.06 + 0.94 * (0.2 + 0.8 * a * b) * (1 - i / 40));
  });
}

function ClipCard({ ctx, clip, index }: { ctx: Ctx; clip: (typeof CLIPS)[number]; index: number }) {
  const { ep, s, image, fonts, accent, brand, audio, flash } = ctx;
  const c = s.clips;
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [headline, setHeadline] = useState(clip.hook);
  const [meta, setMeta] = useState([ep?.number != null ? `Ep ${ep.number}` : null, ep?.title].filter(Boolean).join(" · "));
  const length = audio ? Math.min(clip.secs, audio.buf.duration) : clip.secs;
  const player = useRef<{ ac: AudioContext; src: AudioBufferSourceNode } | null>(null);

  const stop = () => {
    player.current?.src.stop();
    void player.current?.ac.close();
    player.current = null;
  };
  useEffect(() => stop, []);
  useEffect(() => {
    if (!playing) {
      stop();
      return;
    }
    let raf = 0;
    if (audio) {
      const ac = new AudioContext();
      const src = ac.createBufferSource();
      src.buffer = audio.buf;
      src.connect(ac.destination);
      const offset = t >= length - 0.05 ? 0 : t;
      src.start(0, offset, length - offset);
      const startedAt = ac.currentTime - offset;
      player.current = { ac, src };
      const tick = () => {
        const now = ac.currentTime - startedAt;
        if (now >= length) {
          setT(0);
          setPlaying(false);
          return;
        }
        setT(now);
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    } else {
      let last = performance.now();
      const tick = (now: number) => {
        const dt = (now - last) / 1000;
        last = now;
        setT((cur) => (cur + dt >= length ? 0 : cur + dt));
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }
    return () => {
      cancelAnimationFrame(raf);
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, audio]);

  const frame = Math.floor(t * FPS);
  const bars = audio && (frame + 1) * BAR_COUNT <= audio.bars.length ? audio.bars.subarray(frame * BAR_COUNT, (frame + 1) * BAR_COUNT) : playing || t > 0 ? cannedBars(t, index * 1.9) : [];
  const reel = { headline, meta, wordmark: c.wordmark, bars, progress: c.progress, t, length, background: image, layout: layoutOf(c.layout, ep), dim: c.darken / 100 };

  const targets: { id: string; name: string; icon: IconDefinition; caption: string }[] = [
    { id: "tiktok", name: "TikTok", icon: faTiktok, caption: `${clip.hook}.\n\n#radio #broadcastengineer #podcast` },
    { id: "reels", name: "Reels", icon: faInstagram, caption: `${clip.hook}. “${clip.quote}”\n\nFrom ${ep?.title ?? "the episode"}. Full episode: link in bio.\n\n#radio #podcastclips #tech` },
    { id: "shorts", name: "Shorts", icon: faYoutube, caption: `${clip.hook} | ${ep?.title ?? "Episode"}\n\n#shorts #radio #podcast` },
  ];

  return (
    <Card className="py-4">
      <CardContent className="grid gap-5 px-4 md:grid-cols-[240px_minmax(0,1fr)]">
        <div className="mx-auto flex w-[240px] flex-col gap-2">
          <div className="relative shadow-lg ring-1 ring-border">
            <CanvasView
              w={REEL_W}
              h={REEL_H}
              label={`Reel preview, clip ${index + 1}`}
              className="h-auto w-full"
              deps={[fonts, image, accent, t, headline, meta, JSON.stringify({ ...c }), ep?.id, !!audio]}
              paint={(cv) => {
                brand();
                drawReel(cv, reel);
              }}
            />
            {c.safeZones && (
              <>
                <div className="pointer-events-none absolute inset-x-0 top-0 border-b border-dashed border-[#ff807f] bg-[#ff807f]/15" style={{ height: `${SAFE_TOP * 100}%` }} />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 border-t border-dashed border-[#ff807f] bg-[#ff807f]/15" style={{ height: `${SAFE_BOTTOM * 100}%` }} />
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button size="icon" variant="outline" className="size-8 shrink-0" onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pause preview" : "Play preview"}>
              <FontAwesomeIcon icon={playing ? faPause : faPlay} className="text-[11px]" />
            </Button>
            <Slider min={0} max={length} step={0.1} value={[t]} onValueChange={([v]) => setT(v)} disabled={playing} aria-label="Position" />
            <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
              {clock(t)} / {clock(length)}
            </span>
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-semibold">Clip {index + 1}</span>
            <Badge variant="outline" className="font-mono font-normal">
              {clip.start}–{clip.end} · {clock(clip.secs)}
            </Badge>
          </div>
          <p className="text-[13px] italic leading-relaxed text-muted-foreground">“{clip.quote}”</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`hl-${index}`} className="text-[12px]">
                Headline
              </Label>
              <Input id={`hl-${index}`} value={headline} onChange={(e) => setHeadline(e.target.value)} className="h-8 text-[13px]" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`meta-${index}`} className="text-[12px]">
                Meta line
              </Label>
              <Input id={`meta-${index}`} value={meta} onChange={(e) => setMeta(e.target.value)} className="h-8 font-mono text-[12.5px]" />
            </div>
          </div>
          <Separator className="my-1" />
          <div className="grid gap-3 xl:grid-cols-3">
            {targets.map((tg) => (
              <div key={tg.id} className="flex flex-col gap-1.5">
                <Label className="flex items-center gap-1.5 text-[12px]">
                  <FontAwesomeIcon icon={tg.icon} className="text-muted-foreground" />
                  {tg.name} caption
                </Label>
                <Textarea key={`${ep?.id}-${tg.id}`} aria-label={`Clip ${index + 1} ${tg.name} caption`} defaultValue={tg.caption} className="h-[132px] resize-none text-[12.5px] leading-relaxed [field-sizing:fixed]" />
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="outline" onClick={() => flash("Captions rewritten")}>
              <FontAwesomeIcon icon={faRotate} />
              Rewrite captions
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button size="sm" variant="outline" disabled>
                    <FontAwesomeIcon icon={faDownload} />
                    MP4 + captions
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>Reel rendering arrives with Stage 10c</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ClipsTab(ctx: Ctx) {
  const { ep, s, set, reset, brandAccent, audio, setAudio, flash } = ctx;
  const c = s.clips;
  const layout = layoutOf(c.layout, ep);
  const [busy, setBusy] = useState(false);

  const panel = (
    <Panel title="Customize" onReset={() => reset("clips")}>
      <LayoutField value={c.layout} ep={ep} onChange={(v) => set("clips", { layout: v })} />
      {layout !== "none" && (
        <Field label="Background">
          <ImageSource {...ctx} />
        </Field>
      )}
      {darkens(layout) && (
        <Field label="Darken" hint={`${c.darken}%`}>
          <Slider min={0} max={90} step={5} value={[c.darken]} onValueChange={([v]) => set("clips", { darken: v })} aria-label="Darken reel" />
        </Field>
      )}
      <Field label="Wordmark">
        <Segmented label="Wordmark" value={c.wordmark} onChange={(wordmark) => set("clips", { wordmark })} options={[{ value: "Stacked", label: "Stacked" }, { value: "Domain", label: "Domain" }, { value: "Logo", label: "Logo", disabled: !ctx.logo }]} />
      </Field>
      <Field inline label="Progress bar and timer">
        <Switch checked={c.progress} onCheckedChange={(progress) => set("clips", { progress })} aria-label="Progress bar and timer" />
      </Field>
      <Field label="Bars" hint="Shared with Graphics">
        <AccentPicker value={s.look.accent} brand={brandAccent} onChange={(a) => set("look", { accent: a })} />
      </Field>
      <Separator />
      <Field label="Preview audio" hint={audio ? undefined : "Bars follow a stand-in until you add one"}>
        {audio ? (
          <div className="flex items-center gap-2 rounded-md border px-2.5 py-1.5">
            <FontAwesomeIcon icon={faMusic} className="text-[12px] text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-[12.5px]">{audio.name}</span>
            <span className="font-mono text-[11px] text-muted-foreground">{clock(audio.buf.duration)}</span>
            <Button size="icon" variant="ghost" className="size-6" aria-label="Remove audio" onClick={() => setAudio(null)}>
              <FontAwesomeIcon icon={faXmark} className="text-[11px]" />
            </Button>
          </div>
        ) : (
          <Button asChild size="sm" variant="outline" className="w-full">
            <label className={cn("cursor-pointer", busy && "pointer-events-none opacity-60")}>
              <FontAwesomeIcon icon={faMusic} />
              {busy ? "Reading audio…" : "Add an audio file"}
              <input
                type="file"
                accept="audio/*"
                className="sr-only"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (!f) return;
                  setBusy(true);
                  try {
                    const buf = await decodeAudio(f);
                    setAudio({ name: f.name, buf, bars: analyse(buf) });
                  } catch {
                    flash("That file couldn't be read as audio");
                  } finally {
                    setBusy(false);
                  }
                }}
              />
            </label>
          </Button>
        )}
      </Field>
      <Field inline label="Show safe zones" hint="Where TikTok, Reels and Shorts put their buttons">
        <Switch checked={c.safeZones} onCheckedChange={(safeZones) => set("clips", { safeZones })} aria-label="Show safe zones" />
      </Field>
    </Panel>
  );

  return (
    <Workspace panel={panel}>
      <div className="flex flex-col gap-4">
        {CLIPS.map((k, i) => (
          <ClipCard key={`${ep?.id}-${i}`} ctx={ctx} clip={k} index={i} />
        ))}
      </div>
    </Workspace>
  );
}

// ---------------------------------------------------------------- wordmark & fonts

function FontPicker({ label, value, fonts, onChange, onUpload }: { label: string; value: string; fonts: FontDef[]; onChange: (id: string) => void; onUpload: (f: File) => void }) {
  const groups = [...new Set(fonts.map((f) => f.kind))].map((kind) => ({ label: kind, options: fonts.filter((f) => f.kind === kind).map((f) => ({ value: f.id, label: f.label })) }));
  const cur = fonts.find((f) => f.id === value);
  return (
    <Field label={label}>
      <div className="flex gap-1.5">
        <FormSelect aria-label={label} value={value} onValueChange={onChange} groups={groups} className="min-w-0 flex-1" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button asChild size="icon" variant="outline" className="shrink-0">
              <label className="cursor-pointer" aria-label={`Upload a font for the ${label.toLowerCase()}`}>
                <FontAwesomeIcon icon={faUpload} />
                <input
                  type="file"
                  accept=".woff2,.woff,.ttf,.otf,font/woff2,font/woff,font/ttf,font/otf"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) onUpload(f);
                  }}
                />
              </label>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Upload a font (.woff2, .ttf, .otf)</TooltipContent>
        </Tooltip>
      </div>
      {cur && (
        <span className="truncate text-[20px] leading-tight text-muted-foreground" style={{ fontFamily: cur.family }}>
          The quick brown fox
        </span>
      )}
    </Field>
  );
}

function BrandSheet(ctx: Ctx) {
  const { s, set, reset, ep, image, fonts, accent, brand, showTitle, domain, stackedAuto, logo, setLogo, allFonts, addFont, flash } = ctx;
  const b = s.brand;
  const l = s.look;
  const [open, setOpen] = useState(false);
  const scene = { template: "headline" as const, headline: ep?.title ?? showTitle, meta: defaultMeta(ep), quote: "", wordmark: l.wordmark, waveform: l.waveform, layout: layoutOf(l.layout, ep), image, dim: l.darken / 100 };

  const uploadFont = async (file: File, slot: "headFont" | "markFont") => {
    try {
      const data = await readDataUrl(file);
      const id = `PS ${file.name.replace(/\.[^.]+$/, "").replace(/[^\w -]/g, "").slice(0, 40) || "Custom"}`;
      const face = new FontFace(id, `url(${data})`);
      await face.load();
      document.fonts.add(face);
      addFont({ id, label: id.slice(3), data });
      set("brand", { [slot]: id });
      flash(`${id.slice(3)} added`);
    } catch {
      flash("That file couldn't be read as a font");
    }
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline">
          <FontAwesomeIcon icon={faFont} />
          Wordmark &amp; fonts
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Wordmark &amp; fonts</SheetTitle>
          <SheetDescription>Used on every graphic, slide and reel for this show.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 pb-4">
          <div className="mx-auto w-[220px] shadow-lg ring-1 ring-border">
            {open && (
              <CanvasView
                w={formats[0].w}
                h={formats[0].h}
                label="Wordmark preview"
                className="h-auto w-full"
                deps={[fonts, image, accent, JSON.stringify({ ...scene, image: !!image })]}
                paint={(c) => {
                  brand();
                  drawPost(c, formats[0], scene);
                }}
              />
            )}
          </div>

          <Field label="Show as">
            <Segmented
              label="Show as"
              value={l.wordmark}
              onChange={(wordmark) => {
                set("look", { wordmark });
                set("clips", { wordmark });
              }}
              options={[
                { value: "Stacked", label: "Stacked name" },
                { value: "Domain", label: "Domain" },
                { value: "Logo", label: "Logo", disabled: !logo },
              ]}
            />
          </Field>

          <Field label="Stacked name" hint="One line per row">
            <Textarea
              aria-label="Stacked name"
              rows={3}
              value={b.lines ?? stackedAuto.join("\n")}
              onChange={(e) => set("brand", { lines: e.target.value })}
              className="min-h-0 resize-none font-mono text-[13px] uppercase"
            />
            {b.lines !== null && (
              <Button size="sm" variant="ghost" className="h-7 w-fit px-2 text-[12px]" onClick={() => set("brand", { lines: null })}>
                Use the show name
              </Button>
            )}
          </Field>

          <Field label="Domain">
            <Input aria-label="Domain" value={b.domain ?? ""} placeholder={domain} onChange={(e) => set("brand", { domain: e.target.value || null })} className="h-8 font-mono text-[12.5px]" />
          </Field>

          <Field label="Logo" hint="PNG or SVG, transparent background">
            <div className="flex items-center gap-3">
              <div className="flex h-14 w-24 shrink-0 items-center justify-center bg-[#0e0e0e] p-2 ring-1 ring-border">
                {logo ? <img src={logo} alt="Logo" className="max-h-full max-w-full object-contain" /> : <span className="text-[11px] text-white/40">No logo</span>}
              </div>
              <div className="flex flex-col gap-1.5">
                <Button asChild size="sm" variant="outline" className="h-7 px-2.5 text-[12px]">
                  <label className="cursor-pointer">
                    <FontAwesomeIcon icon={faImage} />
                    {logo ? "Replace" : "Upload logo"}
                    <input
                      type="file"
                      accept="image/png,image/svg+xml,image/webp,image/jpeg"
                      className="sr-only"
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        e.target.value = "";
                        if (!f) return;
                        setLogo(await readDataUrl(f));
                        set("look", { wordmark: "Logo" });
                        set("clips", { wordmark: "Logo" });
                      }}
                    />
                  </label>
                </Button>
                {logo && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-[12px]"
                    onClick={() => {
                      setLogo(null);
                      if (l.wordmark === "Logo") set("look", { wordmark: "Stacked" });
                      if (s.clips.wordmark === "Logo") set("clips", { wordmark: "Stacked" });
                    }}
                  >
                    Remove
                  </Button>
                )}
              </div>
            </div>
            {logo && (
              <Segmented
                label="Logo color"
                value={b.tint}
                onChange={(tint) => set("brand", { tint })}
                options={[
                  { value: "original", label: "Original" },
                  { value: "white", label: "White" },
                  { value: "accent", label: "Accent" },
                ]}
              />
            )}
          </Field>

          <Separator />
          <FontPicker label="Headline font" value={b.headFont} fonts={allFonts} onChange={(headFont) => set("brand", { headFont })} onUpload={(f) => void uploadFont(f, "headFont")} />
          <FontPicker label="Wordmark font" value={b.markFont} fonts={allFonts} onChange={(markFont) => set("brand", { markFont })} onUpload={(f) => void uploadFont(f, "markFont")} />
          <p className="text-[11.5px] leading-snug text-muted-foreground">Meta lines and counters stay in JetBrains Mono. Uploaded fonts are kept in this browser for now; the real build saves them with the show.</p>
        </div>
        <SheetFooter className="flex-row justify-between border-t">
          <Button variant="ghost" onClick={() => reset("brand")}>
            Reset
          </Button>
          <Button onClick={() => setOpen(false)}>Done</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------- voice

function VoiceSheet({ onSave }: { onSave: () => void }) {
  const [text, setText] = useState(DEFAULT_VOICE);
  const history = useMemo(
    () => [
      { when: "Nov 2, 2026 · 9:14 PM", note: "Added the no-emoji rule" },
      { when: "Oct 28, 2026 · 4:02 PM", note: "First saved version" },
    ],
    [],
  );
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline">
          <FontAwesomeIcon icon={faFeather} />
          Show voice
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full gap-0 sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Show voice</SheetTitle>
          <SheetDescription>How every post for this show should sound. Platform limits and formats are handled for you.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4">
          <Textarea aria-label="Voice" value={text} onChange={(e) => setText(e.target.value)} className="min-h-[280px] text-[13px] leading-relaxed" />
          <div className="flex flex-col gap-2">
            <span className="text-[12.5px] font-medium">Saved versions</span>
            {history.map((h) => (
              <div key={h.when} className="flex items-center justify-between rounded-md border px-3 py-2 text-[12.5px]">
                <span>
                  {h.note}
                  <span className="block text-[11.5px] text-muted-foreground">{h.when}</span>
                </span>
                <Button size="sm" variant="ghost">
                  Restore
                </Button>
              </div>
            ))}
          </div>
        </div>
        <SheetFooter className="flex-row justify-between border-t">
          <Button variant="ghost" onClick={() => setText(DEFAULT_VOICE)}>
            Reset to default
          </Button>
          <Button onClick={onSave}>Save voice</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
