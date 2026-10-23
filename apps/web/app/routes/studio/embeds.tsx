import { useState } from "react";
import { Form, useNavigation } from "react-router";
import { getEmbedContext, saveEmbedConfig } from "~/lib/embeds.server";
import type { EmbedConfig } from "~/lib/embeds.server";
import { buildSnippets } from "~/lib/embed-snippets";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";

// Screen 27 (Embed players, admin). Per README: what to embed (one episode /
// latest / whole show), player (audio / video), theme, accent, toggles for
// chapters / transcript / follow, live preview, three code tabs. Scoped down:
// - The config is one default set stored under `shows.settings.embed` (no
//   embeds table in BUILD_PLAN §4); snippets are derived from it.
// - The three code tabs are real, generated from the saved options.
// - The live preview and the URLs inside the snippets don't work end to end:
//   the embed player bundle (screen 28, `packages/embed`), the public
//   `/{show}/embed/*` route, `/embed.js` and `/oembed` aren't built. The
//   screen says so plainly instead of rendering a fake player.
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
  { value: "amber", label: "Show amber", swatch: "#e8b04a" },
  { value: "teal", label: "Teal", swatch: "#3fb8a5" },
  { value: "ink", label: "Ink", swatch: "#8f8e88" },
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
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup">
      {options.map((o) => (
        <label
          key={o.value}
          className={`flex cursor-pointer flex-col rounded-md border px-3 py-1.5 text-[13px] ${
            value === o.value ? "border-foreground bg-accent" : "border-border"
          }`}
        >
          <span className="flex items-center gap-2">
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="accent-foreground"
            />
            {o.label}
          </span>
          {o.hint && <span className="pl-6 text-[11.5px] text-muted-foreground">{o.hint}</span>}
        </label>
      ))}
    </div>
  );
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
    <label className="flex cursor-pointer items-center gap-2 text-[13px]">
      <input
        type="checkbox"
        name={name}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-foreground"
      />
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
      <div className="mx-auto max-w-2xl p-6">
        <h1 className="text-2xl font-semibold tracking-tight">Embed players</h1>
        <p className="mt-4 text-[13px] text-muted-foreground">No show seeded yet.</p>
      </div>
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
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-5">
        <div className="text-[12px] uppercase tracking-[0.08em] text-muted-foreground">
          Public page &amp; embeds
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Embed players</h1>
      </div>

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
                  <select
                    name="episodePublicId"
                    aria-label="Episode"
                    value={episodePublicId}
                    onChange={(e) => setEpisodePublicId(e.target.value)}
                    className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    {ctx.eligibleEpisodes.map((e) => (
                      <option key={e.publicId} value={e.publicId}>
                        {e.number != null ? `Ep. ${e.number} — ` : ""}
                        {e.title}
                      </option>
                    ))}
                  </select>
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
            <div className="flex flex-wrap gap-2" role="radiogroup">
              {ACCENT_OPTIONS.map((a) => (
                <label
                  key={a.value}
                  className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-[13px] ${
                    accent === a.value ? "border-foreground bg-accent" : "border-border"
                  }`}
                >
                  <input
                    type="radio"
                    name="accent"
                    value={a.value}
                    checked={accent === a.value}
                    onChange={() => setAccent(a.value)}
                    className="accent-foreground"
                  />
                  <span
                    aria-hidden
                    className="h-3 w-3 rounded-full border border-border"
                    style={{ background: a.swatch }}
                  />
                  {a.label}
                </label>
              ))}
            </div>
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
        <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-[13px] text-muted-foreground">
          Not available yet — the embed player itself (screen 28) isn't built, so there's nothing real
          to render here. The snippets below reflect your options exactly, but their URLs won't
          resolve until the player and the public embed route exist.
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
          Origin shown is this studio's own host ({origin}); the real public domain isn't chosen yet.
        </p>
      </section>
    </div>
  );
}
