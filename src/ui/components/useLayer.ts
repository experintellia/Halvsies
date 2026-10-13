// What makes a Sheet or a SubPage the top layer, for keyboards and screen
// readers: where focus starts, Escape, the Tab trap, and where focus goes when
// the layer (or the control you were on) disappears. One copy, used by both.
//
// The listeners are document-level with the callback in a ref, so a re-render
// from an incoming chat update never tears them down — the cleanup would yank
// focus back to the opener mid-typing and close the soft keyboard.
import { useEffect, useRef, type MutableRef } from "preact/hooks";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Pages and sheets nest (a currency picker inside group settings): only the
 *  last one in the DOM answers, or one Escape would close them all. */
function isTop(panel: HTMLElement | null): panel is HTMLElement {
  const layers = document.querySelectorAll(".sheet, .subpage");
  return panel !== null && layers[layers.length - 1] === panel;
}

/** The [autofocus] field if there is one, else the panel (which announces the
 *  title). Done by hand: browsers honour the autofocus attribute only once per
 *  document, so on a layer mounted later it never fires. */
function focusStart(panel: HTMLElement): void {
  (panel.querySelector<HTMLElement>("[autofocus]") ?? panel).focus();
}

const lost = () =>
  document.activeElement === null || document.activeElement === document.body;

export function useLayer(
  open: boolean,
  panelRef: MutableRef<HTMLDivElement | null>,
  onEscape: (() => void) | undefined,
  /** A change here (the wizard's step title) is a new screen: focus restarts. */
  step?: string,
): void {
  const escRef = useRef(onEscape);
  escRef.current = onEscape;

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement;
    // Don't steal focus from a child that already claimed it — re-focusing
    // the panel would shut a keyboard that is already up.
    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) focusStart(panel);

    // Tab is trapped after the fact: the browser moves focus, and if it left
    // the layer it is wrapped back. Not by predicting the last stop on
    // keydown — a date input takes several Tabs inside itself.
    let tabbing = false;
    let back = false;
    function onKeyDown(e: KeyboardEvent) {
      const panel = panelRef.current;
      if (!isTop(panel)) return;
      if (e.key === "Tab") {
        tabbing = true;
        back = e.shiftKey;
        setTimeout(() => (tabbing = false));
      } else if (e.key === "Escape" && escRef.current) {
        e.preventDefault();
        escRef.current();
      }
    }
    // Only for Tab: a copy button's off-screen textarea takes focus outside
    // the panel on purpose, and must keep it.
    function onFocusIn(e: FocusEvent) {
      const panel = panelRef.current;
      if (!tabbing || !isTop(panel) || panel.contains(e.target as Node)) return;
      const all = panel.querySelectorAll<HTMLElement>(FOCUSABLE);
      (all.length ? all[back ? all.length - 1 : 0] : panel).focus();
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
      if (
        opener instanceof HTMLElement &&
        opener !== document.body &&
        opener.isConnected
      ) {
        opener.focus();
        return;
      }
      // The opener went with the thing it opened (a deleted expense's row, a
      // settled debt's button, the setup screen). Land on the screen instead
      // of <body>, which screen readers read as "start of page". Next tick:
      // the screen may be mounting in this same render.
      setTimeout(() => {
        if (lost()) document.querySelector<HTMLElement>("main")?.focus();
      });
    };
  }, [open]);

  useEffect(() => {
    const panel = panelRef.current;
    if (
      open &&
      panel &&
      step !== undefined &&
      !panel.contains(document.activeElement)
    )
      focusStart(panel);
  }, [step]);

  // The focused control unmounted under you ("Mark as paid" swapping for its
  // confirmation, a stepper hitting 0 and disabling): catch focus on the
  // panel rather than leave it on <body>, outside the dialog.
  useEffect(() => {
    if (open && lost() && isTop(panelRef.current)) panelRef.current.focus();
  });
}
