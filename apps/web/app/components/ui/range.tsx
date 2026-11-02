import { cn } from "~/lib/utils";

/** A styled range slider (styles in app.css); the filled part follows the value. */
export function Range({ className, min = 0, max = 100, value, ...props }: Omit<React.ComponentProps<"input">, "type" | "value" | "min" | "max"> & { min?: number; max?: number; value: number }) {
  const fill = max === min ? 0 : Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  return <input type="range" className={cn("ps-range w-full", className)} min={min} max={max} value={value} style={{ ["--fill" as string]: `${fill}%` }} {...props} />;
}
