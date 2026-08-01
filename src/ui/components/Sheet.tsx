// Bottom sheet / modal. Renders nothing when closed; while open it traps
// focus, closes on backdrop tap (onPointerUp — see Row.tsx) and Escape, and
// restores focus to whatever opened it when it closes.
import type { ComponentChildren } from "preact";
import { useEffect, useId, useRef } from "preact/hooks";
import { Icon } from "./Icon";

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ComponentChildren;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Sheet({ open, onClose, title, children }: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);
  const titleId = useId();

  // Callers pass a fresh arrow every render (`onClose={() => setTarget(null)}`),
  // so depending on it would tear down and re-run this effect on every parent
  // re-render — and useDocValue re-renders on every incoming chat update. The
  // cleanup would then yank focus back to the opener mid-typing, closing the
  // soft keyboard. Keep it in a ref and depend only on `open`.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement;
    // Don't steal focus from a child that already claimed it — ExpenseForm
    // autofocuses the amount field, and re-focusing the panel here would shut
    // the keyboard on the app's highest-traffic path.
    if (!panelRef.current?.contains(document.activeElement)) {
      panelRef.current?.focus();
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current();
        return;
      }
      const panel = panelRef.current;
      if (e.key !== "Tab" || !panel) return;
      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>(FOCUSABLE),
      );
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      const opener = openerRef.current;
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="sheet-backdrop"
      onPointerUp={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onClick={(e) => {
        if (e.detail === 0 && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="sheet-grip" aria-hidden="true" />
        <div className="sheet-header">
          <h2 id={titleId} className="sheet-title">
            {title}
          </h2>
          <button
            type="button"
            className="sheet-close"
            aria-label="Close"
            onPointerUp={onClose}
            onClick={(e) => {
              if (e.detail === 0) onClose();
            }}
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}
