import type { ReactNode } from "react";

function inlineParts(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) parts.push(text.slice(cursor, match.index));
    const token = match[0];
    if (token.startsWith("`")) {
      parts.push(
        <code
          key={`${match.index}-code`}
          className="rounded bg-surface-subtle px-1 py-0.5 font-mono text-[0.92em]"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else {
      parts.push(
        <strong key={`${match.index}-strong`} className="font-semibold text-foreground">
          {token.slice(2, -2)}
        </strong>,
      );
    }
    cursor = match.index + token.length;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts;
}

function paragraph(lines: string[], key: string): ReactNode {
  return (
    <p key={key} className="whitespace-pre-wrap">
      {lines.map((line, index) => (
        <span key={`${key}-${index}`}>
          {index > 0 ? <br /> : null}
          {inlineParts(line)}
        </span>
      ))}
    </p>
  );
}

function heading(line: string, key: string): ReactNode {
  const match = /^(#{1,6})\s+(.+)$/.exec(line);
  const level = match?.[1]?.length ?? 3;
  const body = match?.[2] ?? line;
  return (
    <div
      key={key}
      className={level <= 2 ? "font-semibold text-foreground" : "font-medium text-foreground"}
    >
      {inlineParts(body)}
    </div>
  );
}

function list(lines: string[], kind: "ordered" | "unordered", key: string): ReactNode {
  const className = kind === "ordered" ? "list-decimal space-y-1 pl-5" : "list-disc space-y-1 pl-5";
  const children = lines.map((line, index) => (
    <li key={`${key}-${index}`}>{inlineParts(line.replace(/^([-*]|\d+\.)\s+/, ""))}</li>
  ));
  return kind === "ordered" ? (
    <ol key={key} className={className}>
      {children}
    </ol>
  ) : (
    <ul key={key} className={className}>
      {children}
    </ul>
  );
}

function textBlocks(text: string, keyPrefix: string): ReactNode[] {
  const blocks: ReactNode[] = [];
  let paragraphLines: string[] = [];
  let listLines: string[] = [];
  let listKind: "ordered" | "unordered" = "unordered";

  const flushParagraph = () => {
    if (!paragraphLines.length) return;
    blocks.push(paragraph(paragraphLines, `${keyPrefix}-p-${blocks.length}`));
    paragraphLines = [];
  };
  const flushList = () => {
    if (!listLines.length) return;
    blocks.push(list(listLines, listKind, `${keyPrefix}-l-${blocks.length}`));
    listLines = [];
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    if (/^#{1,6}\s+/.test(line.trimStart())) {
      flushParagraph();
      flushList();
      blocks.push(heading(line.trimStart(), `${keyPrefix}-h-${blocks.length}`));
      continue;
    }
    if (/^([-*]|\d+\.)\s+/.test(line.trimStart())) {
      const nextKind = /^\d+\.\s+/.test(line.trimStart()) ? "ordered" : "unordered";
      flushParagraph();
      if (listLines.length && nextKind !== listKind) flushList();
      listLines.push(line.trimStart());
      listKind = nextKind;
      continue;
    }
    flushList();
    paragraphLines.push(line);
  }
  flushParagraph();
  flushList();
  return blocks;
}

export function MessageContent({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const fence = /```([^\n`]*)\n([\s\S]*?)```/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(text)) !== null) {
    const before = text.slice(cursor, match.index);
    if (before.trim()) blocks.push(...textBlocks(before, `t-${blocks.length}`));
    const language = match[1]?.trim();
    const code = match[2]?.replace(/\n$/, "") ?? "";
    blocks.push(
      <pre
        key={`code-${match.index}`}
        className="overflow-x-auto rounded-md border border-border bg-surface-subtle p-3 text-[12px] leading-5"
      >
        <code className="font-mono">
          {language ? <span className="mb-2 block text-muted-foreground">{language}</span> : null}
          {code}
        </code>
      </pre>,
    );
    cursor = match.index + match[0].length;
  }
  const rest = text.slice(cursor);
  if (rest.trim()) blocks.push(...textBlocks(rest, `t-${blocks.length}`));

  return <div className="space-y-2 break-words">{blocks}</div>;
}
