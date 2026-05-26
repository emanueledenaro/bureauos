import { useRef, type FormEvent, type KeyboardEvent } from "react";
import { Loader2, Paperclip, Send } from "lucide-react";
import { Button } from "../ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { AttachmentChip } from "./AttachmentChip";
import { useAutosizeTextarea } from "../../hooks/useAutosizeTextarea";
import type { ChatAttachment } from "../../lib/types";
import { cn } from "../../lib/utils";

/**
 * Composer della chat del coordinator. Textarea auto-espandente (1-12 righe),
 * attachment row con tooltip e remove, hint ⌘+↵ sul tooltip del Send.
 * Submit con onSubmit (Form) o Cmd/Ctrl+Enter.
 */
export function Composer({
  value,
  onChange,
  attachments,
  onAddFiles,
  onRemoveAttachment,
  onSubmit,
  busy = false,
  placeholder = "Message BureauOS…",
}: {
  value: string;
  onChange: (next: string) => void;
  attachments: ChatAttachment[];
  onAddFiles: (files: FileList | null) => void;
  onRemoveAttachment: (id: string) => void;
  onSubmit: () => void;
  busy?: boolean;
  placeholder?: string;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useAutosizeTextarea(textareaRef, value, { minRows: 1, maxRows: 12 });

  const canSend = !busy && (value.trim().length > 0 || attachments.length > 0);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      if (canSend) onSubmit();
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (canSend) onSubmit();
  };

  return (
    <form onSubmit={handleSubmit} className="border-t border-border bg-surface-subtle/40 p-3">
      {attachments.length > 0 ? (
        <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
          {attachments.map((attachment) => (
            <AttachmentChip
              key={attachment.id}
              name={attachment.name}
              size={attachment.size}
              previewUrl={attachment.previewUrl}
              onRemove={() => onRemoveAttachment(attachment.id)}
            />
          ))}
        </div>
      ) : null}

      <div
        className={cn(
          "flex flex-col rounded-lg border border-border bg-surface-raised transition-colors",
          "focus-within:border-ring focus-within:ring-1 focus-within:ring-ring/30",
        )}
      >
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={1}
          className="w-full resize-none bg-transparent px-3 py-2.5 text-body-lg leading-[20px] text-foreground placeholder:text-muted-foreground/70 focus-visible:outline-none"
        />
        <div className="flex items-center justify-between gap-2 border-t border-border/50 px-2 py-1.5">
          <div className="flex items-center gap-1">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,.pdf,.txt,.md,.csv,.json,.doc,.docx"
              className="hidden"
              onChange={(event) => {
                onAddFiles(event.target.files);
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  aria-label="Attach files"
                >
                  <Paperclip className="h-3.5 w-3.5" />
                  Attach
                </Button>
              </TooltipTrigger>
              <TooltipContent>Images, PDF, docs (≤ 10 MB)</TooltipContent>
            </Tooltip>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button type="submit" size="sm" disabled={!canSend}>
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                {busy ? "Sending" : "Send"}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Send · ⌘ + ↵</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </form>
  );
}
