// A full-screen sub-page: it covers the whole app including the tab bar, and
// owns the header while it is up. Renders nothing when closed.
//
// Deliberately NOT a Sheet. A Sheet is a modal — backdrop, focus trap,
// aria-modal — because it interrupts you. This is a route you navigated to:
// it leaves via the back button in its header, or Escape (which is what a
// hardware Back maps to in the WebViews this ships in). The Escape wiring is
// the same shape as Sheet's on purpose — a document-level keydown listener
// plus the callback in a ref, so that a re-render from an incoming chat
// update doesn't tear the listener down (and yank focus) mid-typing.
//
// ponytail: no focus trap. Tab can still reach the covered app behind it,
// which a modal would forbid — add Sheet's trap here if that ever bites.
import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { Icon } from "./Icon";

export interface SubPageProps {
  open: boolean;
  title: string;
  /** Omit for a screen with no way back — the first-run setup finishes instead. */
  onBack?: () => void;
  children: ComponentChildren;
}

export function SubPage({ open, title, onBack, children }: SubPageProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);
  const backRef = useRef(onBack);
  backRef.current = onBack;

  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement;
    // Same guard as Sheet: don't steal focus from a child that already took it.
    if (!panelRef.current?.contains(document.activeElement)) {
      panelRef.current?.focus();
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape" || !backRef.current) return;
      e.preventDefault();
      backRef.current();
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
    <div className="subpage" ref={panelRef} tabIndex={-1}>
      <header className="app-header">
        {onBack && (
          <button
            type="button"
            className="subpage-back"
            aria-label="Back"
            onPointerUp={onBack}
            onClick={(e) => {
              if (e.detail === 0) onBack();
            }}
          >
            <Icon name="chevron-left" size={20} />
          </button>
        )}
        <h1 className="app-title">{title}</h1>
      </header>
      <div className="app-content">{children}</div>
    </div>
  );
}
