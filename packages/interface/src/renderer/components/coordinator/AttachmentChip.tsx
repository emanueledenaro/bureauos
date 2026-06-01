import { FileText, X } from "lucide-react";
import { Button } from "../ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { formatBytes } from "../../lib/format";
import { useT } from "../../i18n/i18n";

/**
 * Chip per un attachment in composer o messaggio. Tooltip sul nome completo,
 * immagine preview o fallback icona, dimensione in text-meta.
 */
export function AttachmentChip({
  name,
  size,
  previewUrl,
  onRemove,
}: {
  name: string;
  size: number;
  previewUrl?: string;
  onRemove?: () => void;
}) {
  const t = useT();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex min-w-0 max-w-[260px] items-center gap-2 rounded-md border border-border/70 bg-background/45 p-2">
          {previewUrl ? (
            <img src={previewUrl} alt="" className="h-10 w-10 shrink-0 rounded object-cover" />
          ) : (
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded bg-surface-subtle text-muted-foreground">
              <FileText className="h-4 w-4" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-body-secondary truncate font-medium text-foreground">{name}</div>
            <div className="text-meta">{formatBytes(size)}</div>
          </div>
          {onRemove ? (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onRemove}
              aria-label={`${t("attachmentChip.remove", "Remove")} ${name}`}
              className="shrink-0"
            >
              <X className="h-3 w-3" />
            </Button>
          ) : null}
        </div>
      </TooltipTrigger>
      <TooltipContent>
        <div className="font-medium">{name}</div>
        <div className="text-meta">{formatBytes(size)}</div>
      </TooltipContent>
    </Tooltip>
  );
}
