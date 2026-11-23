import * as React from "react"

/** Tiny hash router: `#/stations` or `#/station/kut-hd`. Returns the route without the leading slash. */
export function useHashRoute(fallback: string): [string, (route: string) => void] {
  const read = () => location.hash.replace(/^#\/?/, "").split("?")[0] || fallback
  const [route, setRoute] = React.useState(read)
  React.useEffect(() => {
    const on = () => setRoute(read())
    window.addEventListener("hashchange", on)
    return () => window.removeEventListener("hashchange", on)
  }, [])
  return [route, (r) => { location.hash = "/" + r }]
}
