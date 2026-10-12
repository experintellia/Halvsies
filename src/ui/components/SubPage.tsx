// A full-screen sub-page: it covers the whole app including the tab bar, and
// owns the header while it is up. Renders nothing when closed.
//
// Not a Sheet: no backdrop, no swipe. This is a route you navigated to: it
// leaves via the back button in its header, or Escape (which is what a
// hardware Back maps to in the WebViews this ships in). The Escape wiring is
// the same shape as Sheet's on purpose — a document-level keydown listener
// plus the callback in a ref, so that a re-render from an incoming chat
// update doesn't tear the listener down (and yank focus) mid-typing.
//
// To assistive tech it is still a modal (role="dialog", aria-modal, Sheet's
// Tab trap): most sub-pages render *inside* the screen they cover (the
// expense form sits in the Expenses tab), so nothing can aria-hide what is
// behind them, and without this a screen reader or Tab walks straight into
// the hidden list underneath.
import type { ComponentChildren } from "preact";
import { useEffect, useId, useRef } from "preact/hooks";
import { Icon } from "./Icon";
import { trapTab } from "./Sheet";

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
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement;
    // Same guard as Sheet: don't steal focus from a child that already took it.
    if (!panelRef.current?.contains(document.activeElement)) {
      panelRef.current?.focus();
    }

    function onKeyDown(e: KeyboardEvent) {
      // Pages and sheets nest (a currency picker inside group settings): only
      // the top one — the last in the DOM — answers, or one Escape closes all.
      const layers = document.querySelectorAll(".sheet, .subpage");
      const panel = panelRef.current;
      if (!panel || layers[layers.length - 1] !== panel) return;
      trapTab(e, panel);
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
    <div
      className="subpage"
      ref={panelRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
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
        <h1 id={titleId} className="app-title">
          {title}
        </h1>
      </header>
      <div className="app-content">{children}</div>
    </div>
  );
}
