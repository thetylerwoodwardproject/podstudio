/** ID3v2 tag or an MPEG audio frame sync (0xFFEx / 0xFFFx). */
export function looksLikeMp3(head: Uint8Array): boolean {
  if (head.length < 3) return false;
  if (head[0] === 0x49 && head[1] === 0x44 && head[2] === 0x33) return true;
  return head[0] === 0xff && (head[1] & 0xe0) === 0xe0;
}
