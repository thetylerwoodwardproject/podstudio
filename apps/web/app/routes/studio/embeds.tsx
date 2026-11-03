import { ViewPublicPage } from "~/components/view-public";
import { useState } from "react";
import { Form, Link, useNavigation } from "react-router";
import { getEmbedContext, saveEmbedConfig } from "~/lib/embeds.server";
import type { EmbedConfig } from "~/lib/embeds.server";
import { buildSnippets, embedSrc } from "~/lib/embed-snippets";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { FormSelect } from "~/components/ui/form-select";
import { ChoiceCards } from "~/components/ui/choice-cards";
import { Checkbox } from "~/components/ui/checkbox";
import { Page, PageHeader } from "~/components/layout/page";

// Screen 27 (Embed players, admin). Per README: what to embed (one episode /
// latest / whole show), player (audio / video), theme, accent, toggles for
// chapters / transcript / follow, live preview, three code tabs. Scoped down:
// - The config is one default set stored under `shows.settings.embed` (no
//   embeds table in BUILD_PLAN §4); snippets are derived from it.
// - The three code tabs are real, generated from the saved options.
// - The snippets' URLs now resolve: `/{show}/embed/*` (routes/embed.ts),
//   `/embed.js` and `/oembed` exist, and the live preview is an iframe of that
//   real route. The audio player itself (screen 28) isn't built, so the embed
//   shows show/episode info with "Audio isn't available yet" — no fake player.
// - The snippet origin is whatever host this studio is served from; the real
//   public domain isn't chosen yet.
// This file imports nothing from @podstudio/db or drizzle-orm (type-only
// imports are erased) — see CHANGELOG, "Real bug: two sidebar links silently
// failed to navigate."
const SOURCE_OPTIONS = [
  { value: "episode", label: "One episode" },
  { value: "latest", label: "Latest episode", hint: "updates itself on publish" },
  { value: "all", label: "Whole show", hint: "playlist" },
] as const;
const PLAYER_OPTIONS = [
  { value: "audio", label: "Audio" },
  { value: "video", label: "Video" },
] as const;
const THEME_OPTIONS = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "auto", label: "Match device" },
] as const;
const ACCENT_OPTIONS = [
  { value: "black", label: "Black", swatch: "#000000" },
  { value: "gold", label: "Gold", swatch: "#fabf47" },
  { value: "cyan", label: "Cyan", swatch: "#00fff5" },
  { value: "lime", label: "Lime", swatch: "#beff00" },
  { value: "coral", label: "Coral", swatch: "#ff807f" },
  { value: "lavender", label: "Lavender", swatch: "#c7bff6" },
] as const;
const TABS = [
  { id: "iframe", label: "iframe", note: "Recommended — isolated from the host page's CSS and JS." },
  { id: "script", label: "Script", note: "Injects the same iframe, then resizes it and relays play/pause/timeupdate to the host page." },
  { id: "link", label: "Paste a link", note: "For editors that support oEmbed — the public URL turns into a player." },
] as const;
type TabId = (typeof TABS)[number]["id"];

export async function loader({ request }: { request: Request }) {
  const ctx = getEmbedContext();
  const origin = new URL(request.url).origin;
  return { ctx, origin };
}

export async function action({ request }: { request: Request }) {
  const form = await request.formData();
  const str = (name: string) => ((form.get(name) as string) || "").trim();
  const result = saveEmbedConfig({
    source: str("source"),
    episodePublicId: str("episodePublicId") || null,
    player: str("player"),
    theme: str("theme"),
    accent: str("accent"),
    chapters: form.get("chapters") === "on",
    transcript: form.get("transcript") === "on",
    follow: form.get("follow") === "on",
  });
  if (!result.ok) return { error: result.error };
  return { saved: true };
}

