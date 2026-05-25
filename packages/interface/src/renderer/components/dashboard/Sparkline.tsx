import { useMemo } from "react";
import { cn } from "../../lib/utils";
import type { Tone } from "../../lib/tone";

const toneStroke: Record<Tone, string> = {
  success: "stroke-success",
  warning: "stroke-warning",
  danger: "stroke-danger",
  info: "stroke-info",
  neutral: "stroke-muted-foreground/70",
};

const toneFill: Record<Tone, string> = {
  success: "fill-success/15",
  warning: "fill-warning/15",
  danger: "fill-danger/15",
  info: "fill-info/15",
  neutral: "fill-muted-foreground/10",
};

export function Sparkline({
  values,
  tone = "neutral",
  className,
  filled = true,
}: {
  values: number[];
  tone?: Tone;
  className?: string;
  filled?: boolean;
}) {
  const path = useMemo(() => {
    if (values.length === 0) return { line: "", area: "" };
    const w = 100;
    const h = 32;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const step = values.length > 1 ? w / (values.length - 1) : 0;
    const points = values.map((value, index) => {
      const x = index * step;
      const y = h - ((value - min) / span) * (h - 4) - 2;
      return [x, y] as const;
    });
    const line = points
      .map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`)
      .join(" ");
    const area = filled ? `${line} L${w},${h} L0,${h} Z` : "";
    return { line, area };
  }, [filled, values]);

  if (values.length < 2) return null;

  return (
    <svg
      viewBox="0 0 100 32"
      preserveAspectRatio="none"
      className={cn("overflow-visible", className)}
      aria-hidden="true"
    >
      {filled ? <path d={path.area} className={cn(toneFill[tone])} /> : null}
      <path
        d={path.line}
        fill="none"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={cn(toneStroke[tone])}
      />
    </svg>
  );
}
