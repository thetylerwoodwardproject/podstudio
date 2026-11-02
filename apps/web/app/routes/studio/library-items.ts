import { createLibraryItem, listLibrary } from "~/lib/library.server";

// GET /studio/library/items — the show's library. PUT — the raw file as the body (X-Filename and X-Name
// URI-encoded, X-Kind music|sfx). Kept as-is; the worker converts it.
const noStore = { "Cache-Control": "no-store" };
export async function loader() {
  return Response.json({ items: listLibrary() }, { headers: noStore });
}

export async function action({ request }: { request: Request }) {
  if (request.method !== "PUT") return new Response("Method not allowed", { status: 405 });
  const dec = (h: string) => {
    try {
      return decodeURIComponent(request.headers.get(h) ?? "");
    } catch {
      return "";
    }
  };
  const length = Number(request.headers.get("content-length"));
  const r = await createLibraryItem({ filename: dec("x-filename"), name: dec("x-name") || null, kind: dec("x-kind"), contentLength: Number.isFinite(length) && length > 0 ? length : null, body: request.body });
  return Response.json(r, { status: r.ok ? 200 : r.status, headers: r.ok ? noStore : { ...noStore, Connection: "close" } });
}
