import { createRecording } from "~/lib/recordings.server";

// POST /studio/recordings — start a recording for an episode. JSON in, JSON out.
// (Under /studio, so the auth middleware gates it.)
export async function action({ request }: { request: Request }) {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const b = (await request.json().catch(() => null)) as { episodeId?: string; sampleRate?: number; channels?: number; device?: unknown } | null;
  const r = createRecording(String(b?.episodeId ?? ""), { sampleRate: Number(b?.sampleRate), channels: Number(b?.channels), device: b?.device ?? null });
  return r.ok ? Response.json({ ok: true, id: r.id }) : Response.json({ ok: false, error: r.error }, { status: r.status });
}
