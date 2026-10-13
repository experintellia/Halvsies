// A full-screen sub-page: it covers the whole app including the tab bar, and
// owns the header while it is up. Renders nothing when closed.
//
// Not a Sheet: no backdrop, no swipe. This is a route you navigated to: it
// leaves via the back button in its header, or Escape (which is what a
// hardware Back maps to in the WebViews this ships in).
//
// To assistive tech it is still a modal (role="dialog", aria-modal, the Tab
// trap in useLayer): most sub-pages render *inside* the screen they cover (the
// expense form sits in the Expenses tab), so nothing can aria-hide what is
// behind them, and without this a screen reader or Tab walks straight into
// the hidden list underneath.
import type { ComponentChildren } from "preact";
import { useId, useRef } from "preact/hooks";
import { Icon } from "./Icon";
import { useLayer } from "./useLayer";

export interface SubPageProps {
  open: boolean;
  title: string;
  /** Omit for a screen with no way back — the first-run setup finishes instead. */
  onBack?: () => void;
  children: ComponentChildren;
}

export function SubPage({ open, title, onBack, children }: SubPageProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useLayer(open, panelRef, onBack, title);

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
