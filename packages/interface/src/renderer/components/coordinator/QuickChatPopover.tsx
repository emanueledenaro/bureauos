import { useEffect, useRef, useState } from "react";
import { Loader2, MessageSquare, Send, X } from "lucide-react";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { useAutosizeTextarea } from "../../hooks/useAutosizeTextarea";
import type { CoordinatorAttachmentInput, CoordinatorChatResult } from "../../lib/api";

/**
 * Popover compatto per intake veloce dal contesto di una qualsiasi vista
 * (es. "create opportunity for Acme") senza dover navigare alla pagina
 * coordinator. Scorciatoia ⌘+K. Niente storia, niente attachment, una sola
 * textarea + invio. Per dialoghi seri rimanda alla pagina coordinator.
 */
export function QuickChatPopover({
  open,
  onOpenChange,
  onSubmit,
  onOpenFullCoordinator,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (
    message: string,
    attachments?: CoordinatorAttachmentInput[],
  ) => Promise<CoordinatorChatResult>;
  onOpenFullCoordinator: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [lastReply, setLastReply] = useState<string | undefined>();
  useAutosizeTextarea(textareaRef, draft, { minRows: 2, maxRows: 8 });

  // Reset stato quando si apre/chiude.
  useEffect(() => {
    if (!open) {
      setDraft("");
      setError(undefined);
      setLastReply(undefined);
      setBusy(false);
    } else {
      setTimeout(() => textareaRef.current?.focus(), 80);
    }
  }, [open]);

  const send = async (): Promise<void> => {
    if (!draft.trim() || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await onSubmit(draft.trim());
      setLastReply(result.coordinatorMessage.text);
      setDraft("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl gap-0 p-0">
        <DialogTitle className="sr-only">Quick chat with coordinator</DialogTitle>
        <DialogDescription className="sr-only">
          Send a short message to the Supreme Coordinator without leaving the current view.
        </DialogDescription>
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
            <div>
              <div className="text-section-title">Quick chat</div>
              <div className="text-meta">
                Quick intake for fast asks · open full coordinator for long conversations.
              </div>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onOpenChange(false)}
            aria-label="Close"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="flex flex-col gap-3 p-4">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void send();
              }
              if (event.key === "Escape") onOpenChange(false);
            }}
            placeholder="Ask the coordinator…"
            rows={2}
            className="w-full resize-none rounded-md border border-border/70 bg-background/45 px-3 py-2.5 text-body-lg text-foreground placeholder:text-muted-foreground/70 focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring/30"
          />
          {error ? (
            <div className="rounded-md border border-danger/40 bg-danger-subtle/40 px-3 py-2 text-meta text-danger">
              {error}
            </div>
          ) : null}
          {lastReply ? (
            <div className="rounded-md border border-success/40 bg-success-subtle/30 px-3 py-2 text-body-secondary text-foreground">
              <div className="text-eyebrow mb-1 text-success">Coordinator reply</div>
              <div className="line-clamp-3 leading-relaxed">{lastReply}</div>
            </div>
          ) : null}
          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onOpenChange(false);
                onOpenFullCoordinator();
              }}
            >
              Open full coordinator
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="sm" onClick={() => void send()} disabled={busy || !draft.trim()}>
                  {busy ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Send className="h-3 w-3" />
                  )}
                  {busy ? "Sending" : "Send"}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Send · ⌘ + ↵</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
