import { Loader2, type LucideIcon } from "lucide-react";
import { Button, type ButtonProps } from "../ui/button";
import { cn } from "../../lib/utils";

/**
 * Action descrittore per i toolbar delle view.
 *
 * **Convenzione di naming verbi** (Codex futuro segue):
 *   - `Run <object>`      → scan, sync, watch (es. "Run follow-up scan")
 *   - `Generate <object>` → AI/draft output    (es. "Generate drafts")
 *   - `Verify <object>`   → check stato        (es. "Verify repositories")
 *   - `Retry <object>`    → recovery           (es. "Retry scan")
 *   - `Create <object>`   → write nuovo record (es. "Create opportunity")
 *   - `Open <object>`     → naviga             (es. "Open inbox")
 */
export interface ToolbarAction {
  label: string;
  icon?: LucideIcon;
  onClick: () => void;
  busy?: boolean;
  disabled?: boolean;
  variant?: ButtonProps["variant"];
  /** Etichetta alternativa mostrata durante busy. Default: "<label>…" */
  busyLabel?: string;
  tooltip?: string;
}

/**
 * Toolbar uniforme per il prop `action` di SectionShell. Sostituisce le
 * dozzine di `<Button>` ad-hoc piazzate caso per caso.
 */
export function ViewToolbar({
  primary,
  secondary = [],
  className,
}: {
  primary?: ToolbarAction;
  secondary?: ToolbarAction[];
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {secondary.map((action) => (
        <ToolbarButton key={action.label} action={action} fallbackVariant="outline" />
      ))}
      {primary ? <ToolbarButton action={primary} fallbackVariant="default" /> : null}
    </div>
  );
}

function ToolbarButton({
  action,
  fallbackVariant,
}: {
  action: ToolbarAction;
  fallbackVariant: ButtonProps["variant"];
}) {
  const Icon = action.icon;
  const busy = Boolean(action.busy);
  return (
    <Button
      size="sm"
      variant={action.variant ?? fallbackVariant}
      onClick={action.onClick}
      disabled={busy || action.disabled}
      title={action.tooltip}
    >
      {busy ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : Icon ? (
        <Icon className="h-3 w-3" />
      ) : null}
      {busy ? action.busyLabel ?? `${action.label}…` : action.label}
    </Button>
  );
}
