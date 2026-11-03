import { useEffect, useMemo, useState, type ReactNode } from "react";
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
} from "@fortawesome/free-solid-svg-icons";
import { listEpisodeRows } from "~/lib/episodes.server";
import { artworkFile, getShowArtwork } from "~/lib/artwork.server";
import { accentHex, BRAND_PRESETS, normalizeHex, onAccent, readBrandTheme } from "~/lib/brand-theme";
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
// (graphics, carousel, clip captions). Nothing calls an AI provider or a
// platform: drafts are sample text assembled from the episode and the
// Customize settings, and Rewrite cycles canned variants. Settings are kept in
// this browser only (the real build saves them with the show).
// Design notes: docs/notes/social-generator.md.
export async function loader({ request }: { request: Request }) {
  const { show, rows } = listEpisodeRows();
  const art = getShowArtwork();
  return {
    showTitle: show?.title ?? "Your show",
    domain: new URL(request.url).host,
    brandAccent: accentHex(readBrandTheme(show?.theme)),
    artUrl: art ? `/${art.slug}/artwork/${artworkFile(art)}` : null,
    episodes: rows.slice(0, 24).map((r) => ({ id: r.id, number: r.number, title: r.title, guest: r.guest })),
  };
}

type Ep = Awaited<ReturnType<typeof loader>>["episodes"][number];

// ---------------------------------------------------------------- settings

type PlatformId = "bluesky" | "threads" | "mastodon" | "x" | "facebook" | "instagram" | "linkedin" | "youtube";
const LAYOUTS = ["Split", "Full bleed", "Framed", "Corner", "Band"] as const;
type LayoutName = (typeof LAYOUTS)[number];
const CAPTION_STYLES = ["Bold pop", "Clean", "Boxed", "Karaoke", "Word bubble", "Minimal"] as const;
type CaptionStyle = (typeof CAPTION_STYLES)[number];

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
  look: {
    template: "headline" | "quote";
    layout: "auto" | LayoutName;
    accent: string; // "brand" or a hex
    darken: number; // 0–90
    waveform: boolean;
    wordmark: boolean;
    episodeNumber: boolean;
  };
  carousel: { slides: number; numbers: boolean; quotes: boolean };
  clips: { layout: "auto" | LayoutName | "None"; darken: number; wordmark: "stacked" | "domain"; progress: boolean; safeZones: boolean; captions: "off" | CaptionStyle };
}

const DEFAULTS: Settings = {
  posts: { platforms: ["bluesky", "threads", "mastodon", "facebook", "instagram", "youtube"], length: "standard", hashtags: 2, emoji: false, tagGuests: true, link: true, cta: "listen" },
  look: { template: "headline", layout: "auto", accent: "brand", darken: 55, waveform: true, wordmark: true, episodeNumber: true },
  carousel: { slides: 6, numbers: true, quotes: true },
  clips: { layout: "auto", darken: 55, wordmark: "stacked", progress: true, safeZones: false, captions: "off" },
};

const STORE = "podstudio.social.settings.v2";

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

const BARS = [0.35, 0.6, 0.45, 0.8, 0.55, 0.95, 0.7, 0.4, 0.65, 0.85, 0.5, 0.3, 0.6, 0.9, 0.75, 0.45, 0.55, 0.8, 0.6, 0.35, 0.5, 0.7, 0.4, 0.25];

// ---------------------------------------------------------------- page

interface Ctx {
  ep: Ep | undefined;
  showTitle: string;
  artUrl: string | null;
  domain: string;
  accent: string;
  brandAccent: string;
  s: Settings;
  set: <K extends keyof Settings>(k: K, patch: Partial<Settings[K]>) => void;
  reset: (k: keyof Settings) => void;
  flash: (m: string) => void;
}

