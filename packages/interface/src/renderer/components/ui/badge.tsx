import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium leading-none transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-border/70 bg-surface-raised text-foreground",
        outline: "border-border bg-transparent text-muted-foreground",
        success: "border-success/30 bg-success-subtle/50 text-success",
        warning: "border-warning/30 bg-warning-subtle/40 text-warning",
        danger: "border-danger/30 bg-danger-subtle/40 text-danger",
        info: "border-info/30 bg-info-subtle/40 text-info",
        muted: "border-border/60 bg-muted text-muted-foreground",
      },
    },
    defaultVariants: { variant: "secondary" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
