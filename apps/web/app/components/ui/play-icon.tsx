import { faPause, faPlay } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

/** Children for audiocn's AudioPlayerPlay: Font Awesome play/pause (CLAUDE.md icon set). */
export const playIcon = ({ playing }: { playing: boolean; loading: boolean }) => <FontAwesomeIcon icon={playing ? faPause : faPlay} style={playing ? undefined : { marginLeft: 1 }} />;
