import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { faPodcast } from "@fortawesome/free-solid-svg-icons/faPodcast";
import { faCirclePlay } from "@fortawesome/free-solid-svg-icons/faCirclePlay";
import { faTowerBroadcast } from "@fortawesome/free-solid-svg-icons/faTowerBroadcast";
import { faSpotify } from "@fortawesome/free-brands-svg-icons/faSpotify";
import { faYoutube } from "@fortawesome/free-brands-svg-icons/faYoutube";
import { faAmazon } from "@fortawesome/free-brands-svg-icons/faAmazon";
import type { DirectoryId } from "~/lib/directories";

export const DIRECTORY_ICONS: Record<DirectoryId, IconDefinition> = {
  apple: faPodcast,
  spotify: faSpotify,
  youtubeMusic: faYoutube,
  pocketCasts: faCirclePlay,
  overcast: faTowerBroadcast,
  amazon: faAmazon,
};
