import { Badge } from "../ui/badge";
import { cn } from "../../lib/utils";
import { toneBadgeVariant, toneIndicatorClass, type Tone } from "../../lib/tone";

export function StatusPill({
  value,
  tone,
  className,
}: {
  value: string;
  tone: Tone;
  className?: string;
}) {
  return (
    <Badge variant={toneBadgeVariant[tone]} className={cn("gap-1.5", className)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", toneIndicatorClass[tone])} />
      {value}
    </Badge>
  );
}

export function ToneDot({ tone, className }: { tone: Tone; className?: string }) {
  return <span className={cn("h-1.5 w-1.5 rounded-full", toneIndicatorClass[tone], className)} />;
}
