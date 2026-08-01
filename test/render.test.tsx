// Render smoke tests. These exist because the first build of this app shipped
// screens that typechecked, passed every unit test, and rendered literally
// nothing but placeholder text — no test touched a component, so nothing
// caught it. These mount the real screens against the real doc module and
// assert something meaningful is on the page.
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { render } from "preact";
import { App } from "../src/ui/App";
import { ExpenseList } from "../src/ui/ExpenseList";
import { ProfileForm } from "../src/ui/ProfileForm";
import { addExpense, deleteExpense } from "../src/state/doc";

let host: HTMLDivElement;

/** Preact batches state updates — let the scheduled re-render land. */
const flush = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Taps ride pointerup in this app (see Row.tsx), so tests must too — and Row
 * only counts a pointerup it armed on pointerdown (so a scroll that ends over
 * a row isn't a tap), hence both events.
 */
function tap(el: Element | undefined | null): void {
  if (!el) throw new Error("tap() got no element");
  el.dispatchEvent(new Event("pointerdown", { bubbles: true }));
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

describe("ExpenseList", () => {
  const EXPENSE = {
    id: "e-test-1",
    title: "Dinner",
    amountCents: 4400,
    payerId: "a@example.org",
    split: {
      mode: "even" as const,
      entries: { "a@example.org": 0, "b@example.org": 0 },
    },
    date: "2026-08-01",
    createdBy: "a@example.org",
    editedAt: 0,
  };

  beforeEach(() => addExpense(EXPENSE));
  afterEach(() => deleteExpense(EXPENSE.id)); // shared singleton doc

  const buttonWith = (text: string): HTMLButtonElement | undefined =>
    Array.from(host.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes(text),
    ) as HTMLButtonElement | undefined;

  it("opens a read-only summary, not the edit form, when a row is tapped", async () => {
    render(<ExpenseList />, host);
    tap(host.querySelector(".row"));
    await flush();

    const text = host.textContent ?? "";
    expect(host.querySelector(".sheet")).not.toBeNull();
    expect(text).toContain("Split evenly");
    expect(text).toContain("€44.00");
    // The whole point: nothing here can change the ledger by accident.
    expect(buttonWith("Save")).toBeUndefined();
    expect(buttonWith("Delete")).toBeUndefined();
    expect(host.querySelectorAll("input")).toHaveLength(0);
    expect(buttonWith("Edit")).not.toBeUndefined();
  });

  it("reaches the edit form from the summary's Edit button", async () => {
    render(<ExpenseList />, host);
    tap(host.querySelector(".row"));
    await flush();
    tap(buttonWith("Edit"));
    await flush();

    expect(host.textContent).toContain("Edit expense");
    expect(buttonWith("Save")).not.toBeUndefined();
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
