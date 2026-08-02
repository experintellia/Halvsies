// Group settings: the first-run screen that asks for them, and the sub-page
// that edits them afterwards. The rule that decides whether to ask is the
// interesting part — it has to be read off the doc (there is no localStorage
// here), and it must never fire a second time on a peer that joins later.
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { render } from "preact";
import { App } from "../src/ui/App";
import { needsSetup } from "../src/ui/GroupSettings";
import {
  getSettings,
  importSnapshot,
  listMembers,
  setSettings,
} from "../src/state/doc";
import { isCurrencyCode } from "../src/state/model";
import { uninstallWebxdc } from "./webxdc-mock";

let host: HTMLDivElement;

/** Preact batches state updates — let the scheduled re-render land. */
const flush = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

/** Taps ride pointerup in this app (see Row.tsx), so tests must too. */
function tap(el: Element | undefined | null): void {
  if (!el) throw new Error("tap() got no element");
  el.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  el.dispatchEvent(new Event("pointerup", { bubbles: true }));
}

const button = (text: string): HTMLButtonElement | undefined =>
  Array.from(host.querySelectorAll("button")).find((b) =>
    (b.textContent ?? "").includes(text),
  ) as HTMLButtonElement | undefined;

const subpage = (): HTMLElement | null => host.querySelector(".subpage");

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  render(null, host);
  host.remove();
  uninstallWebxdc();
});

describe("needsSetup", () => {
  it("asks only while nobody has written the settings", () => {
    // Nothing in the doc yet: the one case that gets the screen.
    expect(needsSetup({ groupCurrency: "EUR" }, 0, 0)).toBe(true);

    // The setup screen always writes a title, "" when it was skipped — that
    // empty string is the marker, and it syncs like any other doc entry.
    expect(needsSetup({ groupCurrency: "EUR", title: "" }, 0, 0)).toBe(false);
    expect(needsSetup({ groupCurrency: "EUR", title: "Trip" }, 9, 4)).toBe(
      false,
    );

    // Backstop for a group created before this screen existed: a running
    // ledger means the split is already under way, so nobody is asked.
    expect(needsSetup({ groupCurrency: "EUR" }, 1, 0)).toBe(false);
    expect(needsSetup({ groupCurrency: "EUR" }, 0, 1)).toBe(false);
  });

  // The regression: the backstop used to count members. Members register
  // themselves the instant the app opens, so two people opening the same
  // unconfigured group took the count to 2 and silently dismissed the setup
  // screen on BOTH of them — leaving the currency on its default forever,
  // with nobody ever asked.
  it("does not care how many people have opened the app", () => {
    const unconfigured = { groupCurrency: "EUR" };
    expect(needsSetup(unconfigured, 0, 0)).toBe(true);
    // Whatever the roster does, only the ledger and the title decide.
    expect(needsSetup({ ...unconfigured, title: "" }, 0, 0)).toBe(false);
  });
});

describe("first run", () => {
  // A doc nobody has touched: importSnapshot("{}") clears every map, and
  // leaves `title` unwritten exactly like a brand new group.
  beforeEach(() => importSnapshot("{}"));

  it("asks for the currency before the app, then never again", async () => {
    render(<App />, host);
    await flush();

    expect(subpage()).not.toBeNull();
    expect(host.textContent).toContain("Set up this split");

    // Open the picker, search, pick — the whole point of the control.
    tap(host.querySelector(".subpage .picker-value"));
    await flush();
    const search = document.querySelector(
      ".sheet input",
    ) as HTMLInputElement | null;
    search!.value = "british";
    search!.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    tap(document.querySelector(".sheet .currency-row"));
    await flush();

    // The name is optional, so there is always a way through this screen.
    tap(button("Start without a name"));
    await flush();

    expect(getSettings()).toEqual({ groupCurrency: "GBP", title: "" });
    expect(subpage()).toBeNull();
    expect(host.querySelector(".tab-bar")).not.toBeNull();

    // Re-opening the app on this (or any peer's) doc must not ask again.
    render(null, host);
    render(<App />, host);
    await flush();
    expect(subpage()).toBeNull();
  });

  // The currency is picked, not typed, so an unparseable code is unreachable
  // from this screen — which is why the form carries no validity gate. Every
  // option it offers has to survive setSettings(), whose isCurrencyCode()
  // check is there for what a peer syncs.
  it("only offers codes the document will actually accept", async () => {
    render(<App />, host);
    await flush();
    tap(host.querySelector(".subpage .picker-value"));
    await flush();

    const codes = Array.from(
      document.querySelectorAll(".sheet .currency-code"),
    ).map((el) => (el.textContent ?? "").trim());
    expect(codes.length).toBeGreaterThan(40);
    expect(codes.every((c) => isCurrencyCode(c))).toBe(true);
    expect(codes).toContain("EUR");
    // Common ones lead, so the usual answer needs no scrolling.
    expect(codes.slice(0, 5)).toContain("EUR");
  });

  // The trap this control exists inside: Delta Chat's Android WebView fires
  // blur before click, so a picker that closed its list when the search field
  // lost focus would swallow every tap. Nothing here listens to blur, and the
  // rows arm on pointerdown — this asserts a tap dispatched while the search
  // input holds focus still selects.
  it("picks a row tapped while the search field is focused", async () => {
    render(<App />, host);
    await flush();
    tap(host.querySelector(".subpage .picker-value"));
    await flush();

    const search = document.querySelector(".sheet input") as HTMLInputElement;
    search.focus();
    search.value = "swedish";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();

    const first = document.querySelector(".sheet .currency-row");
    expect((first?.textContent ?? "").trim()).toMatch(/^SEK/);

    // The event order a real device produces: blur lands before the tap ends.
    first!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    search.dispatchEvent(new Event("blur", { bubbles: true }));
    first!.dispatchEvent(new Event("pointerup", { bubbles: true }));
    await flush();

    expect(document.querySelector(".sheet")).toBeNull();
    // This is the first-run screen, so the pick lives in local state until
    // Start — what matters is that the tap was not swallowed.
    expect(
      host.querySelector(".picker-value .currency-code")?.textContent,
    ).toBe("SEK");
    tap(button("Start without a name"));
    await flush();
    expect(getSettings().groupCurrency).toBe("SEK");
  });
});

