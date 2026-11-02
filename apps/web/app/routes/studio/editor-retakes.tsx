import { redirect } from "react-router";

// Screen 09 (Retake cleanup) lives inside the editor as a docked panel (it needs the timeline
// beside it); this route just opens the editor with the panel up.
export async function loader({ request }: { request: Request }) {
  const id = new URL(request.url).searchParams.get("episode");
  return redirect(id ? `/studio/editor?episode=${encodeURIComponent(id)}&cleanup=1` : "/studio/editor");
}
