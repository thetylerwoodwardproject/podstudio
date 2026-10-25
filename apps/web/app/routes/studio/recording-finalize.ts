import { finalizeRecording } from "~/lib/recordings.server";

// POST /studio/recordings/:id/finalize — assemble the WAV from the verified chunks.
export async function action({ request, params }: { request: Request; params: { id?: string } }) {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const b = (await request.json().catch(() => ({}))) as { chunkCount?: number; totalSamples?: number; lostTailSamples?: number; allowPartial?: boolean };
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : undefined);
  const r = await finalizeRecording(params.id ?? "", { chunkCount: num(b.chunkCount), totalSamples: num(b.totalSamples), lostTailSamples: num(b.lostTailSamples), allowPartial: b.allowPartial === true });
  return r.ok ? Response.json(r) : Response.json({ ok: false, error: r.error, missing: "missing" in r ? r.missing : undefined }, { status: r.status });
}
