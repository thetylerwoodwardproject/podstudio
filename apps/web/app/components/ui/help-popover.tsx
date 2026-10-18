import { useEffect, useRef, useState } from "react";
import { HelpCircle } from "lucide-react";

// Small "?" affordance that opens a glossary-style overlay. Every icon button
// needs an aria-label (CLAUDE.md's accessibility rule) — the trigger's label
// names what it explains, not just "help".
export function HelpPopover({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onClickOutside);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", onClickOutside);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative inline-flex">
      <button
        type="button"
        aria-label={`Explain ${label}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-5 w-5 items-center justify-center rounded-full border border-input text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <HelpCircle className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={`${label} help`}
          className="absolute left-0 top-full z-20 mt-2 w-80 rounded-lg border border-border bg-popover p-4 text-[13px] text-popover-foreground shadow-xl"
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function HelpTerm({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="mb-2.5 last:mb-0">
      <div className="font-mono text-[12px] text-foreground">{term}</div>
      <div className="text-muted-foreground">{children}</div>
    </div>
  );
}
