"use client";

import * as React from "react";
import { ALargeSmall, Check, Type } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  applyTextSize,
  normalizeTextSize,
  readTextSize,
  setTextSize,
  TEXT_SIZE_EVENT,
  TEXT_SIZES,
  type TextSize,
} from "@/lib/text-size";

/**
 * Post-hydration mirror of the persisted text-size setting. The pre-paint
 * script in layout.tsx already applied the visual size — this only keeps
 * control state honest (start from the default to avoid SSR mismatches).
 */
export function useTextSize(): [TextSize, (t: TextSize) => void] {
  const [size, setSize] = React.useState<TextSize>("md");
  React.useEffect(() => {
    setSize(readTextSize());
    const sync = () => setSize(readTextSize());
    window.addEventListener(TEXT_SIZE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(TEXT_SIZE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  const update = React.useCallback((t: TextSize) => {
    setTextSize(t);
    setSize(normalizeTextSize(t));
  }, []);
  return [size, update];
}

/** Segmented A− / A / A+ control used by the Settings card (and previews). */
export function TextSizeSegments({
  value,
  onChange,
  className,
}: {
  value: TextSize;
  onChange: (t: TextSize) => void;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Text size"
      className={cn("grid grid-cols-3 gap-1.5 rounded-xl border border-border/60 bg-muted/40 p-1.5", className)}
    >
      {TEXT_SIZES.map((s) => {
        const active = value === s.key;
        return (
          <button
            key={s.key}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(s.key)}
            className={cn(
              "relative flex flex-col items-center gap-0.5 rounded-lg border px-2 py-2 transition-all",
              active
                ? "border-primary/50 bg-background shadow-sm"
                : "border-transparent text-muted-foreground hover:bg-background/60"
            )}
          >
            <span
              className={cn(
                "font-semibold leading-none tracking-tight",
                s.key === "sm" ? "text-sm" : s.key === "md" ? "text-base" : "text-xl"
              )}
            >
              {s.key === "sm" ? "A−" : s.key === "md" ? "A" : "A+"}
            </span>
            <span className="text-[10px] font-medium uppercase tracking-wide">{s.label}</span>
            {active && (
              <Check className="absolute right-1.5 top-1.5 size-3 text-primary" aria-hidden="true" />
            )}
          </button>
        );
      })}
    </div>
  );
}

export function TextSizeCard() {
  const [size, setSize] = useTextSize();
  const active = TEXT_SIZES.find((s) => s.key === size) ?? TEXT_SIZES[1];

  return (
    <Card className="rounded-xl border-border/60">
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2 text-base tracking-tight">
            <Type className="size-4 text-emerald-500" aria-hidden="true" />
            Text size
          </CardTitle>
          <CardDescription className="text-xs">
            Scales the entire interface — buttons, cards, charts and labels move together.
          </CardDescription>
        </div>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <ALargeSmall className="size-4.5" aria-hidden="true" />
        </span>
      </CardHeader>
      <CardContent className="space-y-3">
        <TextSizeSegments value={size} onChange={setSize} />

        {/* Live preview box rendered at the chosen root size */}
        <div className="rounded-lg border border-dashed border-border/70 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Preview · {active.label} ({active.px}px root)
          </p>
          <p className="mt-1 text-sm font-medium">Overall attendance 66.67%</p>
          <p className="text-xs text-muted-foreground">
            Attend the next class to reach the 75% target.
          </p>
        </div>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          {active.hint}. The choice is saved on this device and applied before the page paints,
          so there is no flicker on reload.
        </p>
      </CardContent>
    </Card>
  );
}
