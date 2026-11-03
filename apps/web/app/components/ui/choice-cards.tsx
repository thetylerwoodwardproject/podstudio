import type { ReactNode } from "react";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import { cn } from "~/lib/utils";

// A row (or grid) of selectable cards on shadcn's RadioGroup. `name` submits the
// chosen value with the surrounding <form>. Used for small "pick one" settings.
export type Choice<T extends string> = { value: T; label: ReactNode; hint?: ReactNode; swatch?: string };

export function ChoiceCards<T extends string>({
  name,
  value,
  onValueChange,
  options,
  className,
  "aria-label": ariaLabel,
}: {
  name?: string;
  value: T;
  onValueChange: (v: T) => void;
  options: readonly Choice<T>[];
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <RadioGroup
      name={name}
      value={value}
      onValueChange={(v) => onValueChange(v as T)}
      aria-label={ariaLabel}
      className={cn("flex flex-wrap gap-2", className)}
    >
      {options.map((o) => {
        const id = `${name ?? "choice"}-${o.value}`;
        const on = value === o.value;
        return (
          <label
            key={o.value}
            htmlFor={id}
            className={cn(
              "flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 text-[13px] transition-colors",
              on ? "border-primary/70 bg-accent" : "border-border hover:bg-accent/50",
            )}
          >
            <RadioGroupItem id={id} value={o.value} className="mt-0.5" />
            <span className="flex flex-col gap-0.5">
              <span className="flex items-center gap-2">
                {o.swatch && (
                  <span aria-hidden className="size-3 rounded-full border border-border" style={{ background: o.swatch }} />
                )}
                {o.label}
              </span>
              {o.hint && <span className="text-[11.5px] text-muted-foreground">{o.hint}</span>}
            </span>
          </label>
        );
      })}
    </RadioGroup>
  );
}
