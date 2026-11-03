import type { ReactNode } from "react";
import { cn } from "~/lib/utils";

// One layout for every studio page so widths, padding and headers line up when
// you move between screens. `width`: "form" for settings-style pages (one column
// of cards), "wide" for tables and dashboards.
const WIDTH = { form: "max-w-3xl", wide: "max-w-6xl" } as const;

export function Page({
  width = "form",
  className,
  children,
}: {
  width?: keyof typeof WIDTH;
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn("mx-auto w-full px-4 py-6 sm:px-6 md:px-8 md:py-8", WIDTH[width], className)}>{children}</div>;
}

// Eyebrow (the sidebar section), title, optional one-line description, and actions
// on the right. Actions wrap under the title on narrow screens.
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  below,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  below?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="min-w-0 flex-1 basis-[320px]">
        {eyebrow && (
          <div className="mb-1 text-[11.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{eyebrow}</div>
        )}
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] [overflow-wrap:anywhere]">{title}</h1>
        {description && <p className="mt-1.5 max-w-[62ch] text-[13.5px] leading-relaxed text-muted-foreground">{description}</p>}
        {below && <div className="mt-2">{below}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 pt-1">{actions}</div>}
    </header>
  );
}
