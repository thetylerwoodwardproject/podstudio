import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

export type Chip = { value: string; label: string; count?: number }

/** Filter chips with counts, built on the shadcn ToggleGroup. */
export function FilterChips({ chips, value, onChange }: { chips: Chip[]; value: string; onChange: (v: string) => void }) {
  return (
    <ToggleGroup type="single" variant="outline" size="sm" value={value} onValueChange={(v) => v && onChange(v)} className="flex-wrap">
      {chips.map((c) => (
        <ToggleGroupItem key={c.value} value={c.value} className="px-3">
          {c.label}
          {c.count !== undefined && <span className="ml-1 font-mono text-xs text-muted-foreground">{c.count}</span>}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
