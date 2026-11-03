import { useMemo, useState } from "react";
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
import { faCopy, faRotate, faWandMagicSparkles, faFeather, faDownload, faPaperPlane } from "@fortawesome/free-solid-svg-icons";
import { listEpisodeRows } from "~/lib/episodes.server";
import { artworkFile, getShowArtwork } from "~/lib/artwork.server";
import { Page, PageHeader } from "~/components/layout/page";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardAction, CardFooter } from "~/components/ui/card";
import { FormSelect } from "~/components/ui/form-select";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger, SheetFooter } from "~/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { Textarea } from "~/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { cn } from "~/lib/utils";

// MOCKUP of the social features planned for Stage 07 (post copy) and Stage 10c
// (graphics, carousel, clip captions). Nothing here calls an AI provider or a
// platform: the drafts are sample text built from the episode title, and
// Regenerate swaps between canned variants. Not in the sidebar; open
// /studio/social directly. Design notes: docs/notes/social-generator.md.
export async function loader() {
  const { show, rows } = listEpisodeRows();
  const art = getShowArtwork();
  return {
    artUrl: art ? `/${art.slug}/artwork/${artworkFile(art)}` : null,
    showTitle: show?.title ?? "Your show",
    episodes: rows.slice(0, 24).map((r) => ({ id: r.id, number: r.number, title: r.title, guest: r.guest })),
  };
}

type Ep = Awaited<ReturnType<typeof loader>>["episodes"][number];

// ---------------------------------------------------------------- platform rules

type PlatformId = "bluesky" | "threads" | "mastodon" | "x" | "facebook" | "instagram" | "linkedin" | "youtube";

const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter("en", { granularity: "grapheme" }) : null;
const graphemes = (t: string) => (segmenter ? [...segmenter.segment(t)].length : [...t].length);
const codePoints = (t: string) => [...t].length;
const linksAs23 = (t: string) => codePoints(t.replace(/https?:\/\/\S+/g, "x".repeat(23)));

const PLATFORMS: {
  id: PlatformId;
  name: string;
  icon: IconDefinition;
  limit: number;
  count: (t: string) => number;
  rule: string;
}[] = [
  { id: "bluesky", name: "Bluesky", icon: faBluesky, limit: 300, count: graphemes, rule: "300 graphemes · up to 3 hashtags at the end" },
  { id: "threads", name: "Threads", icon: faThreads, limit: 500, count: codePoints, rule: "500 characters · no hashtags, one topic" },
  { id: "mastodon", name: "Mastodon", icon: faMastodon, limit: 500, count: linksAs23, rule: "500 characters · every link counts as 23" },
  { id: "x", name: "X", icon: faXTwitter, limit: 280, count: linksAs23, rule: "280 characters · links count as 23" },
  { id: "facebook", name: "Facebook", icon: faFacebook, limit: 2000, count: codePoints, rule: "Keep it under about 2,000 characters" },
  { id: "instagram", name: "Instagram", icon: faInstagram, limit: 1500, count: codePoints, rule: "Hook first line · “link in bio” · 3–5 hashtags" },
  { id: "linkedin", name: "LinkedIn", icon: faLinkedin, limit: 3000, count: codePoints, rule: "3,000 characters · professional angle" },
  { id: "youtube", name: "YouTube", icon: faYoutube, limit: 5000, count: codePoints, rule: "Description: summary, chapters, links" },
];

// ---------------------------------------------------------------- sample drafts

