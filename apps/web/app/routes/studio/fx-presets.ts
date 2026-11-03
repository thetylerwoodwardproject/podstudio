import { eq } from "drizzle-orm";
import { db, shows } from "@podstudio/db";
import { normalizeFx, type TrackFx } from "@podstudio/audio/fx";

// GET /studio/fx-presets — the show's saved FX presets. POST { name, fx } saves one; DELETE ?id= removes one.
// Stored in shows.settings.fxPresets (a show template's FX chain will reuse these).
type Preset = { id: string; name: string; fx: TrackFx };
const noStore = { "Cache-Control": "no-store" };

function read(): { showId: string | null; settings: Record<string, unknown>; presets: Preset[] } {
  const show = db.select({ id: shows.id, settings: shows.settings }).from(shows).get();
  const settings = ((show?.settings as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
  const raw = Array.isArray(settings.fxPresets) ? (settings.fxPresets as unknown[]) : [];
  const presets = raw
    .map((p) => {
      const r = p as Record<string, unknown>;
      const fx = normalizeFx(r?.fx);
      return fx && typeof r.id === "string" && typeof r.name === "string" ? { id: r.id, name: r.name, fx } : null;
    })
    .filter((p): p is Preset => p !== null);
  return { showId: show?.id ?? null, settings, presets };
}

export async function loader() {
  return Response.json({ presets: read().presets }, { headers: noStore });
}

export async function action({ request }: { request: Request }) {
  const { showId, settings, presets } = read();
  if (!showId) return Response.json({ error: "No show." }, { status: 404, headers: noStore });
  let next = presets;
  if (request.method === "POST") {
    const body = (await request.json().catch(() => null)) as { name?: unknown; fx?: unknown } | null;
    const name = typeof body?.name === "string" ? body.name.trim().slice(0, 60) : "";
    const fx = normalizeFx(body?.fx);
    if (!name || !fx) return Response.json({ error: "A preset needs a name and valid FX settings." }, { status: 422, headers: noStore });
    if (presets.length >= 50) return Response.json({ error: "That's 50 presets — delete one first." }, { status: 409, headers: noStore });
    // same name replaces
    next = [...presets.filter((p) => p.name.toLowerCase() !== name.toLowerCase()), { id: crypto.randomUUID(), name, fx }];
  } else if (request.method === "DELETE") {
    const id = new URL(request.url).searchParams.get("id");
    next = presets.filter((p) => p.id !== id);
  } else return new Response("Method not allowed", { status: 405 });
  db.update(shows).set({ settings: { ...settings, fxPresets: next } }).where(eq(shows.id, showId)).run();
  return Response.json({ ok: true, presets: next }, { headers: noStore });
}
