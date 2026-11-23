import { Monitor, Moon, Sun } from "lucide-react"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useTheme, type Theme } from "@/lib/theme"

/** System / Light / Dark switch. The choice is remembered per browser. */
export function ThemeToggle() {
  const [theme, setTheme] = useTheme()
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      value={theme}
      onValueChange={(v) => v && setTheme(v as Theme)}
      aria-label="Theme"
    >
      <ToggleGroupItem value="system" aria-label="System theme"><Monitor /></ToggleGroupItem>
      <ToggleGroupItem value="light" aria-label="Light theme"><Sun /></ToggleGroupItem>
      <ToggleGroupItem value="dark" aria-label="Dark theme"><Moon /></ToggleGroupItem>
    </ToggleGroup>
  )
}
