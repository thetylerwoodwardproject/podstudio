import { ExternalLink } from "lucide-react";
import { useShowSlug } from "~/components/layout/shell-context";

// "See it live" shortcut for any screen that changes what the public page shows.
// Opens in a new tab (the public site is a separate, cookie-free surface) so the
// editor stays where it is. `path` is relative to the show: "" = the show page.
export function ViewPublicPage({ path = "", label = "View public page" }: { path?: string; label?: string }) {
  const slug = useShowSlug();
  if (!slug) return null;
  return (
    <a
      href={`/${slug}${path}`}
      target="_blank"
      rel="noopener"
      data-testid="view-public"
      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-input bg-card px-3 py-1.5 text-[13px] font-medium hover:bg-accent"
    >
      {label}
      <ExternalLink className="size-3.5" aria-hidden />
    </a>
  );
}
