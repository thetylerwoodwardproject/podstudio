import * as React from "react"

export type Theme = "system" | "light" | "dark"
const KEY = "theme"

export function getStoredTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY)
    if (v === "light" || v === "dark" || v === "system") return v
  } catch { /* storage unavailable */ }
  return "dark"
}

export function applyTheme(t: Theme) {
  const dark = t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches)
  document.documentElement.classList.toggle("dark", dark)
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = React.useState<Theme>(getStoredTheme)
  const set = React.useCallback((t: Theme) => {
    setTheme(t)
    try { localStorage.setItem(KEY, t) } catch { /* storage unavailable */ }
    applyTheme(t)
  }, [])
  return [theme, set]
}
