import { ViewPublicPage } from "~/components/view-public";
import { useState } from "react";
import { Form, useNavigation } from "react-router";
import { getBrandTheme, saveBrandTheme } from "~/lib/brand.server";
import { getBannerAdmin } from "~/lib/banner.server";
import { hasFeedMediaTarget } from "~/lib/media.server";
import { ShowArtwork } from "~/components/show-artwork";
import {
  BRAND_PRESETS,
  isNearBlack,
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
import { ChoiceCards } from "~/components/ui/choice-cards";
import { Checkbox } from "~/components/ui/checkbox";
import { Page, PageHeader } from "~/components/layout/page";

// Screen 29b (Brand & theme). Per README: per-show theme in `shows.theme`
// JSON emitted as CSS variables; accent (6 presets or a custom hex), public-
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
  return { theme: getBrandTheme(), banner: getBannerAdmin(), storageReady: hasFeedMediaTarget() };
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
      <Page>
        <h1 className="text-2xl font-semibold tracking-tight">Brand &amp; theme</h1>
        <p className="mt-4 text-[13px] text-muted-foreground">No show seeded yet.</p>
      </Page>
    );
  }
  return <BrandForm initial={loaderData.theme} actionData={actionData} banner={loaderData.banner} storageReady={loaderData.storageReady} />;
}

function Swatch({ hex }: { hex: string }) {
  return <span aria-hidden className="h-3.5 w-3.5 rounded-full border border-border" style={{ background: hex }} />;
}

function BrandForm({
  initial,
  actionData,
  banner,
  storageReady,
}: {
  initial: BrandTheme;
  actionData?: ActionData;
  banner: Awaited<ReturnType<typeof loader>>["banner"];
  storageReady: boolean;
}) {
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
    <Page>
      <PageHeader eyebrow="Public page &amp; embeds" title="Brand &amp; theme" description="Your accent color, header image and look for the public page, embeds and the studio." actions={<ViewPublicPage />} />

      <div className="mb-5">
        <ShowArtwork
          artwork={banner}
          storageReady={storageReady}
          endpoint="/studio/public/banner"
          heading="Header image"
          noun="header image"
          sectionId="banner"
          rules="PNG or JPEG, at least 1600×400 pixels and at least 2.5 times wider than tall (3200×800 is ideal), up to 5 MB. It is cropped to fit, so keep anything important near the center."
          missing="Optional. Without it, the top of your public page uses a soft wash of your show artwork."
        />
      </div>

      <Form method="post" className="flex flex-col gap-5">
        <section className="flex flex-col gap-4 rounded-[14px] border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-muted-foreground">Accent</h2>
          <ChoiceCards
            name="accent"
            aria-label="Accent"
            value={accent}
            onValueChange={setAccent}
            options={[
              ...(Object.keys(BRAND_PRESETS) as BrandPresetId[]).map((id) => ({
                value: id,
                label: BRAND_PRESETS[id].label,
                swatch: BRAND_PRESETS[id].hex,
              })),
              { value: "custom" as const, label: "Custom" },
            ]}
          />
          {accent === "custom" && (
            <div className="flex max-w-xs flex-col gap-1.5">
              <Label htmlFor="customHex">Hex color</Label>
              <Input id="customHex" name="customHex" value={customHex} onChange={(e) => setCustomHex(e.target.value)} placeholder="#c47f12" />
              {customInvalid && <p className="text-[12.5px] text-destructive">Enter a valid hex color, like #c47f12.</p>}
            </div>
          )}
        </section>

        <section className="flex flex-col gap-4 rounded-[14px] border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-muted-foreground">Public site appearance</h2>
          <ChoiceCards
            name="appearance"
            aria-label="Appearance"
            value={appearance}
            onValueChange={setAppearance}
            options={APPEARANCE_OPTIONS}
          />
          <h2 className="mt-1 text-sm font-semibold text-muted-foreground">Corners</h2>
          <ChoiceCards
            name="corners"
            aria-label="Corners"
            value={corners}
            onValueChange={setCorners}
            options={(Object.keys(CORNERS) as CornersId[]).map((id) => ({
              value: id,
              label: (
                <>
                  {CORNERS[id].label}
                  <span className="text-[11.5px] text-muted-foreground">
                    {CORNERS[id].control} / {CORNERS[id].card} px
                  </span>
                </>
              ),
            }))}
          />
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
            <label key={key} className="flex cursor-pointer items-center gap-2.5 text-[13px]">
              <Checkbox
                name={`scope-${key}`}
                checked={scopes[key]}
                onCheckedChange={(v) => setScopes({ ...scopes, [key]: v === true })}
              />
              {label}
              {hint && <span className="text-[11.5px] text-muted-foreground">— {hint}</span>}
            </label>
          ))}
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
          {isNearBlack(hex) ? " (black shows as bone on dark backgrounds)" : ""}.
        </p>
      </section>
    </Page>
  );
}