describe("the group settings sub-page", () => {
  beforeEach(() => setSettings({ title: "Trip", groupCurrency: "EUR" }));

  /**
   * Me tab → Group settings. The final wait is longer than flush() on purpose:
   * Escape is wired in a useEffect, which preact defers to after paint.
   */
  const open = async (): Promise<void> => {
    render(<App />, host);
    await flush();
    tap(button("Me"));
    await flush();
    tap(button("Group settings"));
    await new Promise((resolve) => setTimeout(resolve, 50));
  };

  it("moves currency, name, members and backup off the Me tab", async () => {
    render(<App />, host);
    await flush();
    tap(button("Me"));
    await flush();

    // The Me tab keeps only what is yours.
    expect(host.textContent).toContain("Add payment method");
    expect(host.textContent).not.toContain("Group currency");
    expect(host.textContent).not.toContain("Backup");

    tap(button("Group settings"));
    await flush();

    const page = subpage();
    expect(page).not.toBeNull();
    const text = page?.textContent ?? "";
    expect(text).toContain("Group currency");
    expect(text).toContain("Name (optional)");
    expect(text).toContain("Members");
    expect(text).toContain("Backup");
    // Its own title in its own header, not the group's.
    expect(page?.querySelector(".app-title")?.textContent).toBe(
      "Group settings",
    );
  });

  it("leaves on the back button and on Escape", async () => {
    await open();
    tap(host.querySelector('.subpage button[aria-label="Back"]'));
    await flush();
    expect(subpage()).toBeNull();

    await open();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await flush();
    expect(subpage()).toBeNull();
  });
});

describe("first open writes nothing", () => {
  // The regression the user spotted: main.tsx called ensureSelfRegistered()
  // before render. That is a document write, and every write flushes to the
  // chat — so Halvsies announced "X joined the split" into the group while the
  // setup screen was still asking which currency this split is even in.
  // Opening the app out of curiosity and closing it must leave no trace.
  //
  // What this pins is the mechanism: registration now happens in an effect
  // that App skips while unconfigured, and NOTHING behind the setup screen is
  // mounted — the tab screens each register the local user via useSelfId() on
  // mount, so leaving the shell mounted underneath would defeat the whole fix.
  // (The registration call itself is not assertable here: doc.ts captures
  // window.webxdc at module load, before any test can install the mock, and
  // the file that can — host.test.tsx — cannot run effects. See its header.)
  beforeEach(() => importSnapshot("{}"));

  it("mounts nothing behind the setup screen, so nobody is registered", async () => {
    render(<App />, host);
    await flush();

    expect(host.textContent).toContain("Set up this split");
    expect(listMembers()).toEqual([]);
    // No shell at all: no tab bar, and no expense screen to call useSelfId().
    expect(host.querySelector(".tab-bar")).toBeNull();
    expect(host.textContent).not.toContain("Add expense");

    tap(button("Start without a name"));
    await flush();

    // Only now does the app — and its registration effect — exist.
    expect(host.querySelector(".tab-bar")).not.toBeNull();
    expect(host.textContent).toContain("Add expense");
  });
});
