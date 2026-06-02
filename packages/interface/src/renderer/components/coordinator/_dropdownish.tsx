import { useEffect, useRef, useState, type ReactNode } from "react";

/** Minimal click-to-open popover (no portal) for composer menus. Closes on outside click / Escape. */
export function Dropdownish({
  trigger,
  children,
  ariaLabel,
  disabled,
}: {
  trigger: ReactNode;
  children: ReactNode;
  ariaLabel: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-expanded={open}
        className="focus-ring rounded disabled:opacity-50"
        onClick={() => setOpen((v) => !v)}
      >
        {trigger}
      </button>
      {open ? (
        <div className="absolute bottom-full right-0 z-50 mb-1 max-h-64 min-w-[200px] overflow-auto rounded-md border border-border bg-popover p-1 shadow-lg">
          <div onClick={() => setOpen(false)}>{children}</div>
        </div>
      ) : null}
    </div>
  );
}
