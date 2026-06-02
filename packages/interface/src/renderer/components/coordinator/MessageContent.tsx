import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { CodeBlock } from "./CodeBlock";
import "./code-highlight.css";

/**
 * Renders coordinator markdown with GFM (tables, task lists), syntax-highlighted code
 * blocks, and BureauOS-toned typography. Raw HTML stays disabled (no rehype-raw) so model
 * output cannot inject markup. Public API unchanged: <MessageContent text={...} />.
 */
export function MessageContent({ text }: { text: string }) {
  return (
    <div className="bos-markdown space-y-2 break-words text-body leading-[1.6]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="text-primary underline underline-offset-2"
            >
              {children}
            </a>
          ),
          h1: ({ children }) => <div className="text-section-title mt-1">{children}</div>,
          h2: ({ children }) => <div className="text-section-title mt-1">{children}</div>,
          h3: ({ children }) => <div className="text-card-title mt-1">{children}</div>,
          h4: ({ children }) => <div className="text-card-title mt-1">{children}</div>,
          h5: ({ children }) => <div className="text-card-title mt-1">{children}</div>,
          h6: ({ children }) => <div className="text-card-title mt-1">{children}</div>,
          img: ({ src, alt }) => (
            <a
              href={typeof src === "string" ? src : undefined}
              target="_blank"
              rel="noreferrer"
              className="text-primary underline underline-offset-2"
            >
              {alt || (typeof src === "string" ? src : "image")}
            </a>
          ),
          ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-border pl-3 text-muted-foreground">
              {children}
            </blockquote>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="text-body-secondary w-full text-left">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border-b border-border px-2 py-1 font-semibold">{children}</th>
          ),
          td: ({ children }) => (
            <td className="border-b border-border/50 px-2 py-1 align-top">{children}</td>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
