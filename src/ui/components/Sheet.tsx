// Bottom sheet / modal. Renders nothing when closed; while open it traps
// focus (useLayer), closes on backdrop tap (onPointerUp — see Row.tsx), a downward swipe
// and Escape, and restores focus to whatever opened it when it closes.
//
// For short, glanceable content. Anything tall or form-like is a SubPage.
import type { ComponentChildren } from "preact";
import { useEffect, useId, useRef } from "preact/hooks";
import { Icon } from "./Icon";
import { useLayer } from "./useLayer";

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Holds input that closing would throw away: the backdrop and a swipe
   *  then leave it open. Close and Escape still close — those are asked for. */
  dirty?: boolean;
  children: ComponentChildren;
}

export function Sheet({ open, onClose, title, dirty, children }: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Callers pass a fresh arrow every render (`onClose={() => setTarget(null)}`),
  // so depending on it would tear down and re-run this effect on every parent
  // re-render — and useDocValue re-renders on every incoming chat update. The
  // cleanup would then yank focus back to the opener mid-typing, closing the
  // soft keyboard. Keep it in a ref and depend only on `open`.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  // Blur first: a rename field commits on blur, and an input that unmounts
  // while focused never blurs (and on iOS leaves the keyboard's scroll behind).
  function close() {
    const active = document.activeElement;
    if (active instanceof HTMLElement && panelRef.current?.contains(active)) {
      active.blur();
    }
    closeRef.current();
  }

  useLayer(open, panelRef, close);

  useEffect(() => {
    if (!open) return;
    // Swipe down to close. Touch events, not pointer events: the sheet body
    // scrolls, and only a touchmove listener can claim the gesture from the
    // browser (preventDefault) — and only on its first move, before a scroll
    // starts. So the call is made on that first move: downward, mostly
    // vertical, and the body already scrolled to the top. Anything else is
    // left to scroll as normal.
    const panel = panelRef.current;
    let startX = 0;
    let startY = 0;
    let dy = 0;
    let state: "idle" | "deciding" | "dragging" = "idle";
    let closing: ReturnType<typeof setTimeout> | undefined;
    function onTouchStart(e: TouchEvent) {
      if (e.touches.length !== 1 || !panel || panel.scrollTop > 0) {
        // A second finger mid-drag (a pinch): put the sheet back.
        if (state === "dragging" && panel) {
          panel.style.transition = "";
          panel.style.transform = "";
        }
        state = "idle";
        return;
      }
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      dy = 0;
      state = "deciding";
    }
    function onTouchMove(e: TouchEvent) {
      if (state === "idle" || !panel) return;
      const t = e.touches[0];
      dy = t.clientY - startY;
      if (state === "deciding") {
        if (dy <= 0 || dy < Math.abs(t.clientX - startX)) {
          state = "idle";
          return;
        }
        state = "dragging";
        panel.style.transition = "none";
      }
      e.preventDefault();
      // Holding input: let it give a little, then spring back.
      const shown = dirtyRef.current ? dy / 4 : Math.max(0, dy);
      panel.style.transform = `translateY(${shown}px)`;
    }
    function onTouchEnd() {
      if (state !== "dragging" || !panel) {
        state = "idle";
        return;
      }
      state = "idle";
      panel.style.transition = "";
      if (!dirtyRef.current && dy > Math.min(120, panel.offsetHeight / 3)) {
        panel.style.transform = "translateY(100%)";
        closing = setTimeout(close, 200); // .sheet's transform transition
      } else {
        panel.style.transform = "";
      }
    }
    panel?.addEventListener("touchstart", onTouchStart, { passive: true });
    panel?.addEventListener("touchmove", onTouchMove, { passive: false });
    panel?.addEventListener("touchend", onTouchEnd);
    panel?.addEventListener("touchcancel", onTouchEnd);

    return () => {
      clearTimeout(closing);
      panel?.removeEventListener("touchstart", onTouchStart);
      panel?.removeEventListener("touchmove", onTouchMove);
      panel?.removeEventListener("touchend", onTouchEnd);
      panel?.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="sheet-backdrop"
      onPointerUp={(e) => {
        if (e.target === e.currentTarget && !dirty) close();
      }}
      onClick={(e) => {
        if (e.detail === 0 && e.target === e.currentTarget && !dirty) close();
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
            onPointerUp={close}
            onClick={(e) => {
              if (e.detail === 0) close();
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
