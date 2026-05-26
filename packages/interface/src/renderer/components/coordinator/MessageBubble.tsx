import { FileText } from "lucide-react";
import { Avatar, AvatarFallback } from "../ui/avatar";
import { ResultCard } from "./ResultCard";
import { MessageContent } from "./MessageContent";
import { cn } from "../../lib/utils";
import { formatBytes, formatTime } from "../../lib/format";
import type { CoordinatorMessageRecord } from "../../lib/api";

/**
 * Singolo messaggio della chat. Owner = bubble primary a destra, Coordinator
 * = bubble secondary a sinistra con avatar. La bubble respira (max-w-prose),
 * il timestamp è sopra alla bubble per non sporcare la lettura.
 */
export function MessageBubble({ message }: { message: CoordinatorMessageRecord }) {
  const isOwner = message.role === "owner";
  return (
    <div className={cn("flex w-full gap-2.5", isOwner ? "justify-end" : "justify-start")}>
      {!isOwner ? (
        <Avatar className="mt-5 h-7 w-7">
          <AvatarFallback className="bg-gradient-to-br from-primary/40 to-info/40 text-foreground text-[10px]">
            SC
          </AvatarFallback>
        </Avatar>
      ) : null}
      <div
        className={cn(
          "flex min-w-0 max-w-full flex-col gap-1",
          isOwner ? "items-end" : "items-start",
        )}
      >
        <div className="text-eyebrow flex items-center gap-2 normal-case tracking-normal font-normal text-muted-foreground">
          <span className="font-medium text-foreground/80">
            {isOwner ? "You" : "Supreme Coordinator"}
          </span>
          <span aria-hidden>·</span>
          <span>{formatTime(new Date(message.created))}</span>
        </div>
        <div
          className={cn(
            "max-w-prose rounded-2xl px-3.5 py-2.5 text-body-lg leading-[20px]",
            isOwner
              ? "rounded-br-sm bg-primary text-primary-foreground"
              : "rounded-tl-sm border border-border bg-surface-raised text-foreground",
          )}
        >
          {isOwner ? (
            <div className="whitespace-pre-wrap break-words">{message.text}</div>
          ) : (
            <MessageContent text={message.text} />
          )}
          {message.attachments?.length ? (
            <div
              className={cn(
                "mt-2 space-y-1 border-t pt-2",
                isOwner ? "border-primary-foreground/20" : "border-border/60",
              )}
            >
              {message.attachments.map((attachment) => (
                <div key={attachment.name} className="text-meta flex items-center gap-1.5">
                  <FileText className="h-3 w-3 shrink-0" />
                  <span className="truncate">{attachment.name}</span>
                  <span className="text-muted-foreground/70">{formatBytes(attachment.size)}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
        {message.result ? <ResultCard result={message.result} /> : null}
      </div>
    </div>
  );
}
