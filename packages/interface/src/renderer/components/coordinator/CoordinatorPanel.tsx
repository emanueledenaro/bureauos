import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Avatar, AvatarFallback } from "../ui/avatar";
import { Card } from "../ui/card";
import { ActionBanner } from "../dashboard/ActionBanner";
import { StatusPill } from "../dashboard/StatusPill";
import { MessageBubble } from "./MessageBubble";
import { Composer } from "./Composer";
import { buildTodayActions } from "../../lib/builders";
import {
  Api,
  type CoordinatorAttachmentInput,
  type CoordinatorChatResult,
  type CoordinatorChatStreamHandlers,
  type CoordinatorMessageRecord,
} from "../../lib/api";
import type { ChatAttachment, DashboardState } from "../../lib/types";

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
  state,
  onMessage,
  onStreamMessage,
  headerSlot,
}: {
  state: DashboardState;
  onMessage: (
    message: string,
    attachments?: CoordinatorAttachmentInput[],
  ) => Promise<CoordinatorChatResult>;
  onStreamMessage?: (
    message: string,
    attachments: CoordinatorAttachmentInput[] | undefined,
    handlers: CoordinatorChatStreamHandlers,
  ) => Promise<CoordinatorChatResult>;
  /**
   * Optional header control rendered next to the status pills. The coordinator
   * page uses it to surface the context drawer trigger below xl (SER-153).
   */
  headerSlot?: ReactNode;
}) {
  const [messages, setMessages] = useState<CoordinatorMessageRecord[]>([]);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [streamingMessageId, setStreamingMessageId] = useState<string | undefined>();
  const attachmentsRef = useRef<ChatAttachment[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastScrollHeightRef = useRef(0);
  const pendingActions = buildTodayActions(state);
  const activeRuns = state.runs.filter((run) => !["completed", "cancelled"].includes(run.status));
  const suggestedIntents = [
    pendingActions[0] ? `Take over: ${pendingActions[0].title}` : "Decide today's operating focus",
    state.projects.length > 0 ? "Reprioritize delivery work" : "Prepare the operating plan",
    state.clients.length > 0 ? "Review clients and follow-ups" : "Set up the first client",
  ];

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
    const assistantStreamId = `${submittedAt}-coordinator-stream`;
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
      let streamedText = "";
      const result = onStreamMessage
        ? await onStreamMessage(messageText || "Attached files", payload, {
            onDelta: (text) => {
              streamedText += text;
              setStreamingMessageId(assistantStreamId);
              setMessages((current) => {
                const existing = current.some((message) => message.id === assistantStreamId);
                const next = {
                  id: assistantStreamId,
                  role: "coordinator" as const,
                  text: streamedText,
                  created: new Date().toISOString(),
                  meta: { streaming: true },
                };
                return existing
                  ? current.map((message) => (message.id === assistantStreamId ? next : message))
                  : [...current, next];
              });
            },
          })
        : await onMessage(messageText || "Attached files", payload);
      setMessages((current) => [
        ...current.filter(
          (message) => message.id !== optimisticId && message.id !== assistantStreamId,
        ),
        result.ownerMessage,
        result.coordinatorMessage,
      ]);
      setStreamingMessageId(undefined);
      setDraft("");
      setAttachments((current) => {
        current.forEach((item) => {
          if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
        });
        return [];
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStreamingMessageId(undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden border-border/70 bg-card/95">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-surface-subtle/25 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar className="h-9 w-9">
            <AvatarFallback className="bg-surface-raised text-foreground ring-1 ring-border/70">
              SC
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 leading-tight">
            <div className="truncate text-section-title">Supreme Coordinator</div>
            <div className="text-meta mt-0.5 flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse-soft" />
              Company command thread · {messages.length} messages
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusPill
            value={`${state.approvals.length} approvals`}
            tone={state.approvals.length > 0 ? "warning" : "success"}
          />
          <StatusPill
            value={`${activeRuns.length} active runs`}
            tone={activeRuns.length > 0 ? "info" : "success"}
          />
          {headerSlot}
        </div>
      </header>

      <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
        {messages.length === 0 && !busy ? (
          <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center py-10">
            <div className="rounded-lg border border-border/70 bg-surface-subtle/40 p-5">
              <div className="text-eyebrow">Executive channel</div>
              <h2 className="mt-2 text-[20px] font-semibold leading-7 text-foreground">
                Bring decisions, clients, projects, and priorities here.
              </h2>
              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                {suggestedIntents.map((intent) => (
                  <button
                    key={intent}
                    type="button"
                    onClick={() => setDraft(intent)}
                    className="rounded-md border border-border/60 bg-background/35 p-3 text-left text-body-secondary font-medium text-foreground transition-colors hover:border-border hover:bg-surface-raised focus-ring"
                  >
                    {intent}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}

        {busy && !streamingMessageId ? (
          <div className="flex items-start gap-2.5">
            <Avatar className="h-7 w-7">
              <AvatarFallback className="text-[10px]">SC</AvatarFallback>
            </Avatar>
            <div className="flex items-center gap-2 rounded-lg border-l-2 border-primary/55 bg-transparent px-3 py-2 text-body text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Reading company context...
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
        placeholder="Message a decision, client, project, or priority..."
      />
    </Card>
  );
}
