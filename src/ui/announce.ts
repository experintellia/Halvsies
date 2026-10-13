// Says what an action did, to screen readers only: "Expense deleted",
// "Payment recorded", "Copied". Sighted users see the result; without this a
// screen-reader user hears nothing, or worse, "start of page".
//
// One polite live region, moved into the top layer when one is open: an
// aria-modal dialog can hide everything outside it, live regions included.
let region: HTMLElement | null = null;
let clear: ReturnType<typeof setTimeout> | undefined;

export function announce(text: string): void {
  if (typeof document === "undefined") return;
  // Next tick: the action may be closing the layer it was taken in, and the
  // message has to land where it will still be readable.
  setTimeout(() => {
    const r = region ?? (region = document.createElement("div"));
    r.setAttribute("role", "status");
    r.className = "sr-only";
    const layers = document.querySelectorAll(".sheet, .subpage");
    const host = layers[layers.length - 1] ?? document.body;
    if (r.parentNode !== host) host.appendChild(r);
    // Emptied first and filled a beat later, so a region that was just moved
    // is registered before it changes, and a repeated message is still heard.
    r.textContent = "";
    setTimeout(() => (r.textContent = text), 100);
    // Said, not kept: left in place it reads as page content later on, and
    // as a second copy of a question that is also on screen.
    clearTimeout(clear);
    clear = setTimeout(() => (r.textContent = ""), 5000);
  });
}