function drafts(ep: Ep | undefined, variant: number): Record<PlatformId, string> {
  const t = ep?.title ?? "the new episode";
  const n = ep?.number != null ? `Ep. ${ep.number}` : "New episode";
  const with_ = ep?.guest ? ` with ${ep.guest}` : "";
  const v = variant % 2;
  return {
    bluesky: v
      ? `The short version of ${n}: ${t}. The part I keep thinking about is in the last ten minutes.\n\n#podcast #tech`
      : `${n} is out: ${t}${with_}. One conversation, no filler, and a few things I got wrong last time.\n\n#podcast #radio`,
    threads: v
      ? `${t}${with_}. I went in expecting one answer and came out with a better question. Full episode is up now.`
      : `New one's up: ${t}${with_}. If you've ever wondered how this actually works behind the scenes, this is the episode for you.`,
    mastodon: v
      ? `${n}: ${t}. Notes and the full transcript are on the episode page.\n\nhttps://example.com/episode\n\n#podcast`
      : `${n} is out: ${t}${with_}. One conversation, no filler.\n\nhttps://example.com/episode\n\n#podcast #radio`,
    x: v ? `${n}: ${t}. The last ten minutes are the part to hear.` : `${n} is out: ${t}${with_}. One conversation, no filler.`,
    facebook: `${n} is live: ${t}${with_}.\n\nWe get into how it really works, what most people get wrong, and the one thing I'd change if I were starting over. Listen wherever you get podcasts, or right on the site.`,
    instagram: `${t}${with_}.\n\nThis one started as a quick question and turned into the whole episode. Swipe for the short version.\n\nFull episode: link in bio.\n\n#podcast #broadcasting #radio #tech`,
    linkedin: `In ${n} of the show I talk through ${t.toLowerCase()}${with_}.\n\nThree takeaways for anyone working in the field:\n1. Start with the signal path.\n2. Document what you change.\n3. Test it the way listeners use it.`,
    youtube: `${t}${with_}.\n\nChapters\n00:00 Intro\n04:12 The setup\n18:40 What went wrong\n31:05 What I'd do now\n\nShow notes and transcript: https://example.com/episode`,
  };
}

const DEFAULT_VOICE = `First person, plain and conversational, like talking to someone who works in the same building. Short sentences. Specific over general.

Lead with the interesting fact or the point, not with "In this episode" or "Check out".

No hype words (game-changer, dive in, unpack), no clickbait, no rhetorical-question openers, at most one emoji, no exclamation-mark pile-ups.

Never invent facts, quotes, numbers or guests. Quotes are word for word from the transcript.`;

// Fixed bar heights so server and client render the same thing.
const BARS = [0.35, 0.6, 0.45, 0.8, 0.55, 0.95, 0.7, 0.4, 0.65, 0.85, 0.5, 0.3, 0.6, 0.9, 0.75, 0.45, 0.55, 0.8, 0.6, 0.35, 0.5, 0.7, 0.4, 0.25];

// ---------------------------------------------------------------- page

export default function SocialMockup({ loaderData }: { loaderData: Awaited<ReturnType<typeof loader>> }) {
  const { showTitle, episodes, artUrl } = loaderData;
  ART_URL = artUrl;
  const [epId, setEpId] = useState(episodes[0]?.id ?? "");
  const ep = episodes.find((e) => e.id === epId);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 1600);
  };

  return (
    <Page width="wide">
      <PageHeader
        eyebrow="Publish & share"
        title="Social"
        description="Posts, graphics and clip captions written for each platform from your episode. You review and copy everything; nothing posts on its own."
        below={
          <Badge variant="outline" className="border-dashed">
            Mockup · sample text, nothing is generated yet
          </Badge>
        }
        actions={
          <>
            <FormSelect
              aria-label="Episode"
              value={epId}
              onValueChange={setEpId}
              className="w-[280px]"
              placeholder="Pick an episode"
              options={episodes.map((e) => ({ value: e.id, label: `${e.number != null ? `Ep. ${e.number} · ` : ""}${e.title}` }))}
            />
            <VoiceSheet onSave={() => flash("Voice saved (mockup)")} />
          </>
        }
      />

      <Tabs defaultValue="posts">
        <TabsList>
          <TabsTrigger value="posts">Posts</TabsTrigger>
          <TabsTrigger value="graphics">Graphics</TabsTrigger>
          <TabsTrigger value="carousel">Carousel</TabsTrigger>
          <TabsTrigger value="clips">Clip captions</TabsTrigger>
        </TabsList>
        <TabsContent value="posts" className="mt-4">
          <PostsTab ep={ep} flash={flash} />
        </TabsContent>
        <TabsContent value="graphics" className="mt-4">
          <GraphicsTab ep={ep} showTitle={showTitle} />
        </TabsContent>
        <TabsContent value="carousel" className="mt-4">
          <CarouselTab ep={ep} showTitle={showTitle} flash={flash} />
        </TabsContent>
        <TabsContent value="clips" className="mt-4">
          <ClipsTab ep={ep} flash={flash} />
        </TabsContent>
      </Tabs>

      {toast && (
        <div role="status" className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-foreground px-4 py-2 text-[13px] font-medium text-background shadow-lg">
          {toast}
        </div>
      )}
    </Page>
  );
}

