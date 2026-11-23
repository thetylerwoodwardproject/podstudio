import { createLucideIcon } from "lucide-react"

/**
 * PodStudio app icon as a Lucide-style glyph, used in the sidebar tile.
 * The full-colour icon is public/icon.svg (the favicon) and docs/images/icon.svg.
 */
export const BrandIcon = createLucideIcon("podstudio", [["rect", {"x": "8.5", "y": "2", "width": "7", "height": "12", "rx": "3.5"}], ["path", {"d": "M5 11a7 7 0 0 0 14 0"}], ["path", {"d": "M12 18v3"}], ["path", {"d": "M8.5 21h7"}], ["path", {"d": "M10.6 9v2.2", "strokeWidth": "1.2"}], ["path", {"d": "M12 6.2v5", "strokeWidth": "1.2"}], ["path", {"d": "M13.4 7.8v3.4", "strokeWidth": "1.2"}], ["circle", {"cx": "19.2", "cy": "4.2", "r": "1.7"}]])

/** Classes for the sidebar tile behind the glyph. */
export const brandTile = "bg-zinc-950 text-zinc-50 ring-1 ring-white/15"
