import { isValidElement, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import { nodeText } from "../../lib/code-text";
import { useT } from "../../i18n/i18n";

/**
 * Chrome around a fenced code block produced by react-markdown + rehype-highlight.
 * `children` is the highlighted <code class="hljs language-x"> element; we render it
 * untouched inside a header bar with the language label and a Copy button.
 */
export function CodeBlock({ children }: { children?: ReactNode }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout>>();
  const codeClass = isValidElement(children)
    ? String((children.props as { className?: string }).className ?? "")
    : "";
  const language = /language-(\w+)/.exec(codeClass)?.[1];
  const source = nodeText(children).replace(/\n$/, "");

  useEffect(() => () => clearTimeout(resetTimer.current), []);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
      clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be unavailable (permissions) — fail silently.
    }
  };

  return (
    <div className="my-2 overflow-hidden rounded-md border border-border/70 bg-surface-subtle">
      <div className="flex items-center justify-between border-b border-border/50 px-3 py-1.5">
        <span className="text-meta font-mono">{language ?? t("code.plain", "code")}</span>
        <button
          type="button"
          onClick={() => void copy()}
          className="text-meta focus-ring inline-flex items-center gap-1 rounded px-1 hover:text-foreground"
          aria-label={copied ? t("code.copied", "Copied") : t("code.copy", "Copy")}
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? t("code.copied", "Copied") : t("code.copy", "Copy")}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-[12px] leading-5">{children}</pre>
    </div>
  );
}
