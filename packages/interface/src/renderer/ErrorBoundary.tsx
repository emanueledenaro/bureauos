import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Last-resort guard so a render/commit exception degrades to a recoverable
 * error panel instead of unmounting the whole Operating Room to a blank screen.
 *
 * The primary mitigation for the known browser-auto-translate crash (SER-215)
 * is the `translate="no"` / `notranslate` directives in `index.html`; this
 * boundary is defense-in-depth for any other unexpected render error. Styles are
 * inline on purpose so the fallback renders even if the design-system layer is
 * what failed.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Operating Room render error", error, info.componentStack);
  }

  private readonly reload = (): void => {
    window.location.reload();
  };

  private readonly retry = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div
        role="alert"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "0.75rem",
          alignItems: "flex-start",
          maxWidth: "40rem",
          margin: "4rem auto",
          padding: "1.5rem",
          fontFamily: "Inter, system-ui, sans-serif",
          color: "#e5e7eb",
          background: "#111827",
          border: "1px solid #374151",
          borderRadius: "0.75rem",
        }}
      >
        <h1 style={{ fontSize: "1.125rem", fontWeight: 600, margin: 0 }}>
          The Operating Room hit a display error
        </h1>
        <p style={{ margin: 0, color: "#9ca3af", lineHeight: 1.5 }}>
          The view was paused to avoid a blank screen. Your workspace data is safe — the underlying
          action, if any, already completed. Reload to continue.
        </p>
        <pre
          style={{
            margin: 0,
            padding: "0.5rem 0.75rem",
            width: "100%",
            overflowX: "auto",
            fontSize: "0.75rem",
            color: "#fca5a5",
            background: "#0b1220",
            borderRadius: "0.5rem",
          }}
        >
          {error.message}
        </pre>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button
            type="button"
            onClick={this.reload}
            style={{
              padding: "0.5rem 1rem",
              fontWeight: 600,
              color: "#0b1220",
              background: "#e5e7eb",
              border: "none",
              borderRadius: "0.5rem",
              cursor: "pointer",
            }}
          >
            Reload
          </button>
          <button
            type="button"
            onClick={this.retry}
            style={{
              padding: "0.5rem 1rem",
              color: "#e5e7eb",
              background: "transparent",
              border: "1px solid #374151",
              borderRadius: "0.5rem",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }
}
