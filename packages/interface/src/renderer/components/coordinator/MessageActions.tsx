import { useEffect, useRef, useState } from "react";
import { Check, Copy, Pencil, RefreshCw, ThumbsDown, ThumbsUp } from "lucide-react";
import { cn } from "../../lib/utils";
import { useT } from "../../i18n/i18n";

export interface MessageActionsProps {
  text: string;
  onRegenerate?: () => void;
  onEdit?: () => void;
  variant: "owner" | "coordinator";
}

export function MessageActions({ text, onRegenerate, onEdit, variant }: MessageActionsProps) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<"up" | "down" | undefined>();
  const resetTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(resetTimer.current), []);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  const iconBtn =
    "focus-ring inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-surface-subtle hover:text-foreground";

  if (variant === "owner") {
    if (!onEdit) return null;
    return (
      <div className="mt-1 flex items-center gap-1">
        <button type="button" className={iconBtn} onClick={onEdit} aria-label={t("messageActions.edit", "Edit")}>
          <Pencil className="h-3 w-3" />
        </button>
      </div>
    );
  }

  return (
    <div className="mt-1 flex items-center gap-1">
      <button type="button" className={iconBtn} onClick={() => void copy()} aria-label={t("messageActions.copy", "Copy")}>
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      </button>
      {onRegenerate ? (
        <button type="button" className={iconBtn} onClick={onRegenerate} aria-label={t("messageActions.regenerate", "Regenerate")}>
          <RefreshCw className="h-3 w-3" />
        </button>
      ) : null}
      <button
        type="button"
        className={cn(iconBtn, feedback === "up" && "text-success")}
        onClick={() => setFeedback((f) => (f === "up" ? undefined : "up"))}
        aria-label={t("messageActions.helpful", "Helpful")}
        aria-pressed={feedback === "up"}
      >
        <ThumbsUp className="h-3 w-3" />
      </button>
      <button
        type="button"
        className={cn(iconBtn, feedback === "down" && "text-danger")}
        onClick={() => setFeedback((f) => (f === "down" ? undefined : "down"))}
        aria-label={t("messageActions.notHelpful", "Not helpful")}
        aria-pressed={feedback === "down"}
      >
        <ThumbsDown className="h-3 w-3" />
      </button>
    </div>
  );
}
