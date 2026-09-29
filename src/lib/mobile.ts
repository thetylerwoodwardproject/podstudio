/** Shared boundary for the simplified recording experience. */
export const MOBILE_QUERY = '(max-width: 700px), (pointer: coarse) and (max-width: 900px)';
export const isMobile = () => matchMedia(MOBILE_QUERY).matches;
export function recordingUrl(episode: string, take?: string) {
  return `/episodes/${episode}/${isMobile() ? 'saved' : 'editor'}${take ? `?take=${encodeURIComponent(take)}` : ''}`;
}
export function recordingLink(link: HTMLAnchorElement, episode: string, take?: string) {
  link.href = recordingUrl(episode, take);
  link.textContent = isMobile() ? 'Review recording' : 'Open editor';
}
