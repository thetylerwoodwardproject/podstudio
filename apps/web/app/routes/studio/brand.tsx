import { useState } from "react";
import { Form, useNavigation } from "react-router";
import { getBrandTheme, saveBrandTheme } from "~/lib/brand.server";
import {
  BRAND_PRESETS,
  CORNERS,
  accentHex,
  brandVars,
  contrast,
  normalizeHex,
  studioAccent,
  type Appearance,
  type BrandPresetId,
  type BrandTheme,
  type CornersId,
} from "~/lib/brand-theme";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";

// Screen 29b (Brand & theme). Per README: per-show theme in `shows.theme`
// JSON emitted as CSS variables; accent (8 presets or a custom hex), public-
// site appearance, corners, and on/off scopes for Public site / Embed players /
// Studio; contrast rules for text-on-accent and link colour.
// Real: the whole form, persisted to `shows.theme`, with the README's contrast
// maths in lib/brand-theme.ts and a live preview that applies the generated
// `--brand-*` variables to sample elements (so the contrast result is visible
// and the ratios are printed).
// Consumers: the public pages (25/30) apply it under the Public-site scope, and
// the Studio layout applies accent -> primary buttons / focus ring / active nav
// bar under the Studio scope. Nothing reads the Embed-players scope yet (the
// embed player, screen 28, doesn't exist).
// No db imports here — see brand.server.ts.
const APPEARANCE_OPTIONS: { value: Appearance; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "auto", label: "Match device" },
];

export async function loader() {
  return { theme: getBrandTheme() };
}

export async function action({ request }: { request: Request }) {
  const form = await request.formData();
  const str = (n: string) => ((form.get(n) as string) || "").trim();
  const result = saveBrandTheme({
    accent: str("accent"),
    customHex: str("customHex") || null,
    appearance: str("appearance"),
    corners: str("corners"),
    scopes: {
      publicSite: form.get("scope-publicSite") === "on",
      embeds: form.get("scope-embeds") === "on",
      studio: form.get("scope-studio") === "on",
    },
  });
  if (!result.ok) return { error: result.error };
  return { saved: true };
}

type ActionData = { error?: string; saved?: boolean };

export default function Brand({
  loaderData,
  actionData,
}: {
  loaderData: Awaited<ReturnType<typeof loader>>;
  actionData?: ActionData;
}) {
  if (!loaderData.theme) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <h1 className="text-2xl font-semibold tracking-tight">Brand &amp; theme</h1>
        <p className="mt-4 text-[13px] text-muted-foreground">No show seeded yet.</p>
      </div>
    );
  }
  return <BrandForm initial={loaderData.theme} actionData={actionData} />;
}

function Swatch({ hex }: { hex: string }) {
  return <span aria-hidden className="h-3.5 w-3.5 rounded-full border border-border" style={{ background: hex }} />;
}

