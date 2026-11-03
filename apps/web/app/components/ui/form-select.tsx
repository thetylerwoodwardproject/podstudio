import { useState } from "react";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "~/components/ui/select";
import { cn } from "~/lib/utils";

// shadcn Select with a native-<select>-like API, for forms: `name` submits the value
// through a hidden input (so "" submits as "", even though Radix forbids empty item
// values internally — those are mapped to a sentinel and back).
export type FormSelectOption = { value: string; label: string; disabled?: boolean };
export type FormSelectGroup = { label: string; options: FormSelectOption[] };

const EMPTY = "__empty__";
const enc = (v: string) => (v === "" ? EMPTY : v);
const dec = (v: string) => (v === EMPTY ? "" : v);

export function FormSelect({
  id,
  name,
  value,
  defaultValue,
  onValueChange,
  options,
  groups,
  placeholder,
  disabled,
  required,
  className,
  size,
  "aria-label": ariaLabel,
  "data-testid": testId,
}: {
  id?: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  onValueChange?: (v: string) => void;
  options?: FormSelectOption[];
  groups?: FormSelectGroup[];
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  size?: "sm" | "default";
  "aria-label"?: string;
  "data-testid"?: string;
}) {
  const [inner, setInner] = useState(defaultValue ?? "");
  const current = value ?? inner;
  const item = (o: FormSelectOption) => (
    <SelectItem key={o.value} value={enc(o.value)} disabled={o.disabled}>
      {o.label}
    </SelectItem>
  );
  return (
    <>
    {name && <input type="hidden" name={name} value={current} />}
    <Select
      value={enc(current)}
      onValueChange={(v) => {
        setInner(dec(v));
        onValueChange?.(dec(v));
      }}
      disabled={disabled}
      required={required}
    >
      <SelectTrigger id={id} size={size} aria-label={ariaLabel} data-testid={testId} className={cn("w-full bg-background", className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent position="popper" className="max-h-[320px]">
        {options?.map(item)}
        {groups?.map((g) => (
          <SelectGroup key={g.label}>
            <SelectLabel>{g.label}</SelectLabel>
            {g.options.map(item)}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
    </>
  );
}
