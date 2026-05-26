import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Avatar, AvatarFallback } from "../ui/avatar";
import { Card } from "../ui/card";
import { EmptyState } from "../dashboard/EmptyState";
import { ActionBanner } from "../dashboard/ActionBanner";
import { MessageBubble } from "./MessageBubble";
import { Composer } from "./Composer";
import {
  Api,
  type CoordinatorAttachmentInput,
  type CoordinatorChatResult,
  type CoordinatorMessageRecord,
} from "../../lib/api";
import type { ChatAttachment } from "../../lib/types";

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

function isTextAttachment(file: File): boolean {
  return (
    file.type.startsWith("text/") ||
    ["application/json", "application/xml", "application/javascript"].includes(file.type) ||
    /\.(csv|json|md|txt|log|xml|yaml|yml)$/i.test(file.name)
  );
}

function readFileAs(file: File, as: "text" | "dataUrl"): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read attachment"));
    if (as === "text") reader.readAsText(file);
    else reader.readAsDataURL(file);
  });
}

async function toCoordinatorAttachment(file: File): Promise<CoordinatorAttachmentInput> {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`${file.name} is larger than 10 MB`);
  }
  const base = { name: file.name, type: file.type || "application/octet-stream", size: file.size };
  if (isTextAttachment(file)) return { ...base, text: await readFileAs(file, "text") };
  return { ...base, dataUrl: await readFileAs(file, "dataUrl") };
}

/**
 * Pannello chat del Supreme Coordinator. Orchestrator snello: delega header,
 * thread, composer ai sotto-componenti. Gestisce solo state della
 * conversazione + scroll automatico verso il fondo quando arrivano messaggi.
 */
export function CoordinatorPanel({
  onMessage,
}: {
  onMessage: (
    message: string,
    attachments?: CoordinatorAttachmentInput[],
  ) => Promise<CoordinatorChatResult>;
}) {
  const [messages, setMessages] = useState<CoordinatorMessageRecord[]>([]);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const attachmentsRef = useRef<ChatAttachment[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastScrollHeightRef = useRef(0);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  // Carica la cronologia all'apertura.
  useEffect(() => {
    let cancelled = false;
    Api.coordinatorMessages(50)
      .then((history) => {
        if (!cancelled) setMessages((current) => (current.length > 0 ? current : history));
      })
      .catch(() => {
        // Banner globale di errore API gestito in App.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Cleanup degli object-url al unmount.
  useEffect(() => {
    return () => {
      attachmentsRef.current.forEach((item) => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
    };
  }, []);

  // Scroll automatico ai nuovi messaggi (basato su scrollHeight, non su deps fragili).
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom =
      lastScrollHeightRef.current === 0 ||
      el.scrollTop + el.clientHeight >= lastScrollHeightRef.current - 80;
    if (nearBottom) el.scrollTop = el.scrollHeight;
    lastScrollHeightRef.current = el.scrollHeight;
  }, [messages.length, busy]);

  const addFiles = (files: FileList | null): void => {
    if (!files || files.length === 0) return;
    const added: ChatAttachment[] = Array.from(files).map((file, index) => ({
      id: `${Date.now()}-${index}-${file.name}`,
      name: file.name,
      type: file.type || "application/octet-stream",
      size: file.size,
      file,
      ...(file.type.startsWith("image/") ? { previewUrl: URL.createObjectURL(file) } : {}),
    }));
    setAttachments((current) => [...current, ...added]);
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
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-3">
          <Avatar className="h-9 w-9">
            <AvatarFallback className="bg-gradient-to-br from-primary/40 to-info/40 text-foreground">
              SC
            </AvatarFallback>
          </Avatar>
          <div className="leading-tight">
            <div className="text-section-title">Supreme Coordinator</div>
            <div className="text-meta mt-0.5 flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse-soft" />
              Online · {messages.length} messages
            </div>
          </div>
        </div>
      </header>

      <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
        {messages.length === 0 && !busy ? (
          <EmptyState
            title="No coordinator thread yet"
            description="The first owner message will create durable client, project, opportunity, artifact, and approval records."
          />
        ) : null}

        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}

        {busy ? (
          <div className="flex items-start gap-2.5">
            <Avatar className="h-7 w-7">
              <AvatarFallback className="text-[10px]">SC</AvatarFallback>
            </Avatar>
            <div className="flex items-center gap-2 rounded-2xl rounded-tl-sm border border-border bg-surface-raised px-3 py-2 text-body text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Coordinator thinking…
            </div>
          </div>
        ) : null}

        {error ? (
          <ActionBanner
            tone="danger"
            title="Coordinator request failed"
            detail={error}
            onDismiss={() => setError(undefined)}
          />
        ) : null}
      </div>

      <Composer
        value={draft}
        onChange={setDraft}
        attachments={attachments}
        onAddFiles={addFiles}
        onRemoveAttachment={removeAttachment}
        onSubmit={() => void submit()}
        busy={busy}
      />
    </Card>
  );
}
