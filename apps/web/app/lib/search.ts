/** LIKE pattern for a visitor's search text: `%`, `_` and `\\` in it match themselves (use with `escape '\\'`). */
export function likePattern(q: string) {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