// ---------------------------------------------------------------- posts

function PostsTab({ ep, flash }: { ep: Ep | undefined; flash: (m: string) => void }) {
  const [mode, setMode] = useState("draft");
  const [notes, setNotes] = useState("");
  const [variants, setVariants] = useState<Record<string, number>>({});
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [topic, setTopic] = useState("Radio and Broadcasting");
  const [enabled, setEnabled] = useState<string[]>(["bluesky", "threads", "mastodon", "facebook", "instagram", "youtube"]);
  const key = ep?.id ?? "";
  const base = useMemo(() => {
    const out: Record<string, string> = {};
    for (const p of PLATFORMS) out[p.id] = drafts(ep, variants[p.id] ?? 0)[p.id];
    return out;
  }, [ep, variants]);
  const text = (id: string) => edits[`${key}:${id}`] ?? base[id];

  return (
    <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="text-[15px]">Write posts</CardTitle>
          <CardDescription>From the transcript, show notes and your voice.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Mode</Label>
            <ToggleGroup type="single" variant="outline" size="sm" value={mode} onValueChange={(v) => v && setMode(v)} className="w-full">
              <ToggleGroupItem value="draft" className="flex-1 text-[12.5px]">Draft</ToggleGroupItem>
              <ToggleGroupItem value="clean" className="flex-1 text-[12.5px]">Clean up</ToggleGroupItem>
              <ToggleGroupItem value="split" className="flex-1 text-[12.5px]">Split</ToggleGroupItem>
            </ToggleGroup>
            <p className="text-[12px] text-muted-foreground">
              {mode === "draft" && "Writes from the episode. Your notes steer what to say."}
              {mode === "clean" && "Fixes and tightens your text. Keeps your opinions."}
              {mode === "split" && "Turns your text into a version for each platform."}
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="notes">{mode === "draft" ? "Notes (optional)" : "Your text"}</Label>
            <Textarea
              id="notes"
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={mode === "draft" ? "Focus on the antenna story…" : "Paste or write your post…"}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Platforms</Label>
            <ToggleGroup type="multiple" variant="outline" size="sm" value={enabled} onValueChange={setEnabled} className="flex w-full flex-wrap justify-start">
              {PLATFORMS.map((p) => (
                <ToggleGroupItem key={p.id} value={p.id} aria-label={p.name} title={p.name} className="flex-none px-2.5">
                  <FontAwesomeIcon icon={p.icon} />
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <Button
            onClick={() => {
              setVariants((v) => Object.fromEntries(PLATFORMS.map((p) => [p.id, (v[p.id] ?? 0) + 1])));
              setEdits({});
              flash("Drafts written (sample text)");
            }}
          >
            <FontAwesomeIcon icon={faWandMagicSparkles} />
            Write {enabled.length} posts
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {PLATFORMS.filter((p) => enabled.includes(p.id)).map((p) => {
          const t = text(p.id);
          const n = p.count(t);
          const over = n > p.limit;
          const tags = (t.match(/#\w+/g) ?? []).map((h) => h.slice(1));
          return (
            <Card key={p.id} className="gap-3 py-4">
              <CardHeader className="px-4">
                <CardTitle className="flex items-center gap-2 text-[14px]">
                  <FontAwesomeIcon icon={p.icon} className="text-muted-foreground" />
                  {p.name}
                </CardTitle>
                <CardDescription className="text-[12px]">{p.rule}</CardDescription>
                <CardAction>
                  <span className={cn("font-mono text-[12px] tabular-nums", over ? "font-semibold text-destructive" : "text-muted-foreground")}>
                    {n} / {p.limit.toLocaleString("en-US")}
                  </span>
                </CardAction>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 px-4">
                <Textarea
                  aria-label={`${p.name} post`}
                  value={t}
                  onChange={(e) => setEdits((s) => ({ ...s, [`${key}:${p.id}`]: e.target.value }))}
                  className="min-h-[120px] text-[13.5px] leading-relaxed"
                  aria-invalid={over}
                />
                {p.id === "threads" && (
                  <div className="flex items-center gap-2">
                    <Label htmlFor="topic" className="shrink-0 text-[12px] text-muted-foreground">Topic</Label>
                    <Input id="topic" value={topic} maxLength={50} onChange={(e) => setTopic(e.target.value.replace(/[.&]/g, ""))} className="h-8 text-[13px]" />
                  </div>
                )}
                {tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {tags.map((h) => (
                      <Badge key={h} variant="secondary" className="font-normal">#{h}</Badge>
                    ))}
                  </div>
                )}
              </CardContent>
              <CardFooter className="gap-2 px-4">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setVariants((v) => ({ ...v, [p.id]: (v[p.id] ?? 0) + 1 }));
                    setEdits((s) => {
                      const { [`${key}:${p.id}`]: _, ...rest } = s;
                      return rest;
                    });
                  }}
                >
                  <FontAwesomeIcon icon={faRotate} />
                  Regenerate
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
                <Button size="sm" variant="ghost" disabled title="Posting from Podstudio is on the wish list" className="ml-auto">
                  <FontAwesomeIcon icon={faPaperPlane} />
                  Post
                </Button>
              </CardFooter>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- graphics

const LAYOUTS = ["Split", "Full bleed", "Framed", "Corner", "Band"] as const;
type LayoutName = (typeof LAYOUTS)[number];

// Set once per render from the loader; every preview uses the show's artwork.
let ART_URL: string | null = null;

function Art({ className }: { className?: string }) {
  const [ok, setOk] = useState(true);
  return (
    <div className={cn("relative overflow-hidden bg-gradient-to-br from-host/70 via-music/50 to-guest/60", className)}>
      {ok && ART_URL && <img src={ART_URL} alt="" className="absolute inset-0 size-full object-cover" onError={() => setOk(false)} />}
    </div>
  );
}

function Bars({ className }: { className?: string }) {
  return (
    <div className={cn("flex h-6 items-end gap-[2px]", className)} aria-hidden>
      {BARS.map((h, i) => (
        <span key={i} className="w-[3px] rounded-full bg-primary" style={{ height: `${h * 100}%` }} />
      ))}
    </div>
  );
}

function PostImage({ ep, showTitle, layout, ratio, label }: { ep: Ep | undefined; showTitle: string; layout: LayoutName; ratio: string; label: string }) {
  const title = ep?.title ?? "Episode title";
  const meta = `${ep?.number != null ? `Ep. ${ep.number}` : "New episode"}${ep?.guest ? ` · with ${ep.guest}` : ""}`;
  const type = (
    <div className="flex flex-col gap-1.5">
      <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-white/70">{meta}</span>
      <span className="text-[15px] font-bold leading-tight text-white [overflow-wrap:anywhere]">{title}</span>
      <div className="mt-1 flex items-center justify-between">
        <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-white/80">{showTitle}</span>
        <Bars className="h-4" />
      </div>
    </div>
  );
  return (
    <figure className="flex flex-col gap-1.5">
      <div className="relative w-full overflow-hidden rounded-md bg-[#151517] shadow-sm ring-1 ring-border" style={{ aspectRatio: ratio }}>
        {layout === "Split" && (
          <div className="flex size-full flex-col">
            <Art className="flex-[1.3]" />
            <div className="flex flex-1 flex-col justify-center p-3">{type}</div>
          </div>
        )}
        {layout === "Full bleed" && (
          <>
            <Art className="absolute inset-0" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 p-3">{type}</div>
          </>
        )}
        {layout === "Framed" && (
          <div className="flex size-full flex-col gap-2 p-3">
            <Art className="flex-1 rounded-sm" />
            {type}
          </div>
        )}
        {layout === "Corner" && (
          <>
            <Art className="absolute right-3 top-3 aspect-square w-[38%] rounded-sm" />
            <div className="absolute inset-x-0 bottom-0 p-3">{type}</div>
          </>
        )}
        {layout === "Band" && (
          <div className="flex size-full flex-col">
            <div className="flex flex-1 flex-col justify-end p-3">{type}</div>
            <Art className="h-[34%]" />
          </div>
        )}
      </div>
      <figcaption className="text-[12px] text-muted-foreground">{label}</figcaption>
    </figure>
  );
}

function GraphicsTab({ ep, showTitle }: { ep: Ep | undefined; showTitle: string }) {
  // Default layout rotates by episode, like the TWP generator.
  const auto = LAYOUTS[(ep?.number ?? 0) % LAYOUTS.length];
  const [picked, setPicked] = useState<LayoutName | null>(null);
  const layout = picked ?? auto;
  return (
    <div className="flex flex-col gap-4">
      <Card className="py-4">
        <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4">
          <div className="flex items-center gap-2">
            <Label className="text-[12.5px]">Layout</Label>
            <ToggleGroup type="single" variant="outline" size="sm" value={layout} onValueChange={(v) => v && setPicked(v as LayoutName)}>
              {LAYOUTS.map((l) => (
                <ToggleGroupItem key={l} value={l} className="px-2.5 text-[12.5px]">
                  {l}
                  {l === auto && <span className="ml-1 text-[10px] text-muted-foreground">auto</span>}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <p className="text-[12px] text-muted-foreground">Each episode gets the next layout in the rotation, so your feed doesn't repeat.</p>
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="outline" disabled>
              <FontAwesomeIcon icon={faDownload} />
              Download all (ZIP)
            </Button>
          </div>
        </CardContent>
      </Card>
      <div className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_1.4fr_1.4fr]">
        <PostImage ep={ep} showTitle={showTitle} layout={layout} ratio="1080 / 1350" label="Instagram post · 1080 × 1350" />
        <PostImage ep={ep} showTitle={showTitle} layout={layout} ratio="1600 / 900" label="X · 1600 × 900" />
        <PostImage ep={ep} showTitle={showTitle} layout={layout} ratio="1200 / 630" label="Facebook · 1200 × 630" />
      </div>
      <div className="grid items-start gap-4 sm:grid-cols-[220px_1fr] lg:grid-cols-[220px_420px]">
        <figure className="flex flex-col gap-1.5">
          <div className="relative aspect-square overflow-hidden rounded-md ring-1 ring-border">
            <Art className="absolute inset-0" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent" />
            <span className="absolute inset-x-3 bottom-3 text-[14px] font-bold leading-tight text-white">{ep?.title}</span>
          </div>
          <figcaption className="text-[12px] text-muted-foreground">Episode cover · 3000 × 3000</figcaption>
        </figure>
        <figure className="flex flex-col gap-1.5">
          <div className="relative aspect-video overflow-hidden rounded-md bg-[#151517] ring-1 ring-border">
            <Art className="absolute inset-y-0 right-0 w-1/2" />
            <div className="absolute inset-y-0 left-0 flex w-[58%] flex-col justify-center bg-gradient-to-r from-[#151517] via-[#151517] to-transparent p-4">
              <span className="text-[19px] font-extrabold uppercase leading-[1.05] text-white [overflow-wrap:anywhere]">{ep?.title}</span>
              <Bars className="mt-2 h-4" />
            </div>
          </div>
          <figcaption className="text-[12px] text-muted-foreground">YouTube thumbnail · 1280 × 720 · title shrinks to fit</figcaption>
        </figure>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- carousel

function CarouselTab({ ep, showTitle, flash }: { ep: Ep | undefined; showTitle: string; flash: (m: string) => void }) {
  const title = ep?.title ?? "Episode title";
  const slides = [
    { type: "cover", heading: title, body: `${ep?.number != null ? `Ep. ${ep.number}` : "New episode"}${ep?.guest ? ` · with ${ep.guest}` : ""}` },
    { type: "text", heading: "Start with the signal path", body: "Most problems show up long before the transmitter. Trace it from the mic forward." },
    { type: "quote", heading: "", body: "“If you can't explain where the audio goes, you don't really know where it goes.”" },
    { type: "text", heading: "Write it down", body: "Every change, every setting. Future you is the one who has to fix it at 2 a.m." },
    { type: "cta", heading: "Listen to the full episode", body: `${showTitle} · wherever you get podcasts` },
  ];
  const caption = `${title}${ep?.guest ? ` with ${ep.guest}` : ""}.\n\nThe short version is in the slides. The long version is the episode.\n\nFull episode: link in bio.\n\n#podcast #radio #broadcasting`;
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="flex snap-x gap-3 overflow-x-auto pb-2">
        {slides.map((s, i) => (
          <figure key={i} className="flex w-[190px] shrink-0 snap-start flex-col gap-1.5">
            <div className="relative flex aspect-[1080/1350] flex-col justify-end overflow-hidden rounded-md bg-[#151517] p-3 ring-1 ring-border">
              {s.type === "cover" && <Art className="absolute inset-x-0 top-0 h-[58%]" />}
              <div className="relative flex flex-col gap-1.5">
                {s.heading && <span className={cn("font-bold leading-tight text-white", s.type === "cover" ? "text-[15px]" : "text-[13px]")}>{s.heading}</span>}
                <span className={cn("leading-snug", s.type === "quote" ? "text-[14px] font-semibold text-primary" : "text-[11px] text-white/75")}>{s.body}</span>
                {s.type === "cta" && <Bars className="mt-2 h-5" />}
              </div>
            </div>
            <figcaption className="flex items-center justify-between text-[11.5px] text-muted-foreground">
              <span>{i + 1}. {s.type === "cta" ? "Listen" : s.type[0].toUpperCase() + s.type.slice(1)}</span>
              {s.type === "quote" && <span className="text-[10.5px]">word for word, 41:12</span>}
            </figcaption>
          </figure>
        ))}
      </div>
      <Card className="h-fit gap-3 py-4">
        <CardHeader className="px-4">
          <CardTitle className="flex items-center gap-2 text-[14px]">
            <FontAwesomeIcon icon={faInstagram} className="text-muted-foreground" />
            Caption
          </CardTitle>
          <CardDescription className="text-[12px]">AI writes 3–6 slides between the cover and the listen slide. Quotes come only from the transcript.</CardDescription>
        </CardHeader>
        <CardContent className="px-4">
          <Textarea aria-label="Carousel caption" defaultValue={caption} key={ep?.id} className="min-h-[170px] text-[13px] leading-relaxed" />
        </CardContent>
        <CardFooter className="flex-wrap gap-2 px-4">
          <Button size="sm" variant="outline" onClick={() => flash("Slides rewritten (sample text)")}>
            <FontAwesomeIcon icon={faRotate} />
            Rewrite slides
          </Button>
          <Button size="sm" variant="outline" onClick={() => flash("Caption copied")}>
            <FontAwesomeIcon icon={faCopy} />
            Copy caption
          </Button>
          <Button size="sm" variant="outline" disabled>
            <FontAwesomeIcon icon={faDownload} />
            ZIP
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- clip captions

function ClipsTab({ ep, flash }: { ep: Ep | undefined; flash: (m: string) => void }) {
  const clips = [
    { start: "04:12", end: "05:03", hook: "Nobody checks this first", quote: "Everybody blames the transmitter. It's almost never the transmitter." },
    { start: "18:40", end: "19:52", hook: "The 2 a.m. fix", quote: "I had one note in the log, and that note saved the whole night." },
    { start: "31:05", end: "31:58", hook: "What I'd do now", quote: "Test it the way your listeners actually hear it, not the way you do." },
  ];
  const targets: { id: string; name: string; icon: IconDefinition; tags: string }[] = [
    { id: "tiktok", name: "TikTok", icon: faTiktok, tags: "#radio #broadcastengineer #podcast" },
    { id: "reels", name: "Reels", icon: faInstagram, tags: "#radio #podcastclips #tech" },
    { id: "shorts", name: "Shorts", icon: faYoutube, tags: "#shorts #radio #podcast" },
  ];
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] text-muted-foreground">
        Clips come from the Clips screen. Each gets a caption and hashtags per platform, written from what's said in that clip, and the text downloads with the MP4.
      </p>
      {clips.map((c, i) => (
        <Card key={i} className="py-4">
          <CardContent className="grid gap-4 px-4 md:grid-cols-[130px_1fr]">
            <div className="relative mx-auto flex aspect-[9/16] w-[130px] flex-col items-center justify-center gap-3 overflow-hidden rounded-md bg-[#151517] p-3 ring-1 ring-border">
              <span className="absolute left-2 right-2 top-3 text-center text-[10px] font-bold uppercase leading-tight text-white">{c.hook}</span>
              <Art className="aspect-square w-[70%] rounded-sm shadow-[0_0_24px_var(--color-primary)]" />
              <span className="text-center text-[9.5px] font-bold leading-tight text-white">
                {c.quote.split(" ").slice(0, 4).join(" ")} <span className="text-primary">{c.quote.split(" ")[4]}</span>
              </span>
              <div className="absolute inset-x-2 bottom-2 h-[3px] rounded-full bg-white/20">
                <div className="h-full w-1/3 rounded-full bg-primary" />
              </div>
            </div>
            <div className="flex min-w-0 flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[14px] font-semibold">Clip {i + 1}</span>
                <Badge variant="outline" className="font-mono font-normal">{c.start}–{c.end}</Badge>
                <span className="truncate text-[12.5px] text-muted-foreground">“{c.quote}”</span>
              </div>
              <div className="grid gap-3 lg:grid-cols-3">
                {targets.map((t) => (
                  <div key={t.id} className="flex flex-col gap-1.5">
                    <Label className="flex items-center gap-1.5 text-[12px]">
                      <FontAwesomeIcon icon={t.icon} className="text-muted-foreground" />
                      {t.name}
                    </Label>
                    <Textarea
                      key={`${ep?.id}-${t.id}`}
                      aria-label={`Clip ${i + 1} ${t.name} caption`}
                      defaultValue={`${c.hook}. ${c.quote}\n\nFrom ${ep?.title ?? "the episode"}.\n\n${t.tags}`}
                      className="min-h-[110px] text-[12.5px] leading-relaxed"
                    />
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => flash(`Clip ${i + 1} captions rewritten (sample text)`)}>
                  <FontAwesomeIcon icon={faRotate} />
                  Rewrite
                </Button>
                <Button size="sm" variant="outline" disabled>
                  <FontAwesomeIcon icon={faDownload} />
                  MP4 + captions
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- voice

function VoiceSheet({ onSave }: { onSave: () => void }) {
  const [text, setText] = useState(DEFAULT_VOICE);
  const history = [
    { when: "Nov 2, 2026 · 9:14 PM", note: "Added the no-emoji rule" },
    { when: "Oct 28, 2026 · 4:02 PM", note: "First saved version" },
  ];
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
          <SheetDescription>How every post for this show should sound. Platform limits and formats are fixed rules and aren't edited here.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
          <Textarea aria-label="Voice" value={text} onChange={(e) => setText(e.target.value)} className="min-h-[260px] text-[13px] leading-relaxed" />
          <div className="flex flex-col gap-1.5">
            <Label className="text-[12.5px]">Saved versions</Label>
            {history.map((h) => (
              <div key={h.when} className="flex items-center justify-between rounded-md border px-3 py-2 text-[12.5px]">
                <span>
                  {h.note}
                  <span className="block text-[11.5px] text-muted-foreground">{h.when}</span>
                </span>
                <Button size="sm" variant="ghost">Restore</Button>
              </div>
            ))}
          </div>
        </div>
        <SheetFooter className="flex-row justify-between">
          <Button variant="ghost" onClick={() => setText(DEFAULT_VOICE)}>Reset to default</Button>
          <Button onClick={onSave}>Save voice</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
