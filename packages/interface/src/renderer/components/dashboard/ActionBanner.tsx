import { AlertTriangle, CheckCircle2, Info, X, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/utils";
import type { Tone } from "../../lib/tone";
import { useT } from "../../i18n/i18n";
import { Button } from "../ui/button";

const TONE_STYLE: Record<Tone, { container: string; icon: string; defaultIcon: LucideIcon }> = {
  success: {
    container: "border-success/40 bg-success-subtle/40 text-foreground",
    icon: "text-success",
    defaultIcon: CheckCircle2,
  },
  warning: {
    container: "border-warning/40 bg-warning-subtle/40 text-foreground",
    icon: "text-warning",
    defaultIcon: AlertTriangle,
  },
  danger: {
    container: "border-danger/40 bg-danger-subtle/40 text-foreground",
    icon: "text-danger",
    defaultIcon: AlertTriangle,
  },
  info: {
    container: "border-info/40 bg-info-subtle/40 text-foreground",
    icon: "text-info",
    defaultIcon: Info,
  },
  neutral: {
    container: "border-border bg-surface-subtle text-foreground",
    icon: "text-muted-foreground",
    defaultIcon: Info,
  },
};

/**
 * Banner di feedback unificato per stati transitori (last action, scan result,
 * errore handler). Sostituisce le banner ad-hoc piazzate in TodayView,
 * ClientsView, GrowthView, DeliveryView, RiskView.
 */
export function ActionBanner({
  tone = "neutral",
  title,
  detail,
  icon: Icon,
  onDismiss,
  className,
  children,
}: {
  tone?: Tone;
  title: ReactNode;
  detail?: ReactNode;
  icon?: LucideIcon;
  onDismiss?: () => void;
  className?: string;
  children?: ReactNode;
}) {
  const t = useT();
  const palette = TONE_STYLE[tone];
  const ResolvedIcon = Icon ?? palette.defaultIcon;
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-3 rounded-lg border px-3 py-2.5",
        palette.container,
        className,
      )}
    >
      <ResolvedIcon className={cn("mt-0.5 h-4 w-4 shrink-0", palette.icon)} />
      <div className="min-w-0 flex-1">
        <div className="text-body-secondary font-medium leading-tight">{title}</div>
        {detail ? <div className="text-meta mt-0.5">{detail}</div> : null}
        {children ? <div className="mt-2">{children}</div> : null}
      </div>
      {onDismiss ? (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onDismiss}
          aria-label={t("actionBanner.dismiss", "Dismiss notification")}
          className="shrink-0"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      ) : null}
    </div>
  );
}
