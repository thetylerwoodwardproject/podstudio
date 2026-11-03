import { useSyncExternalStore } from "react";

const noop = () => () => {};

/**
 * A date and time in the viewer's own time zone. The server runs in UTC, so it renders nothing
 * and the browser fills it in after hydration (no mismatch, no wrong hour flashing).
 */
export function LocalTime({ ms, options = { dateStyle: "medium", timeStyle: "short" } }: { ms: number; options?: Intl.DateTimeFormatOptions }) {
  const text = useSyncExternalStore(
    noop,
    () => new Date(ms).toLocaleString("en-US", options),
    () => "",
  );
  return <span>{text}</span>;
}
