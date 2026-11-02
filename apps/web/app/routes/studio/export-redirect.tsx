import { redirect } from "react-router";

// Screen 12 (Export) is a dialog over the editor; this route opens the editor with it up.
export async function loader({ request }: { request: Request }) {
  const id = new URL(request.url).searchParams.get("episode");
  return redirect(id ? `/studio/editor?episode=${encodeURIComponent(id)}&export=1` : "/studio/editor");
}
