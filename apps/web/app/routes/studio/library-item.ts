import { deleteLibraryItem, updateLibraryItem } from "~/lib/library.server";

// PATCH /studio/library/items/:id { name?, kind? } · DELETE /studio/library/items/:id
export async function action({ request, params }: { request: Request; params: { id?: string } }) {
  const id = params.id ?? "";
  if (request.method === "PATCH") {
    const body = (await request.json().catch(() => ({}))) as { name?: unknown; kind?: unknown };
    const r = updateLibraryItem(id, body);
    return Response.json(r, { status: r.ok ? 200 : r.status });
  }
  if (request.method === "DELETE") {
    const r = await deleteLibraryItem(id);
    return Response.json(r, { status: r.ok ? 200 : r.status });
  }
  return new Response("Method not allowed", { status: 405 });
}
