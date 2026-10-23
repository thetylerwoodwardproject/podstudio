import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { faInstagram } from "@fortawesome/free-brands-svg-icons/faInstagram";
import { faYoutube } from "@fortawesome/free-brands-svg-icons/faYoutube";
import { faTiktok } from "@fortawesome/free-brands-svg-icons/faTiktok";
import { faBluesky } from "@fortawesome/free-brands-svg-icons/faBluesky";
import { faMastodon } from "@fortawesome/free-brands-svg-icons/faMastodon";
import { faThreads } from "@fortawesome/free-brands-svg-icons/faThreads";
import { faXTwitter } from "@fortawesome/free-brands-svg-icons/faXTwitter";
import { faFacebook } from "@fortawesome/free-brands-svg-icons/faFacebook";
import { faDiscord } from "@fortawesome/free-brands-svg-icons/faDiscord";
import { faLinkedin } from "@fortawesome/free-brands-svg-icons/faLinkedin";
import { faTwitch } from "@fortawesome/free-brands-svg-icons/faTwitch";
import { faPatreon } from "@fortawesome/free-brands-svg-icons/faPatreon";

// Shared by the studio screen 29 (Public page links) and the public pages (25/30).
// Each icon is imported from its own subpath so unused brand icons stay out of bundles.
export const PLATFORM_LABELS = {
  instagram: "Instagram",
  youtube: "YouTube",
  tiktok: "TikTok",
  bluesky: "Bluesky",
  mastodon: "Mastodon",
  threads: "Threads",
  x: "X",
  facebook: "Facebook",
  discord: "Discord",
  linkedin: "LinkedIn",
  twitch: "Twitch",
  patreon: "Patreon",
} as const;
export type Platform = keyof typeof PLATFORM_LABELS;
export const PLATFORM_LIST = Object.keys(PLATFORM_LABELS) as Platform[];

export const PLATFORM_ICONS: Record<Platform, IconDefinition> = {
  instagram: faInstagram,
  youtube: faYoutube,
  tiktok: faTiktok,
  bluesky: faBluesky,
  mastodon: faMastodon,
  threads: faThreads,
  x: faXTwitter,
  facebook: faFacebook,
  discord: faDiscord,
  linkedin: faLinkedin,
  twitch: faTwitch,
  patreon: faPatreon,
};

