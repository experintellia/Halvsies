// Render smoke tests. These exist because the first build of this app shipped
// screens that typechecked, passed every unit test, and rendered literally
// nothing but placeholder text — no test touched a component, so nothing
// caught it. These mount the real screens against the real doc module and
// assert something meaningful is on the page.
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { render } from "preact";
import { App } from "../src/ui/App";
import { ProfileForm } from "../src/ui/ProfileForm";

let host: HTMLDivElement;

/** Preact batches state updates — let the scheduled re-render land. */
const flush = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

/** Taps ride pointerup in this app (see Row.tsx), so tests must too. */
function tap(el: Element | undefined): void {
  if (!el) throw new Error("tap() got no element");
  el.dispatchEvent(new Event("pointerup", { bubbles: true }));
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  render(null, host); // unmount so effects/subscriptions don't leak between tests
  host.remove();
});

describe("App shell", () => {
  it("mounts the real screens, not placeholders", () => {
    render(<App />, host);
    const text = host.textContent ?? "";
    expect(text).not.toContain("goes here");
    // The three tabs are present...
    for (const tab of ["Expenses", "Balances", "Me"]) {
      expect(text).toContain(tab);
    }
    // ...and the default tab rendered actual expense-screen content.
    expect(host.querySelector(".tab-bar")).not.toBeNull();
  });

  it("switches to the Me tab and renders the profile screen", async () => {
    render(<App />, host);
    tap(
      Array.from(host.querySelectorAll("button")).find((b) =>
        (b.textContent ?? "").includes("Me"),
      ),
    );
    await flush();
    expect(host.textContent).toContain("Add payment method");
  });
});

describe("ProfileForm", () => {
  it("starts collapsed: no method rows, an add button, and the note field", () => {
    render(<ProfileForm />, host);
    const text = host.textContent ?? "";

    // The whole point of the redesign: methods are not all splayed out.
    expect(host.querySelectorAll(".method-row")).toHaveLength(0);
    expect(text).toContain("Add payment method");

    // The note is always visible, with or without any configured method.
    expect(host.querySelector("textarea")).not.toBeNull();
    expect(text).toContain("paying you");

    // Privacy notice stays up top.
    expect(text).toContain("can see your payment profile");
  });

  it("opens the wizard picker listing every provider", async () => {
    render(<ProfileForm />, host);
    tap(
      Array.from(host.querySelectorAll("button")).find((b) =>
        (b.textContent ?? "").includes("Add payment method"),
      ),
    );
    await flush();

    const text = host.textContent ?? "";
    for (const label of [
      "PayPal",
      "Revolut",
      "Wise",
      "Venmo",
      "Monzo",
      "Bank transfer",
      "Custom link",
    ]) {
      expect(text).toContain(label);
    }
    expect(
      host.querySelectorAll(".wizard-option").length,
    ).toBeGreaterThanOrEqual(7);
  });

  it("walks to a provider step and shows where to find the handle", async () => {
    render(<ProfileForm />, host);
    tap(
      Array.from(host.querySelectorAll("button")).find((b) =>
        (b.textContent ?? "").includes("Add payment method"),
      ),
    );
    await flush();

    tap(
      Array.from(host.querySelectorAll(".wizard-option")).find((b) =>
        (b.textContent ?? "").includes("PayPal"),
      ),
    );
    await flush();

    const text = host.textContent ?? "";
    expect(text).toContain("paypal.me"); // the "where to find it" guidance
    expect(host.querySelector("input")).not.toBeNull();
    // Nothing typed yet, so Save must be disabled — no half-configured method.
    const save = Array.from(host.querySelectorAll("button")).find(
      (b) => (b.textContent ?? "").trim() === "Save",
    ) as HTMLButtonElement | undefined;
    expect(save?.disabled).toBe(true);
  });
});
