import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, FileText, Loader2, MoreHorizontal, Paperclip, Send, X } from "lucide-react";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Avatar, AvatarFallback } from "../ui/avatar";
import { Textarea } from "../ui/textarea";
import { EmptyState } from "../dashboard/EmptyState";
import { cn } from "../../lib/utils";
import { formatBytes, formatTime } from "../../lib/format";
import { Api, type CoordinatorAttachmentInput, type CoordinatorChatResult, type CoordinatorMessageRecord } from "../../lib/api";
import type { ChatAttachment } from "../../lib/types";

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

function isTextAttachment(file: File): boolean {
  return (
    file.type.startsWith("text/") ||
    ["application/json", "application/xml", "application/javascript"].includes(file.type) ||
    /\.(csv|json|md|txt|log|xml|yaml|yml)$/i.test(file.name)
  );
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read attachment"));
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read attachment"));
    reader.readAsText(file);
  });
}

async function toCoordinatorAttachment(file: File): Promise<CoordinatorAttachmentInput> {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`${file.name} is larger than 10 MB`);
  }
  const base = {
    name: file.name,
    type: file.type || "application/octet-stream",
    size: file.size,
  };
  if (isTextAttachment(file)) {
    return { ...base, text: await readFileAsText(file) };
  }
  return { ...base, dataUrl: await readFileAsDataUrl(file) };
}

