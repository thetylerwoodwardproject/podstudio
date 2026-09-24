/*
 * Voice-follow matching: find where in the script the reader is, from the
 * last few words speech recognition heard.
 *
 * The heard words are aligned (local alignment, like Smith-Waterman) against
 * a window of the script around the current position. Recognition drops,
 * merges and mishears words, so matches are fuzzy and gaps are allowed.
 * Words that match nothing (ad-libs) simply don't move the position.
 */

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function numberWords(n: number): string[] {
  if (n < 20) return [ONES[n]];
  if (n < 100) return [TENS[Math.floor(n / 10)], ...(n % 10 ? [ONES[n % 10]] : [])];
  if (n < 1000) return [ONES[Math.floor(n / 100)], 'hundred', ...(n % 100 ? numberWords(n % 100) : [])];
  return [String(n)];
}

/** Lowercase words without punctuation; small numbers are spelled out so "4" matches "four". */
export function normalize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[’']/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .flatMap((w) => (/^\d+$/.test(w) ? numberWords(Number(w)) : [w]));
}

/** Similarity of two words, 0..1 (edit distance based). */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const m = a.length;
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return 1 - prev[n] / Math.max(m, n);
}

const MATCH = (a: string, b: string) => {
  const s = similarity(a, b);
  return s >= 0.75 ? 2 * s : -1;
};
const GAP = -0.6;

export interface MatchResult {
  /** Index of the last script word the reader has said */
  index: number;
  /** How many heard words lined up with the script */
  matched: number;
  score: number;
}

export interface MatchOptions {
  /** Script words before the current position to consider (re-reads) */
  behind?: number;
  /** Script words after the current position to consider */
  ahead?: number;
  /** Words needed for a match; one word is accepted only right after the cursor */
  minWords?: number;
}

/**
 * Align `heard` (normalized, most recent last) against `script` (normalized)
 * near `cursor`. Returns null when nothing lines up well enough.
 */
export function locate(script: string[], heard: string[], cursor: number, opts: MatchOptions = {}): MatchResult | null {
  const { behind = 12, ahead = 60, minWords = 2 } = opts;
  if (!heard.length || !script.length) return null;
  const from = Math.max(0, cursor - behind);
  const to = Math.min(script.length, cursor + ahead + 1);
  const win = script.slice(from, to);

  // H[i][j]: best local alignment ending at heard[i-1], win[j-1]; M counts matched words.
  const rows = heard.length + 1;
  const cols = win.length + 1;
  const H = Array.from({ length: rows }, () => new Float64Array(cols));
  const M = Array.from({ length: rows }, () => new Uint16Array(cols));
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const m = MATCH(heard[i - 1], win[j - 1]);
      const diag = H[i - 1][j - 1] + m;
      const up = H[i - 1][j] + GAP;
      const left = H[i][j - 1] + GAP;
      const best = Math.max(0, diag, up, left);
      H[i][j] = best;
      M[i][j] = best === 0 ? 0 : best === diag ? M[i - 1][j - 1] + (m > 0 ? 1 : 0) : best === up ? M[i - 1][j] : M[i][j - 1];
    }
  }

  // Alignments that end on the most recent heard word say where the reader is now.
  // Recognition often reports the word being spoken half-finished ("transmi"), so an
  // alignment ending on the word before it also counts, placing the reader one word on.
  let best: MatchResult | null = null;
  const last = rows - 1;
  for (const [row, step, penalty] of [[last, 0, 0], [last - 1, 1, 0.8]] as const) {
    if (row < 1) continue;
    for (let j = 1; j < cols; j++) {
      const matched = M[row][j];
      if (!matched || MATCH(heard[row - 1], win[j - 1]) < 0) continue;
      const index = Math.min(from + j - 1 + step, script.length - 1);
      // Prefer positions close to (and just after) the cursor.
      const distance = index >= cursor ? index - cursor : (cursor - index) * 2;
      const score = H[row][j] - distance * 0.05 - penalty;
      const enough = matched >= minWords || (matched === 1 && index >= cursor && index <= cursor + 2);
      if (enough && (!best || score > best.score)) best = { index, matched, score };
    }
  }
  return best;
}
