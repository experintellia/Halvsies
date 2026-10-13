// Swipe-down to close, and the one thing it must never do: throw away input.
import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sheet } from "../src/ui/components/Sheet";
import { SubPage } from "../src/ui/components/SubPage";

let host: HTMLElement;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
});
afterEach(() => {
  render(null, host);
  host.remove();
});

/** Preact runs effects after paint — two macrotasks here (see weights.test). */
const settle = () => new Promise((r) => setTimeout(r, 50));

function touch(el: Element, type: string, y: number): Event {
  const e = new Event(type, { bubbles: true, cancelable: true });
  const touches = type === "touchend" ? [] : [{ clientX: 0, clientY: y }];
  Object.defineProperty(e, "touches", { value: touches });
  el.dispatchEvent(e);
  return e;
}

/** Drags from y=0 to `dy` and lets go; returns the move event. */
function swipe(el: Element, dy: number): Event {
  touch(el, "touchstart", 0);
  const move = touch(el, "touchmove", dy);
  touch(el, "touchend", dy);
  return move;
}

async function open(dirty = false) {
  const onClose = vi.fn();
  render(
    <Sheet open onClose={onClose} title="T" dirty={dirty}>
      <p>body</p>
    </Sheet>,
    host,
  );
  await settle();
  return { onClose, panel: host.querySelector<HTMLElement>(".sheet")! };
}

describe("Sheet swipe", () => {
  it("closes on a swipe down", async () => {
    const { onClose, panel } = await open();
    expect(swipe(panel, 200).defaultPrevented).toBe(true);
    await new Promise((r) => setTimeout(r, 250));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("springs back instead of closing while it holds input", async () => {
    const { onClose, panel } = await open(true);
    swipe(panel, 200);
    await new Promise((r) => setTimeout(r, 250));
    expect(onClose).not.toHaveBeenCalled();
    expect(panel.style.transform).toBe("");
  });

  it("leaves an upward swipe to scroll the body", async () => {
    const { onClose, panel } = await open();
    expect(swipe(panel, -200).defaultPrevented).toBe(false);
    await new Promise((r) => setTimeout(r, 250));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("ignores a backdrop tap while it holds input", async () => {
    const { onClose } = await open(true);
    host
      .querySelector(".sheet-backdrop")!
      .dispatchEvent(new Event("pointerup", { bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("SubPage focus", () => {
  // It renders inside the screen it covers, so only being a modal keeps
  // Tab (and a screen reader) out of the hidden list underneath.
  it("is a labelled modal that keeps Tab inside", async () => {
    const behind = document.createElement("button");
    host.appendChild(behind);
    const inner = document.createElement("div");
    host.appendChild(inner);
    render(
      <SubPage open title="Add expense" onBack={() => {}}>
        <input autoFocus />
      </SubPage>,
      inner,
    );
    await settle();
    const page = host.querySelector<HTMLElement>(".subpage")!;
    expect(page.getAttribute("role")).toBe("dialog");
    expect(page.getAttribute("aria-modal")).toBe("true");
    expect(
      document.getElementById(page.getAttribute("aria-labelledby")!)
        ?.textContent,
    ).toBe("Add expense");

    // autoFocus never fires on a layer mounted after page load; useLayer
    // does it by hand.
    const input = page.querySelector("input")!;
    expect(document.activeElement).toBe(input);

    // Tab out of the last field: the browser moves focus behind the page,
    // and it is wrapped back to the first stop (the Back button)…
    const tab = (shiftKey = false) =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", shiftKey }),
      );
    tab();
    // Wrapped on keydown already: with nothing focusable after the page
    // (group settings, the setup screen), the browser would leave the page.
    expect(document.activeElement).toBe(page.querySelector(".subpage-back"));
    input.focus();
    tab();
    behind.focus();
    expect(document.activeElement).toBe(page.querySelector(".subpage-back"));
    // …and Shift+Tab off the first stop wraps to the last.
    tab(true);
    behind.focus();
    expect(document.activeElement).toBe(input);

    // Without a Tab, focus may leave on purpose (the copy fallback's
    // off-screen textarea): it is left alone.
    await settle();
    behind.focus();
    expect(document.activeElement).toBe(behind);
    render(null, inner);
  });
});

describe("closing a layer whose opener is gone", () => {
  it("lands on <main>, not <body>", async () => {
    const main = document.createElement("main");
    main.tabIndex = -1;
    host.appendChild(main);
    const opener = document.createElement("button");
    host.appendChild(opener);
    opener.focus();
    const inner = document.createElement("div");
    host.appendChild(inner);
    render(
      <Sheet open onClose={() => {}} title="T">
        <p>body</p>
      </Sheet>,
      inner,
    );
    await settle();
    opener.remove(); // e.g. the row of the expense just deleted
    render(null, inner);
    await settle();
    expect(document.activeElement).toBe(main);
  });

  it("also when the opener goes in the same render (a settled debt)", async () => {
    const main = document.createElement("main");
    main.tabIndex = -1;
    host.appendChild(main);
    const opener = document.createElement("button");
    host.appendChild(opener);
    opener.focus();
    const inner = document.createElement("div");
    host.appendChild(inner);
    render(
      <Sheet open onClose={() => {}} title="T">
        <button>Yes, record it</button>
      </Sheet>,
      inner,
    );
    await settle();
    host.querySelector<HTMLElement>(".sheet button:not(.sheet-close)")!.focus();
    render(null, inner); // focus goes back to the opener…
    opener.remove(); // …which the same update then removes
    await settle();
    expect(document.activeElement).toBe(main);
  });
});
