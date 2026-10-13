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

  // The control focus was last on inside this layer; see the rescue below.
  const lastRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement;
    // Don't steal focus from a child that already claimed it — re-focusing
    // the panel would shut a keyboard that is already up.
    // On the panel itself is no claim: a just-closed layer's fallback may
    // have put it there before this ran.
    const panel = panelRef.current;
    const at = document.activeElement;
    if (panel && (!panel.contains(at) || at === panel)) focusStart(panel);

    // Tab is trapped two ways. On keydown, off either end of the tab order.
    // And after the fact, on focusin, for what keydown can't predict: a date
    // input takes several Tabs inside itself before it lets go.
    let tabbing = false;
    let back = false;
    function onKeyDown(e: KeyboardEvent) {
      const panel = panelRef.current;
      if (!isTop(panel)) return;
      if (e.key === "Escape" && escRef.current) {
        e.preventDefault();
        escRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      tabbing = true;
      back = e.shiftKey;
      setTimeout(() => (tabbing = false));
      const all = panel.querySelectorAll<HTMLElement>(FOCUSABLE);
      const active = document.activeElement;
      const edge = back ? [all[0], panel] : [all[all.length - 1]];
      const composite =
        active instanceof HTMLInputElement &&
        /^(date|time|datetime-local|month|week)$/.test(active.type);
      // Needed even with the focusin net: when nothing focusable follows the
      // panel (group settings, the setup screen) Tab leaves the page.
      if (
        all.length === 0 ||
        (edge.includes(active as HTMLElement) && !composite)
      ) {
        e.preventDefault();
        (all.length ? all[back ? all.length - 1 : 0] : panel).focus();
      }
    }
    // Only for Tab: a copy button's off-screen textarea takes focus outside
    // the panel on purpose, and must keep it.
    function onFocusIn(e: FocusEvent) {
      const panel = panelRef.current;
      if (!isTop(panel)) return;
      if (panel.contains(e.target as Node)) {
        lastRef.current = e.target as HTMLElement;
        return;
      }
      if (!tabbing) return;
      const all = panel.querySelectorAll<HTMLElement>(FOCUSABLE);
      (all.length ? all[back ? all.length - 1 : 0] : panel).focus();
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
      const hadFocus = panel?.contains(document.activeElement);
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
      // The opener can go with the thing it opened (a deleted expense's row,
      // a settled debt's button, the setup screen) — now, or in the render
      // that is still in flight. Land on what is now on top instead of
      // <body>, which screen readers read as "start of page".
      // Nothing to restore when focus was never here: an iOS tap doesn't
      // focus buttons, so the opener is <body> and so is focus — leave it.
      if (!hadFocus && (opener === document.body || !opener)) return;
      setTimeout(() => {
        if (!lost()) return;
        const layers =
          document.querySelectorAll<HTMLElement>(".sheet, .subpage");
        (layers[layers.length - 1] ?? document.querySelector("main"))?.focus();
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

  // The focused control went away under you ("Mark as paid" swapping for its
  // confirmation, a stepper hitting 0 and disabling): catch focus on the
  // panel rather than leave it on <body>, outside the dialog. Only then — a
  // field you blurred yourself (iOS "Done") is still there, and pulling a
  // screen reader back to the dialog's title after every edit would be worse.
  useEffect(() => {
    const last = lastRef.current;
    if (
      open &&
      lost() &&
      last &&
      (!last.isConnected || (last as HTMLButtonElement).disabled) &&
      isTop(panelRef.current)
    ) {
      lastRef.current = null;
      panelRef.current.focus();
    }
  });
}
