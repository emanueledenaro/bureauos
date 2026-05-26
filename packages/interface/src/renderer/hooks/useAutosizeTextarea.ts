import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

/**
 * Auto-resize per <textarea> tra `minRows` e `maxRows` linee. Oltre `maxRows`
 * il browser mostra scroll interno. Usa la line-height computata e
 * un ResizeObserver per restare sincronizzato con cambi di font o di larghezza.
 */
export function useAutosizeTextarea(
  ref: React.RefObject<HTMLTextAreaElement>,
  value: string,
  options: { minRows?: number; maxRows?: number } = {},
): void {
  const { minRows = 1, maxRows = 12 } = options;
  const frame = useRef<number>();

  const resize = useCallback((): void => {
    const el = ref.current;
    if (!el) return;
    const style = window.getComputedStyle(el);
    const lineHeight = parseFloat(style.lineHeight) || 18;
    const paddingTop = parseFloat(style.paddingTop) || 0;
    const paddingBottom = parseFloat(style.paddingBottom) || 0;
    const borderTop = parseFloat(style.borderTopWidth) || 0;
    const borderBottom = parseFloat(style.borderBottomWidth) || 0;
    const verticalChrome = paddingTop + paddingBottom + borderTop + borderBottom;
    const min = lineHeight * minRows + verticalChrome;
    const max = lineHeight * maxRows + verticalChrome;

    el.style.height = "auto";
    const next = Math.max(min, Math.min(max, el.scrollHeight));
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }, [maxRows, minRows, ref]);

  useLayoutEffect(() => {
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(resize);
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, [resize, value]);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => resize());
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, resize]);
}
