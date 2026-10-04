/** The six UI-standard colors available for editor tracks. */
export const EDITOR_TRACK_COLORS = ['yellow', 'teal', 'green', 'red', 'purple', 'black'] as const;
export type EditorTrackColor = (typeof EDITOR_TRACK_COLORS)[number];

export const EDITOR_TRACK_COLOR_LABELS: Record<EditorTrackColor, string> = {
  yellow: 'Yellow',
  teal: 'Teal',
  green: 'Green',
  red: 'Red',
  purple: 'Purple',
  black: 'Graphite',
};

export const editorTrackColor = (color: EditorTrackColor) => `var(--pad-${color})`;
export const isEditorTrackColor = (value: unknown): value is EditorTrackColor =>
  typeof value === 'string' && (EDITOR_TRACK_COLORS as readonly string[]).includes(value);
export const defaultEditorTrackColor = (index: number): EditorTrackColor =>
  EDITOR_TRACK_COLORS[Math.max(0, index) % EDITOR_TRACK_COLORS.length];
