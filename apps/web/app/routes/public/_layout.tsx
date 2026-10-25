import { Outlet, data } from "react-router";
import { getPublicShell } from "~/lib/public.server";
import { PublicChrome } from "~/components/public/public-layout";
import { PlayerProvider } from "~/components/public/player-context";
import { StickyPlayer } from "~/components/public/sticky-player";

// Layout route for the public show + episode pages. It owns the page chrome and the
// site-wide audio player, so playback survives navigation between those pages.
// Pathless: the child routes keep their own `:showSlug` paths.
export async function loader({ params }: { params: { showSlug?: string } }) {
  const shell = getPublicShell(params.showSlug ?? "");
  if (!shell) throw data("Not found", { status: 404 });
  return shell;
}

export default function PublicLayoutRoute({ loaderData }: { loaderData: Awaited<ReturnType<typeof loader>> }) {
  return (
    <PlayerProvider>
      <PublicChrome show={loaderData.show} links={loaderData.links}>
        <Outlet />
        <StickyPlayer />
      </PublicChrome>
    </PlayerProvider>
  );
}
