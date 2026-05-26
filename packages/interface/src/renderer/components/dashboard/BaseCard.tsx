import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";
import type { Tone } from "../../lib/tone";

const baseCardVariants = cva(
  "group flex flex-col gap-3 rounded-lg border border-border bg-surface-subtle text-card-foreground transition-colors",
  {
    variants: {
      variant: {
        default: "",
        interactive:
          "cursor-pointer hover:border-border hover:bg-surface-raised hover:shadow-[0_10px_30px_-18px_hsl(0_0%_0%/0.7)]",
        accent: "border-l-2",
      },
      padding: {
        compact: "p-3",
        comfortable: "p-4",
        roomy: "p-5",
      },
    },
    defaultVariants: { variant: "default", padding: "comfortable" },
  },
);

const accentBorderClass: Record<Tone, string> = {
  success: "border-l-success",
  warning: "border-l-warning",
  danger: "border-l-danger",
  info: "border-l-info",
  neutral: "border-l-muted-foreground/60",
};

export interface BaseCardProps
  extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof baseCardVariants> {
  accentTone?: Tone;
}

export const BaseCard = forwardRef<HTMLDivElement, BaseCardProps>(
  ({ className, variant, padding, accentTone, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        baseCardVariants({ variant, padding }),
        variant === "accent" && accentTone && accentBorderClass[accentTone],
        className,
      )}
      {...props}
    />
  ),
);
BaseCard.displayName = "BaseCard";

/**
 * Slot riusabile per header di card: titolo + sottotitolo a sinistra,
 * children (badge/pill/azioni) a destra.
 */
export function BaseCardHeader({
  title,
  subtitle,
  children,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        <div className="text-card-title truncate">{title}</div>
        {subtitle ? <div className="text-meta mt-1 line-clamp-2">{subtitle}</div> : null}
      </div>
      {children ? <div className="flex shrink-0 items-center gap-2">{children}</div> : null}
    </div>
  );
}

/**
 * Footer divisorio: linea, gap, slot. Mantiene padding fisso e divider coerente.
 */
export function BaseCardFooter({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mt-auto flex flex-wrap items-center gap-2 border-t border-border/60 pt-3 text-meta",
        className,
      )}
    >
      {children}
    </div>
  );
}