function BrandForm({ initial, actionData }: { initial: BrandTheme; actionData?: ActionData }) {
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting";
  const [accent, setAccent] = useState<BrandTheme["accent"]>(initial.accent);
  const [customHex, setCustomHex] = useState(initial.customHex ?? "");
  const [appearance, setAppearance] = useState<Appearance>(initial.appearance);
  const [corners, setCorners] = useState<CornersId>(initial.corners);
  const [scopes, setScopes] = useState(initial.scopes);

  const validCustom = normalizeHex(customHex);
  const customInvalid = accent === "custom" && !validCustom;
  // While a custom hex is invalid, preview falls back to the last good accent
  // rather than rendering garbage.
  const live: BrandTheme = {
    accent: customInvalid ? initial.accent : accent,
    customHex: validCustom ?? initial.customHex,
    appearance,
    corners,
    scopes,
  };
  const hex = accentHex(live);
  const lightVars = brandVars(live, "light");
  const darkVars = brandVars(live, "dark");

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-5">
        <div className="text-[12px] uppercase tracking-[0.08em] text-muted-foreground">
          Public page &amp; embeds
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Brand &amp; theme</h1>
      </div>

      <Form method="post" className="flex flex-col gap-5">
        <section className="flex flex-col gap-4 rounded-[14px] border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-muted-foreground">Accent</h2>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Accent">
            {(Object.keys(BRAND_PRESETS) as BrandPresetId[]).map((id) => (
              <label
                key={id}
                className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-[13px] ${
                  accent === id ? "border-foreground bg-accent" : "border-border"
                }`}
              >
                <input type="radio" name="accent" value={id} checked={accent === id} onChange={() => setAccent(id)} className="accent-foreground" />
                <Swatch hex={BRAND_PRESETS[id].hex} />
                {BRAND_PRESETS[id].label}
              </label>
            ))}
            <label
              className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-[13px] ${
                accent === "custom" ? "border-foreground bg-accent" : "border-border"
              }`}
            >
              <input type="radio" name="accent" value="custom" checked={accent === "custom"} onChange={() => setAccent("custom")} className="accent-foreground" />
              Custom
            </label>
          </div>
          {accent === "custom" && (
            <div className="flex max-w-xs flex-col gap-1.5">
              <Label htmlFor="customHex">Hex colour</Label>
              <Input id="customHex" name="customHex" value={customHex} onChange={(e) => setCustomHex(e.target.value)} placeholder="#c47f12" />
              {customInvalid && <p className="text-[12.5px] text-destructive">Enter a valid hex colour, like #c47f12.</p>}
            </div>
          )}
        </section>

        <section className="flex flex-col gap-4 rounded-[14px] border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-muted-foreground">Public site appearance</h2>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Appearance">
            {APPEARANCE_OPTIONS.map((o) => (
              <label key={o.value} className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-[13px] ${appearance === o.value ? "border-foreground bg-accent" : "border-border"}`}>
                <input type="radio" name="appearance" value={o.value} checked={appearance === o.value} onChange={() => setAppearance(o.value)} className="accent-foreground" />
                {o.label}
              </label>
            ))}
          </div>
          <h2 className="mt-1 text-sm font-semibold text-muted-foreground">Corners</h2>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Corners">
            {(Object.keys(CORNERS) as CornersId[]).map((id) => (
              <label key={id} className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-[13px] ${corners === id ? "border-foreground bg-accent" : "border-border"}`}>
                <input type="radio" name="corners" value={id} checked={corners === id} onChange={() => setCorners(id)} className="accent-foreground" />
                {CORNERS[id].label}
                <span className="text-[11.5px] text-muted-foreground">
                  {CORNERS[id].control} / {CORNERS[id].card} px
                </span>
              </label>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-3 rounded-[14px] border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-muted-foreground">Apply the brand to</h2>
          {(
            [
              ["publicSite", "Public site"],
              ["embeds", "Embed players", "default accent for new embeds"],
              ["studio", "Studio", "primary buttons, selection, focus ring, active nav bar"],
            ] as const
          ).map(([key, label, hint]) => (
            <label key={key} className="flex cursor-pointer items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                name={`scope-${key}`}
                checked={scopes[key]}
                onChange={(e) => setScopes({ ...scopes, [key]: e.target.checked })}
                className="accent-foreground"
              />
              {label}
              {hint && <span className="text-[11.5px] text-muted-foreground">— {hint}</span>}
            </label>
          ))}
          <p className="text-[11.5px] text-muted-foreground">
            The public site and Studio apply these now. The Embed players scope is saved but unused until
            the embed player (screen 28) exists.
          </p>
        </section>

        {actionData?.error && <p className="text-[13px] text-destructive">{actionData.error}</p>}
        {actionData?.saved && <p className="text-[13px] text-ok">Saved.</p>}
        <div>
          <Button type="submit" disabled={submitting || customInvalid}>
            Save theme
          </Button>
        </div>
      </Form>

      <section className="mt-6 flex flex-col gap-3 rounded-[14px] border border-border bg-card p-5">
        <h2 className="text-sm font-semibold text-muted-foreground">Preview</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {(
            [
              ["light", lightVars, "#ffffff", "#1b1a18"],
              ["dark", darkVars, "#151517", "#ecebe6"],
            ] as const
          ).map(([mode, vars, bg, fg]) => (
            <div
              key={mode}
              data-testid={`preview-${mode}`}
              className="flex flex-col gap-3 border border-border p-4"
              style={{ ...vars, background: bg, color: fg, borderRadius: "var(--brand-radius-card)" } as React.CSSProperties}
            >
              <div className="text-[11px] uppercase tracking-[0.08em] opacity-60">{mode} page</div>
              <button
                type="button"
                className="self-start px-4 py-2 text-[13px] font-medium"
                style={{ background: "var(--brand-accent)", color: "var(--brand-on-accent)", borderRadius: "var(--brand-radius-control)" }}
              >
                Play episode
              </button>
              <a href="#preview" onClick={(e) => e.preventDefault()} className="self-start text-[13px] underline" style={{ color: "var(--brand-link)" }}>
                A link in your show notes
              </a>
              <div className="px-3 py-2 text-[12.5px]" style={{ background: "var(--brand-tint)", borderRadius: "var(--brand-radius-control)" }}>
                Highlighted passage
              </div>
              <div className="text-[11.5px] opacity-70" data-testid={`ratios-${mode}`}>
                on-accent {contrast(vars["--brand-accent"], vars["--brand-on-accent"]).toFixed(1)}:1 · link{" "}
                {contrast(vars["--brand-link"], bg).toFixed(1)}:1
              </div>
            </div>
          ))}
        </div>
        <p className="text-[12px] text-muted-foreground" data-testid="studio-accent">
          Studio accent would be <span className="font-mono">{studioAccent(hex)}</span>
          {hex.toLowerCase() === BRAND_PRESETS.ink.hex ? " (ink becomes bone)" : ""}.
        </p>
      </section>
    </div>
  );
}