export function CoordinatorPanel({
  onMessage,
}: {
  onMessage: (
    message: string,
    attachments?: CoordinatorAttachmentInput[],
  ) => Promise<CoordinatorChatResult>;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const attachmentsRef = useRef<ChatAttachment[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<CoordinatorMessageRecord[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  useEffect(() => {
    let cancelled = false;
    Api.coordinatorMessages(50)
      .then((history) => {
        if (cancelled) return;
        setMessages((current) => (current.length > 0 ? current : history));
      })
      .catch(() => {
        /* dashboard-level banner */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => () => {
    attachmentsRef.current.forEach((item) => {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    });
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, busy]);

  const addFiles = (files: FileList | null): void => {
    if (!files) return;
    const added = Array.from(files).map((file, index) => ({
      id: `${Date.now()}-${index}-${file.name}`,
      name: file.name,
      type: file.type || "application/octet-stream",
      size: file.size,
      file,
      ...(file.type.startsWith("image/") ? { previewUrl: URL.createObjectURL(file) } : {}),
    }));
    setAttachments((current) => [...current, ...added]);
    if (fileInput.current) fileInput.current.value = "";
  };

  const removeAttachment = (id: string): void => {
    setAttachments((current) => {
      const item = current.find((entry) => entry.id === id);
      if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
      return current.filter((entry) => entry.id !== id);
    });
  };

  const submit = async (): Promise<void> => {
    if (busy || (!draft.trim() && attachments.length === 0)) return;
    setBusy(true);
    setError(undefined);
    const submittedAt = new Date().toISOString();
    const messageText = draft.trim();
    const attachmentMeta = attachments.map((item) => ({
      name: item.name,
      size: item.size,
      type: item.type,
    }));
    const optimisticId = `${submittedAt}-owner`;
    setMessages((current) => [
      ...current,
      {
        id: optimisticId,
        role: "owner",
        text: messageText || "Attached files",
        created: submittedAt,
        attachments: attachmentMeta,
      },
    ]);
    try {
      const payload = await Promise.all(
        attachments.map((attachment) => toCoordinatorAttachment(attachment.file)),
      );
      const result = await onMessage(messageText || "Attached files", payload);
      setMessages((current) => [
        ...current.filter((message) => message.id !== optimisticId),
        result.ownerMessage,
        result.coordinatorMessage,
      ]);
      setDraft("");
      setAttachments((current) => {
        current.forEach((item) => {
          if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
        });
        return [];
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const groupedMessages = useMemo(() => messages, [messages]);

  return (
    <Card className="flex h-full min-h-[460px] flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border/60 px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="bg-gradient-to-br from-primary/40 to-info/40 text-foreground">
              SC
            </AvatarFallback>
          </Avatar>
          <div className="leading-tight">
            <div className="text-[13px] font-semibold text-foreground">Supreme Coordinator</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse-soft" />
              Online
            </div>
          </div>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="More">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </div>

      <div
        ref={scrollRef}
        className="relative flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-4"
      >
        {groupedMessages.length === 0 && !busy ? (
          <EmptyState
            title="No coordinator thread yet"
            description="The first owner message will create durable client, project, opportunity, artifact, and approval records."
          />
        ) : null}

        {groupedMessages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}

        {busy ? (
          <div className="flex items-start gap-2.5">
            <Avatar className="h-7 w-7">
              <AvatarFallback className="text-[9px]">SC</AvatarFallback>
            </Avatar>
            <div className="flex items-center gap-2 rounded-2xl rounded-tl-sm border border-border/60 bg-surface-subtle px-3 py-2 text-[11px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Coordinator thinking…
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="rounded-md border border-danger/40 bg-danger-subtle/40 px-3 py-2 text-[11px] text-danger">
            {error}
          </div>
        ) : null}
      </div>

      <div className="border-t border-border/60 bg-surface-subtle/40 p-3">
        {attachments.length > 0 ? (
          <div className="mb-2 flex gap-2 overflow-x-auto no-scrollbar">
            {attachments.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-2 rounded-lg border border-border/70 bg-surface-raised p-2"
              >
                {item.previewUrl ? (
                  <img src={item.previewUrl} alt="" className="h-9 w-9 rounded object-cover" />
                ) : (
                  <span className="grid h-9 w-9 place-items-center rounded bg-surface-subtle text-muted-foreground">
                    <FileText className="h-4 w-4" />
                  </span>
                )}
                <div className="min-w-0 max-w-[140px]">
                  <div className="truncate text-[11px] font-medium text-foreground">
                    {item.name}
                  </div>
                  <div className="text-[9px] text-muted-foreground">{formatBytes(item.size)}</div>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => removeAttachment(item.id)}
                  aria-label="Remove attachment"
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        ) : null}

        <div className="relative rounded-lg border border-border/70 bg-surface-raised focus-within:border-ring/60 focus-within:ring-1 focus-within:ring-ring/30">
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Message BureauOS…"
            className="min-h-16 resize-none border-0 bg-transparent focus-visible:ring-0 focus-visible:border-0"
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void submit();
              }
            }}
          />
          <div className="flex items-center justify-between border-t border-border/50 px-2 py-1.5">
            <div className="flex items-center gap-1">
              <input
                ref={fileInput}
                type="file"
                multiple
                accept="image/*,.pdf,.txt,.md,.csv,.json,.doc,.docx"
                className="hidden"
                onChange={(event) => addFiles(event.target.files)}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => fileInput.current?.click()}
                aria-label="Attach files"
              >
                <Paperclip className="h-3.5 w-3.5" />
                Attach
              </Button>
              <span className="text-[10px] text-muted-foreground/80">⌘ + ↵ to send</span>
            </div>
            <Button
              size="sm"
              onClick={() => void submit()}
              disabled={busy || (!draft.trim() && attachments.length === 0)}
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
              {busy ? "Sending" : "Send"}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

function MessageBubble({ message }: { message: CoordinatorMessageRecord }) {
  const isOwner = message.role === "owner";
  return (
    <div className={cn("flex gap-2.5", isOwner ? "justify-end" : "justify-start")}>
      {!isOwner ? (
        <Avatar className="h-7 w-7">
          <AvatarFallback className="bg-gradient-to-br from-primary/40 to-info/40 text-foreground text-[9px]">
            SC
          </AvatarFallback>
        </Avatar>
      ) : null}
      <div className={cn("flex max-w-[78%] flex-col gap-1", isOwner ? "items-end" : "items-start")}>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <span>{isOwner ? "You" : "Supreme Coordinator"}</span>
          <span>·</span>
          <span>{formatTime(new Date(message.created))}</span>
        </div>
        <div
          className={cn(
            "rounded-2xl px-3 py-2 text-[12px] leading-relaxed",
            isOwner
              ? "rounded-br-sm bg-primary text-primary-foreground"
              : "rounded-tl-sm border border-border/70 bg-surface-raised text-foreground",
          )}
        >
          <div className="whitespace-pre-wrap">{message.text}</div>
          {message.attachments?.length ? (
            <div className="mt-2 space-y-1 border-t border-white/10 pt-2 text-[10px] opacity-80">
              {message.attachments.map((item) => (
                <div key={item.name} className="flex items-center gap-1.5">
                  <FileText className="h-3 w-3" />
                  <span className="truncate">{item.name}</span>
                  <span className="text-muted-foreground/70">{formatBytes(item.size)}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
        {message.result ? (
          <div className="w-full max-w-sm rounded-xl border border-border/70 bg-surface-subtle p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-[10px] font-mono uppercase text-muted-foreground">
                  {message.result.opportunity.id}
                </div>
                <div className="mt-1 truncate text-[12px] font-semibold text-foreground">
                  {message.result.project.name}
                </div>
              </div>
              <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-[10px] text-muted-foreground">
              <Stat label="Client" value={message.result.client.name} />
              <Stat label="Artifacts" value={`${message.result.artifacts.length}`} />
              <Stat label="Approvals" value={`${message.result.approvals.length}`} />
            </div>
            {message.result.next_actions.length > 0 ? (
              <div className="mt-2 rounded-md border border-border/60 bg-surface-raised p-2 text-[11px] text-foreground">
                {message.result.next_actions[0]}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[9px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 truncate text-[11px] font-medium text-foreground">{value}</div>
    </div>
  );
}
