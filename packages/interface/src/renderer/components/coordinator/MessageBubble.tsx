import { FileText } from "lucide-react";
import { Avatar, AvatarFallback } from "../ui/avatar";
import { DelegationCard } from "./DelegationCard";
import { MessageActions } from "./MessageActions";
import { MessageContent } from "./MessageContent";
import { cn } from "../../lib/utils";
import { formatBytes, formatTime } from "../../lib/format";
import { useT } from "../../i18n/i18n";
import type { CoordinatorMessageRecord } from "../../lib/api";

/**
 * Singolo messaggio della chat. Owner compatto a destra, Coordinator più
 * simile a un executive note: avatar, metadati, contenuto leggibile e poco boxy.
 */
export function MessageBubble({
  message,
  onRegenerate,
  onEdit,
}: {
  message: CoordinatorMessageRecord;
  onRegenerate?: () => void;
  onEdit?: () => void;
}) {
  const t = useT();
  const isOwner = message.role === "owner";
  return (
    <div className={cn("flex w-full gap-2.5", isOwner ? "justify-end" : "justify-start")}>
      {!isOwner ? (
        <Avatar className="mt-5 h-7 w-7">
          <AvatarFallback className="bg-surface-raised text-foreground text-[10px] ring-1 ring-border/70">
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
            {isOwner
              ? t("messageBubble.you", "You")
              : t("messageBubble.supremeCoordinator", "Supreme Coordinator")}
          </span>
          <span aria-hidden>·</span>
          <span>{formatTime(new Date(message.created))}</span>
        </div>
        <div
          className={cn(
            "max-w-[min(760px,100%)] px-3.5 py-2.5 text-body-lg leading-[20px]",
            isOwner
              ? "rounded-lg bg-primary text-primary-foreground shadow-[0_8px_22px_-18px_hsl(var(--primary)/0.7)]"
              : "border-l-2 border-primary/55 bg-transparent pl-3 text-foreground",
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
        {!message.meta?.streaming ? (
          <MessageActions
            text={message.text}
            variant={isOwner ? "owner" : "coordinator"}
            {...(isOwner ? { onEdit } : { onRegenerate })}
          />
        ) : null}
        {message.result ? <DelegationCard result={message.result} /> : null}
      </div>
    </div>
  );
}