function Radios<T extends string>({
  name,
  options,
  value,
  onChange,
}: {
  name: string;
  options: readonly { value: T; label: string; hint?: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return <ChoiceCards name={name} value={value} onValueChange={onChange} options={options} />;
}

function Toggle({
  name,
  label,
  checked,
  onChange,
}: {
  name: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 text-[13px]">
      <Checkbox name={name} checked={checked} onCheckedChange={(v) => onChange(v === true)} />
      {label}
    </label>
  );
}

export default function Embeds({
  loaderData,
  actionData,
}: {
  loaderData: Awaited<ReturnType<typeof loader>>;
  actionData?: { error?: string; saved?: boolean };
}) {
  const { ctx, origin } = loaderData;

  if (!ctx) {
    return (
      <Page>
        <h1 className="text-2xl font-semibold tracking-tight">Embed players</h1>
        <p className="mt-4 text-[13px] text-muted-foreground">No show seeded yet.</p>
      </Page>
    );
  }

  return <EmbedsForm ctx={ctx} origin={origin} actionData={actionData} />;
}

function EmbedsForm({
  ctx,
  origin,
  actionData,
}: {
  ctx: NonNullable<Awaited<ReturnType<typeof loader>>["ctx"]>;
  origin: string;
  actionData?: { error?: string; saved?: boolean };
}) {
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const [source, setSource] = useState(ctx.config.source);
  const [episodePublicId, setEpisodePublicId] = useState(
    ctx.config.episodePublicId ?? ctx.eligibleEpisodes[0]?.publicId ?? "",
  );
  const [player, setPlayer] = useState(ctx.config.player);
  const [theme, setTheme] = useState(ctx.config.theme);
  const [accent, setAccent] = useState(ctx.config.accent);
  const [chapters, setChapters] = useState(ctx.config.chapters);
  const [transcript, setTranscript] = useState(ctx.config.transcript);
  const [follow, setFollow] = useState(ctx.config.follow);
  const [tab, setTab] = useState<TabId>("iframe");
  const [copied, setCopied] = useState(false);

  // Snippets reflect the form as currently edited, so what you copy matches
  // what's on screen even before Save (Save persists it as the show default).
  const live: EmbedConfig = {
    source,
    episodePublicId: source === "episode" ? episodePublicId || null : null,
    player,
    theme,
    accent,
    chapters,
    transcript,
    follow,
  };
  const snippets = buildSnippets(origin, ctx.slug, live);
  const code = tab === "iframe" ? snippets.iframe : tab === "script" ? snippets.script : snippets.link;
  const noEpisodes = source === "episode" && ctx.eligibleEpisodes.length === 0;

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be unavailable (insecure context, permissions); the
      // snippet is selectable text either way.
    }
  }

  return (
    <Page>
      <PageHeader eyebrow="Public page &amp; embeds" title="Embed players" description="Put a player for one episode, your latest episode or the whole show on any website." actions={<ViewPublicPage />} />

      <Form method="post" className="flex flex-col gap-5">
        <section className="flex flex-col gap-4 rounded-[14px] border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-muted-foreground">Options</h2>

          <div className="flex flex-col gap-1.5">
            <Label>What to embed</Label>
            <Radios name="source" options={SOURCE_OPTIONS} value={source} onChange={setSource} />
            {source === "episode" && (
              <div className="mt-1.5">
                {ctx.eligibleEpisodes.length === 0 ? (
                  <p className="text-[12.5px] text-muted-foreground">
                    No public, published episodes yet — only those are eligible to embed.
                  </p>
                ) : (
                  <FormSelect
                    name="episodePublicId"
                    aria-label="Episode"
                    value={episodePublicId}
                    onValueChange={setEpisodePublicId}
                    options={ctx.eligibleEpisodes.map((e) => ({
                      value: e.publicId,
                      label: `${e.number != null ? `Ep. ${e.number} — ` : ""}${e.title}`,
                    }))}
                  />
                )}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Player</Label>
            <Radios name="player" options={PLAYER_OPTIONS} value={player} onChange={setPlayer} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Theme</Label>
            <Radios name="theme" options={THEME_OPTIONS} value={theme} onChange={setTheme} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Accent</Label>
            <ChoiceCards
              name="accent"
              aria-label="Accent"
              value={accent}
              onValueChange={setAccent}
              options={ACCENT_OPTIONS}
            />
          </div>

          <div className="flex flex-wrap gap-5">
            <Toggle name="chapters" label="Chapters" checked={chapters} onChange={setChapters} />
            <Toggle name="transcript" label="Transcript button" checked={transcript} onChange={setTranscript} />
            <Toggle name="follow" label="Follow button" checked={follow} onChange={setFollow} />
          </div>

          {actionData?.error && <p className="text-[13px] text-destructive">{actionData.error}</p>}
          {actionData?.saved && <p className="text-[13px] text-ok">Saved as the show's default embed.</p>}

          <div>
            <Button type="submit" disabled={submitting || noEpisodes}>
              Save as default
            </Button>
          </div>
        </section>
      </Form>

      <section className="mt-5 flex flex-col gap-3 rounded-[14px] border border-border bg-card p-5">
        <h2 className="text-sm font-semibold text-muted-foreground">Live preview</h2>
        {noEpisodes ? (
          <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-[13px] text-muted-foreground">
            Pick an eligible episode to preview.
          </p>
        ) : (
          <iframe
            key={embedSrc(origin, ctx.slug, live)}
            src={embedSrc(origin, ctx.slug, live)}
            title="Embed preview"
            sandbox="allow-scripts allow-popups"
            className="w-full rounded-md border border-border"
            style={{ height: player === "video" ? 400 : 196 }}
            data-testid="preview"
          />
        )}
        <p className="text-[11.5px] text-muted-foreground">
          This is the live player, exactly as visitors will see it. Chapters and the transcript button appear once
          episodes have them.
        </p>
      </section>

      <section className="mt-5 flex flex-col gap-3 rounded-[14px] border border-border bg-card p-5">
        <div className="flex items-center justify-between gap-3">
          <div role="tablist" className="flex gap-1">
            {TABS.map((t) => (
              <Button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                variant={tab === t.id ? "outline" : "ghost"}
                size="sm"
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </Button>
            ))}
          </div>
          <Button type="button" variant="outline" size="sm" onClick={copy} disabled={noEpisodes}>
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <p className="text-[12.5px] text-muted-foreground">{TABS.find((t) => t.id === tab)?.note}</p>
        {noEpisodes ? (
          <p className="text-[12.5px] text-muted-foreground">Pick an eligible episode to generate a snippet.</p>
        ) : (
          <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 font-mono text-[12px]" data-testid="snippet">
            {code}
          </pre>
        )}
        <p className="text-[11.5px] text-muted-foreground">
          Default accent for new embeds comes from{" "}
          <Link to="/studio/public/brand" className="underline hover:text-foreground">Brand &amp; theme</Link>.
          {" "}Origin shown is this studio's own host ({origin}); the real public domain isn't chosen yet.
        </p>
      </section>
    </Page>
  );
}