export default function Social({ loaderData }: { loaderData: Awaited<ReturnType<typeof loader>> }) {
  const { showTitle, episodes, artUrl, brandAccent, domain } = loaderData;
  const [epId, setEpId] = useState(episodes[0]?.id ?? "");
  const ep = episodes.find((e) => e.id === epId);
  const { s, set, reset } = useSettings();
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 1600);
  };
  const accent = s.look.accent === "brand" ? brandAccent : (normalizeHex(s.look.accent) ?? brandAccent);
  const ctx: Ctx = { ep, showTitle, artUrl, domain, accent, s, set, reset, flash, brandAccent };

  return (
    <TooltipProvider delayDuration={250}>
      <Page width="wide" className="max-w-[1320px]">
        <PageHeader
          eyebrow="Publish & share"
          title="Social"
          description="Posts, graphics and clip captions for every platform, written from your episode. Review, tweak and copy; nothing posts on its own."
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
              <TabsTrigger value="clips">Clips</TabsTrigger>
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

function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string }) {
  return (
    <ToggleGroup type="single" variant="outline" size="sm" value={value} onValueChange={(v) => v && onChange(v as T)} className="w-full" aria-label={label}>
      {options.map((o) => (
        <ToggleGroupItem key={o.value} value={o.value} className="flex-1 px-1.5 text-[12px]">
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

function Art({ url, className }: { url: string | null; className?: string }) {
  const [ok, setOk] = useState(true);
  return (
    <div className={cn("relative overflow-hidden bg-gradient-to-br from-neutral-700 via-neutral-800 to-neutral-900", className)}>
      {ok && url && <img src={url} alt="" draggable={false} className="absolute inset-0 size-full object-cover" onError={() => setOk(false)} />}
    </div>
  );
}

function Bars({ accent, className }: { accent: string; className?: string }) {
  return (
    <div className={cn("flex items-end gap-[0.5cqw]", className)} aria-hidden>
      {BARS.map((h, i) => (
        <span key={i} className="w-[0.7cqw] rounded-full" style={{ height: `${h * 100}%`, background: accent }} />
      ))}
    </div>
  );
}

// Every image is square-cornered: platforms crop to their own frame and none accept rounded edges.

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

// ---------------------------------------------------------------- graphics

function LookPanel({ s, set, reset, brandAccent, ep }: Ctx) {
  const l = s.look;
  const auto = LAYOUTS[(ep?.number ?? 0) % LAYOUTS.length];
  return (
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
      <Field label="Layout">
        <FormSelect
          aria-label="Layout"
          value={l.layout}
          onValueChange={(v) => set("look", { layout: v as Settings["look"]["layout"] })}
          options={[{ value: "auto", label: `Rotate per episode (${auto})` }, ...LAYOUTS.map((x) => ({ value: x, label: x }))]}
        />
      </Field>
      <Field label="Accent">
        <AccentPicker value={l.accent} brand={brandAccent} onChange={(accent) => set("look", { accent })} />
      </Field>
      <Field label="Darken art" hint={`${l.darken}%`}>
        <Slider min={0} max={90} step={5} value={[l.darken]} onValueChange={([v]) => set("look", { darken: v })} aria-label="Darken art" />
      </Field>
      <Separator />
      <Field inline label="Waveform">
        <Switch checked={l.waveform} onCheckedChange={(waveform) => set("look", { waveform })} aria-label="Waveform" />
      </Field>
      <Field inline label="Show name">
        <Switch checked={l.wordmark} onCheckedChange={(wordmark) => set("look", { wordmark })} aria-label="Show name" />
      </Field>
      <Field inline label="Episode number">
        <Switch checked={l.episodeNumber} onCheckedChange={(episodeNumber) => set("look", { episodeNumber })} aria-label="Episode number" />
      </Field>
    </Panel>
  );
}

const QUOTE = "If you can't explain where the audio goes, you don't really know where it goes.";

function Design({ ctx, ratio }: { ctx: Ctx; ratio: number }) {
  const { ep, s, accent, artUrl, showTitle } = ctx;
  const l = s.look;
  const layout: LayoutName = l.layout === "auto" ? LAYOUTS[(ep?.number ?? 0) % LAYOUTS.length] : l.layout;
  const tall = ratio < 1;
  const title = ep?.title ?? "Episode title";
  const meta = [l.episodeNumber && ep?.number != null ? `Episode ${ep.number}` : null, ep?.guest ? `with ${ep.guest}` : null].filter(Boolean).join(" · ");
  const dim = l.darken / 100;
  const quote = l.template === "quote";

  const type = (
    <div className="flex flex-col gap-[1.6cqw]">
      {meta && <span className="font-mono text-[max(8px,2.2cqw)] uppercase tracking-[0.14em] text-white/70">{meta}</span>}
      {quote ? (
        <span className="font-semibold leading-[1.15] text-white [overflow-wrap:anywhere]" style={{ fontSize: tall ? "6.2cqw" : "4.2cqw" }}>
          <span style={{ color: accent }}>“</span>
          {QUOTE}
          <span style={{ color: accent }}>”</span>
        </span>
      ) : (
        <span className="font-extrabold leading-[1.02] tracking-[-0.02em] text-white [overflow-wrap:anywhere]" style={{ fontSize: tall ? "8cqw" : "5.4cqw" }}>
          {title}
        </span>
      )}
      {(l.wordmark || l.waveform) && (
        <div className="mt-[1.2cqw] flex items-end justify-between gap-[3cqw]">
          {l.wordmark ? <span className="min-w-0 truncate font-mono text-[max(8px,2.1cqw)] font-semibold uppercase tracking-[0.14em] text-white/85">{showTitle}</span> : <span />}
          {l.waveform && <Bars accent={accent} className="h-[4.5cqw] shrink-0 max-w-[30%] overflow-hidden" />}
        </div>
      )}
    </div>
  );

  return (
    <div className="@container relative size-full overflow-hidden bg-[#111113]">
      {layout === "Split" && (
        <div className={cn("flex size-full", tall ? "flex-col" : "flex-row-reverse")}>
          <Art url={artUrl} className={tall ? "h-[54%] w-full shrink-0" : "h-full w-[42%] shrink-0"} />
          <div className="flex min-w-0 flex-1 flex-col justify-center p-[6cqw]">{type}</div>
        </div>
      )}
      {layout === "Full bleed" && (
        <>
          <Art url={artUrl} className="absolute inset-0" />
          <div className="absolute inset-0" style={{ background: `linear-gradient(to top, rgba(17,17,19,${0.35 + dim * 0.6}) 30%, rgba(17,17,19,${dim * 0.5}))` }} />
          <div className="absolute inset-x-0 bottom-0 p-[6cqw]">{type}</div>
        </>
      )}
      {layout === "Framed" && (
        <div className={cn("flex size-full gap-[4cqw] p-[5cqw]", tall ? "flex-col" : "flex-row")}>
          <Art url={artUrl} className={cn("shrink-0", tall ? "w-full flex-1" : "aspect-square h-full")} />
          <div className="flex min-w-0 flex-1 flex-col justify-end">{type}</div>
        </div>
      )}
      {layout === "Corner" && (
        <>
          <Art url={artUrl} className={cn("absolute right-[5cqw] top-[5cqw] aspect-square", tall ? "w-[42%]" : "w-[26%]")} />
          <span className="absolute left-[6cqw] top-[6cqw] h-[1cqw] w-[10cqw]" style={{ background: accent }} />
          <div className="absolute inset-x-0 bottom-0 p-[6cqw]">{type}</div>
        </>
      )}
      {layout === "Band" && (
        <div className="flex size-full flex-col">
          <div className="relative flex flex-1 flex-col justify-end p-[6cqw]">{type}</div>
          <div className="relative h-[34%]">
            <Art url={artUrl} className="absolute inset-0" />
            <div className="absolute inset-0" style={{ background: `rgba(17,17,19,${dim * 0.6})` }} />
            <div className="absolute inset-x-0 top-0 h-[0.8cqw]" style={{ background: accent }} />
          </div>
        </div>
      )}
    </div>
  );
}

function Tile({ name, size, ratio, children }: { name: string; size: string; ratio: number; children: ReactNode }) {
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex h-[300px] items-center justify-center bg-secondary/40 p-5">
        <div className={cn("max-h-full max-w-full shadow-xl", ratio <= 1 ? "h-full" : "w-full")} style={{ aspectRatio: ratio }}>
          {children}
        </div>
      </div>
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

function GraphicsTab(ctx: Ctx) {
  const { ep, accent, artUrl, s } = ctx;
  const title = ep?.title ?? "Episode title";
  return (
    <Workspace panel={<LookPanel {...ctx} />}>
      <div className="grid gap-4 md:grid-cols-2">
        <Tile name="Instagram post" size="1080 × 1350" ratio={1080 / 1350}>
          <Design ctx={ctx} ratio={1080 / 1350} />
        </Tile>
        <Tile name="Story" size="1080 × 1920" ratio={1080 / 1920}>
          <Design ctx={ctx} ratio={1080 / 1920} />
        </Tile>
        <Tile name="X" size="1600 × 900" ratio={16 / 9}>
          <Design ctx={ctx} ratio={16 / 9} />
        </Tile>
        <Tile name="Facebook and link previews" size="1200 × 630" ratio={1200 / 630}>
          <Design ctx={ctx} ratio={1200 / 630} />
        </Tile>
        <Tile name="Episode cover" size="3000 × 3000" ratio={1}>
          <div className="@container relative size-full overflow-hidden">
            <Art url={artUrl} className="absolute inset-0" />
            <div className="absolute inset-0 bg-gradient-to-t from-[#111113]/95 via-[#111113]/20 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 flex flex-col gap-[2cqw] p-[7cqw]">
              {ep?.number != null && s.look.episodeNumber && (
                <span className="w-fit px-[2cqw] py-[0.8cqw] font-mono text-[3.2cqw] font-bold" style={{ background: accent, color: onAccent(accent) }}>
                  EP {ep.number}
                </span>
              )}
              <span className="text-[8cqw] font-extrabold leading-[1.02] tracking-[-0.02em] text-white [overflow-wrap:anywhere]">{title}</span>
            </div>
          </div>
        </Tile>
        <Tile name="YouTube thumbnail" size="1280 × 720" ratio={16 / 9}>
          <div className="@container relative size-full overflow-hidden bg-[#111113]">
            <Art url={artUrl} className="absolute inset-y-0 right-0 w-[52%]" />
            <div className="absolute inset-y-0 left-0 flex w-[62%] flex-col justify-center gap-[2.4cqw] bg-gradient-to-r from-[#111113] from-70% to-transparent p-[5cqw]">
              <span className="text-[7.4cqw] font-black uppercase leading-[0.95] tracking-[-0.02em] text-white [overflow-wrap:anywhere]">{title}</span>
              <span className="h-[1.2cqw] w-[16cqw]" style={{ background: accent }} />
            </div>
          </div>
        </Tile>
      </div>
    </Workspace>
  );
}

// ---------------------------------------------------------------- carousel

type SlideDef = { type: "cover" | "text" | "quote" | "cta"; heading: string; body: string; at?: string };

const SLIDE_POOL: SlideDef[] = [
  { type: "text", heading: "Start with the signal path", body: "Most problems show up long before the transmitter. Trace it from the mic forward." },
  { type: "quote", heading: "", body: "If you can't explain where the audio goes, you don't really know where it goes.", at: "41:12" },
  { type: "text", heading: "Write it down", body: "Every change, every setting. Future you is the one who fixes it at 2 a.m." },
  { type: "text", heading: "Test like a listener", body: "Car radio, cheap earbuds, a phone speaker. That's the real mix." },
  { type: "quote", heading: "", body: "Everybody blames the transmitter. It's almost never the transmitter.", at: "04:31" },
  { type: "text", heading: "Keep one spare", body: "The part you don't have on the shelf is the part that fails." },
];

function CarouselTab(ctx: Ctx) {
  const { ep, s, set, reset, accent, showTitle, artUrl, flash } = ctx;
  const c = s.carousel;
  const title = ep?.title ?? "Episode title";
  const middle = SLIDE_POOL.filter((x) => c.quotes || x.type !== "quote").slice(0, Math.max(1, c.slides - 2));
  const slides: SlideDef[] = [{ type: "cover", heading: title, body: "" }, ...middle, { type: "cta", heading: "Listen to the full episode", body: "Wherever you get podcasts" }];
  const total = slides.length;
  const caption = `${title}${ep?.guest ? ` with ${ep.guest}` : ""}.\n\nThe short version is in the slides. The long version is the episode.\n\nFull episode: link in bio.\n\n#podcast #radio #broadcasting`;

  const panel = (
    <Panel title="Customize" onReset={() => reset("carousel")}>
      <Field label="Slides" hint={`${total} total`}>
        <Slider min={3} max={8} step={1} value={[c.slides]} onValueChange={([v]) => set("carousel", { slides: v })} aria-label="Slides" />
      </Field>
      <Field inline label="Quote slides" hint="Word for word from the transcript">
        <Switch checked={c.quotes} onCheckedChange={(quotes) => set("carousel", { quotes })} aria-label="Quote slides" />
      </Field>
      <Field inline label="Slide numbers">
        <Switch checked={c.numbers} onCheckedChange={(numbers) => set("carousel", { numbers })} aria-label="Slide numbers" />
      </Field>
      <Separator />
      <Field label="Accent" hint="Shared with Graphics">
        <AccentPicker value={s.look.accent} brand={ctx.brandAccent} onChange={(a) => set("look", { accent: a })} />
      </Field>
    </Panel>
  );

  return (
    <Workspace panel={panel}>
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {slides.map((sl, i) => (
            <figure key={i} className="flex flex-col gap-1.5">
              <div className="@container relative aspect-[1080/1350] overflow-hidden bg-[#111113] shadow-md ring-1 ring-border">
                {sl.type === "cover" && (
                  <>
                    <Art url={artUrl} className="absolute inset-x-0 top-0 h-[58%]" />
                    <div className="absolute inset-x-0 bottom-0 flex h-[42%] flex-col justify-center gap-[2cqw] p-[7cqw]">
                      {ep?.number != null && <span className="font-mono text-[4cqw] uppercase tracking-[0.14em] text-white/65">Episode {ep.number}</span>}
                      <span className="text-[9cqw] font-extrabold leading-[1.02] tracking-[-0.02em] text-white [overflow-wrap:anywhere]">{sl.heading}</span>
                    </div>
                  </>
                )}
                {sl.type === "text" && (
                  <div className="flex size-full flex-col justify-center gap-[4cqw] p-[9cqw]">
                    <span className="h-[1.4cqw] w-[14cqw]" style={{ background: accent }} />
                    <span className="text-[9cqw] font-extrabold leading-[1.05] tracking-[-0.02em] text-white">{sl.heading}</span>
                    <span className="text-[5.4cqw] leading-[1.4] text-white/70">{sl.body}</span>
                  </div>
                )}
                {sl.type === "quote" && (
                  <div className="flex size-full flex-col justify-center gap-[3cqw] p-[9cqw]">
                    <span className="font-serif text-[26cqw] leading-[0.6]" style={{ color: accent }}>
                      “
                    </span>
                    <span className="text-[7.6cqw] font-semibold leading-[1.2] text-white">{sl.body}</span>
                    <span className="font-mono text-[3.8cqw] uppercase tracking-[0.12em] text-white/55">{ep?.guest ?? "Host"}</span>
                  </div>
                )}
                {sl.type === "cta" && (
                  <div className="flex size-full flex-col items-center justify-center gap-[5cqw] p-[9cqw] text-center">
                    <Art url={artUrl} className="aspect-square w-[46%] shadow-2xl" />
                    <span className="text-[8cqw] font-extrabold leading-[1.05] text-white">{sl.heading}</span>
                    <span className="px-[5cqw] py-[2cqw] text-[4.6cqw] font-bold" style={{ background: accent, color: onAccent(accent) }}>
                      {sl.body}
                    </span>
                  </div>
                )}
                <div className="absolute inset-x-[7cqw] bottom-[5cqw] flex items-center justify-between">
                  {sl.type !== "cover" ? <span className="font-mono text-[3.4cqw] font-semibold uppercase tracking-[0.14em] text-white/45">{showTitle}</span> : <span />}
                  {c.numbers && (
                    <span className="font-mono text-[3.4cqw] text-white/45">
                      {i + 1}/{total}
                    </span>
                  )}
                </div>
              </div>
              <figcaption className="flex items-center justify-between px-0.5 text-[11.5px] text-muted-foreground">
                <span>{sl.type === "cta" ? "Listen" : sl.type === "cover" ? "Cover" : sl.type === "quote" ? "Quote" : "Point"}</span>
                {sl.at && <span className="font-mono">{sl.at}</span>}
              </figcaption>
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

// ---------------------------------------------------------------- clips
// The reel follows the TWP social generator's Video tab: near-black ground, the
// same imagery layouts, type kept inside the platforms' safe zones (17% top,
// 27% bottom), mono meta line with a running timer, a large headline, 24 wide
// bars in the accent, a thin progress line and the show wordmark. Bars here are
// a canned animation; the real ones come from the clip's audio, computed once
// per frame so preview and render match.

const CLIPS = [
  { start: "04:12", end: "05:03", secs: 51, hook: "Nobody checks this first", quote: "Everybody blames the transmitter. It's almost never the transmitter." },
  { start: "18:40", end: "19:52", secs: 72, hook: "The 2 a.m. fix", quote: "I had one note in the log, and that note saved the whole night." },
  { start: "31:05", end: "31:58", secs: 53, hook: "What I'd do now", quote: "Test it the way your listeners actually hear it, not the way you do." },
];

const REEL_LAYOUTS = [...LAYOUTS, "None"] as const;
type ReelLayout = (typeof REEL_LAYOUTS)[number];
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

// Plausible band levels for time t: low bands move more, every band keeps some life.
function bandLevels(t: number, seed: number) {
  return Array.from({ length: 24 }, (_, i) => {
    const tilt = 1 - i / 34;
    const a = Math.abs(Math.sin(t * (5.3 + (i % 5) * 0.7) + i * 0.9 + seed));
    const b = Math.abs(Math.sin(t * 2.1 + i * 1.7 + seed * 2));
    return Math.max(0.08, Math.min(1, (0.25 + 0.75 * a * b) * tilt + 0.06));
  });
}

function CaptionLine({ style, words, accent }: { style: CaptionStyle; words: string[]; accent: string }) {
  const active = Math.min(2, words.length - 1);
  return (
    <span
      className={cn("flex flex-wrap justify-center gap-x-[1.6cqw] text-center leading-[1.15]", style === "Bold pop" && "font-black uppercase", style === "Minimal" ? "font-medium" : "font-bold")}
      style={{ fontSize: style === "Minimal" ? "5.4cqw" : "6.6cqw" }}
    >
      {style === "Boxed" ? (
        <span className="bg-black/80 px-[2.5cqw] py-[1cqw] text-white">
          {words.map((w, i) => (
            <span key={i} style={i === active ? { color: accent } : undefined}>
              {w}{" "}
            </span>
          ))}
        </span>
      ) : (
        words.map((w, i) => {
          const on = i === active;
          if (style === "Word bubble" && on)
            return (
              <span key={i} className="px-[1.5cqw]" style={{ background: accent, color: onAccent(accent) }}>
                {w}
              </span>
            );
          const color = on && style !== "Clean" && style !== "Minimal" ? accent : style === "Karaoke" && i > active ? "rgba(255,255,255,.45)" : "#fff";
          return (
            <span key={i} style={{ color, transform: on && style === "Bold pop" ? "scale(1.12)" : undefined, display: "inline-block" }}>
              {w}
            </span>
          );
        })
      )}
    </span>
  );
}

function Reel({ ctx, clip, index, t, headline, meta }: { ctx: Ctx; clip: (typeof CLIPS)[number]; index: number; t: number; headline: string; meta: string }) {
  const { s, accent, artUrl, showTitle, domain, ep } = ctx;
  const c = s.clips;
  const layout: ReelLayout = c.layout === "auto" ? LAYOUTS[(ep?.number ?? 0) % LAYOUTS.length] : c.layout;
  const dim = c.darken / 100;
  const bars = bandLevels(t, index * 1.9);
  const words = clip.quote.replace(/[.,]/g, "").split(" ");
  const wi = Math.floor((t / clip.secs) * words.length * 3) % Math.max(1, words.length - 3);
  // Where the type column starts: below the imagery for the layouts that take the top.
  const typeTop = { Split: "43%", "Full bleed": "17%", Framed: "62%", Corner: "17%", Band: "47%", None: "17%" }[layout];

  return (
    <div className="@container relative aspect-[9/16] w-full overflow-hidden bg-[#0e0e0e] font-sans text-[#f5f5f2]">
      {layout === "Split" && <Art url={artUrl} className="absolute inset-x-0 top-0 h-[40%]" />}
      {layout === "Full bleed" && (
        <>
          <Art url={artUrl} className="absolute inset-0" />
          <div className="absolute inset-0" style={{ background: `rgba(14,14,14,${dim})` }} />
        </>
      )}
      {layout === "Framed" && <Art url={artUrl} className="absolute left-[8%] top-[9%] aspect-square w-[84%]" />}
      {layout === "Corner" && <Art url={artUrl} className="absolute right-[8%] top-[17%] aspect-square w-[30%]" />}
      {layout === "Band" && (
        <div className="absolute inset-x-0 top-[17%] h-[27%]">
          <Art url={artUrl} className="absolute inset-0" />
          <div className="absolute inset-0" style={{ background: `rgba(14,14,14,${dim * 0.6})` }} />
        </div>
      )}

      <div className="absolute inset-x-[8%] bottom-[27%] flex flex-col" style={{ top: typeTop }}>
        <div className={cn("flex items-baseline justify-between gap-[3cqw] font-mono text-[3.4cqw] text-[#8a8a86]", layout === "Corner" && "pr-[36%]")}>
          <span className="min-w-0 truncate">{meta}</span>
          {c.progress && layout !== "Corner" && (
            <span className="shrink-0 tabular-nums">
              {clock(t)} / {clock(clip.secs)}
            </span>
          )}
        </div>
        <span className={cn("mt-[3cqw] font-medium leading-[1.08] tracking-[-0.025em] [overflow-wrap:anywhere]", layout === "Corner" && "pr-[36%]")} style={{ fontSize: layout === "Framed" || layout === "Band" ? "6.4cqw" : "8.4cqw" }}>
          {headline}
        </span>
        <div className="flex min-h-[12cqw] flex-1 items-center">
          <div className="flex h-[18cqw] max-h-full w-full items-center gap-[0.6cqw]">
            {bars.map((h, i) => (
              <span key={i} className="flex-1 rounded-full" style={{ height: `max(${100 / 24}cqw, ${h * 100}%)`, background: accent }} />
            ))}
          </div>
        </div>
        {c.captions !== "off" && (
          <div className="mb-[3cqw]">
            <CaptionLine style={c.captions} words={words.slice(wi, wi + 3)} accent={accent} />
          </div>
        )}
        {c.progress && (
          <div className="mb-[4cqw] h-[0.5cqw] w-full bg-[#262626]">
            <div className="h-full bg-[#f5f5f2]" style={{ width: `${(t / clip.secs) * 100}%` }} />
          </div>
        )}
        <div className="font-mono text-[3.4cqw] font-semibold uppercase leading-[1.15] tracking-[0.14em]">
          {c.wordmark === "domain" ? domain : <span className="block max-w-[60%]">{showTitle}</span>}
        </div>
      </div>

      {c.safeZones && (
        <>
          <div className="pointer-events-none absolute inset-x-0 top-0 h-[17%] border-b border-dashed border-[#ff807f]/80 bg-[#ff807f]/10" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[27%] border-t border-dashed border-[#ff807f]/80 bg-[#ff807f]/10" />
        </>
      )}
    </div>
  );
}

function ClipCard({ ctx, clip, index }: { ctx: Ctx; clip: (typeof CLIPS)[number]; index: number }) {
  const { ep, flash } = ctx;
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [headline, setHeadline] = useState(clip.hook);
  const [meta, setMeta] = useState("");
  const metaLine = meta || [ep?.number != null ? `Ep. ${ep.number}` : null, ep?.title].filter(Boolean).join(" · ");

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setT((cur) => (cur + dt >= clip.secs ? 0 : cur + dt));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, clip.secs]);

  const targets: { id: string; name: string; icon: IconDefinition; caption: string }[] = [
    { id: "tiktok", name: "TikTok", icon: faTiktok, caption: `${clip.hook}.\n\n#radio #broadcastengineer #podcast` },
    { id: "reels", name: "Reels", icon: faInstagram, caption: `${clip.hook}. “${clip.quote}”\n\nFrom ${ep?.title ?? "the episode"}. Full episode: link in bio.\n\n#radio #podcastclips #tech` },
    { id: "shorts", name: "Shorts", icon: faYoutube, caption: `${clip.hook} | ${ep?.title ?? "Episode"}\n\n#shorts #radio #podcast` },
  ];

  return (
    <Card className="py-4">
      <CardContent className="grid gap-5 px-4 md:grid-cols-[240px_minmax(0,1fr)]">
        <div className="mx-auto flex w-[240px] flex-col gap-2">
          <div className="shadow-lg ring-1 ring-border">
            <Reel ctx={ctx} clip={clip} index={index} t={t} headline={headline} meta={metaLine} />
          </div>
          <div className="flex items-center gap-2">
            <Button size="icon" variant="outline" className="size-8 shrink-0" onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pause preview" : "Play preview"}>
              <FontAwesomeIcon icon={playing ? faPause : faPlay} className="text-[11px]" />
            </Button>
            <Slider min={0} max={clip.secs} step={0.1} value={[t]} onValueChange={([v]) => setT(v)} aria-label="Position" />
            <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">{clock(t)}</span>
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
              <Label htmlFor={`hl-${index}`} className="text-[12px]">Headline</Label>
              <Input id={`hl-${index}`} value={headline} onChange={(e) => setHeadline(e.target.value)} className="h-8 text-[13px]" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`meta-${index}`} className="text-[12px]">Meta line</Label>
              <Input id={`meta-${index}`} value={meta} placeholder={metaLine} onChange={(e) => setMeta(e.target.value)} className="h-8 font-mono text-[12.5px]" />
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
              <TooltipContent>Clip rendering arrives with Stage 10c</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ClipsTab(ctx: Ctx) {
  const { ep, s, set, reset } = ctx;
  const c = s.clips;
  const auto = LAYOUTS[(ep?.number ?? 0) % LAYOUTS.length];
  const panel = (
    <Panel title="Customize" onReset={() => reset("clips")}>
      <Field label="Layout">
        <FormSelect
          aria-label="Reel layout"
          value={c.layout}
          onValueChange={(v) => set("clips", { layout: v as Settings["clips"]["layout"] })}
          options={[{ value: "auto", label: `Rotate per episode (${auto})` }, ...REEL_LAYOUTS.map((x) => ({ value: x, label: x }))]}
        />
      </Field>
      <Field label="Darken art" hint={`${c.darken}%`}>
        <Slider min={0} max={90} step={5} value={[c.darken]} onValueChange={([v]) => set("clips", { darken: v })} aria-label="Darken reel art" />
      </Field>
      <Field label="Wordmark">
        <Segmented
          label="Wordmark"
          value={c.wordmark}
          onChange={(wordmark) => set("clips", { wordmark })}
          options={[
            { value: "stacked", label: "Stacked" },
            { value: "domain", label: "Domain" },
          ]}
        />
      </Field>
      <Field label="Bars" hint="Shared with Graphics">
        <AccentPicker value={s.look.accent} brand={ctx.brandAccent} onChange={(a) => set("look", { accent: a })} />
      </Field>
      <Separator />
      <Field inline label="Progress bar and timer">
        <Switch checked={c.progress} onCheckedChange={(progress) => set("clips", { progress })} aria-label="Progress bar and timer" />
      </Field>
      <Field inline label="Show safe zones" hint="Where TikTok, Reels and Shorts put their buttons">
        <Switch checked={c.safeZones} onCheckedChange={(safeZones) => set("clips", { safeZones })} aria-label="Show safe zones" />
      </Field>
      <Separator />
      <Field label="Captions" hint="From the edited transcript">
        <FormSelect
          aria-label="Captions"
          value={c.captions}
          onValueChange={(v) => set("clips", { captions: v as Settings["clips"]["captions"] })}
          options={[{ value: "off", label: "Off" }, ...CAPTION_STYLES.map((x) => ({ value: x, label: x }))]}
        />
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
