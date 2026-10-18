import { useLocation } from "react-router";
import { screenByPath } from "~/lib/screens";

// Shared placeholder for every screen not built yet. Per Stage-00: "Leave stub
// routes, not half-built features." One file backs many route() entries in
// routes.ts so all 36 screen ids resolve without 404ing, without 35 duplicate
// placeholder files.
export default function ScreenPlaceholder() {
  const location = useLocation();
  const screen = screenByPath(location.pathname);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <span className="rounded-full border border-border px-2.5 py-0.5 font-mono text-[11px] text-muted-foreground">
        Screen {screen?.id ?? "?"}
      </span>
      <h1 className="text-xl font-semibold">{screen?.label ?? "Not built yet"}</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        Placeholder route — see{" "}
        <code className="font-mono text-[12.5px]">docs/design/README.md</code> for
        the intended layout and{" "}
        <code className="font-mono text-[12.5px]">docs/design/STATUS.md</code> for
        when this stage is scheduled.
        {screen?.note ? ` ${screen.note}.` : ""}
      </p>
    </div>
  );
}
