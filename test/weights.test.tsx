// The "Shares" split mode — the label the user sees, the stepper that replaced
// the number input, and the percentages that make a bare "2" mean something.
//
// The load-bearing assertion is the last one: the mode is LABELLED "Shares" but
// still STORED as "weights". That string is durable CRDT state synced to peers,
// so renaming it would orphan every existing expense and break any peer on an
// older build.
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { render } from "preact";
import { ExpenseForm } from "../src/ui/ExpenseForm";
import { importSnapshot, listExpenses } from "../src/state/doc";
import { formatMoney } from "../src/state/model";

let host: HTMLDivElement;

/** Preact batches state updates — let the scheduled re-render land. */
const flush = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Longer than flush() on purpose: preact defers effects to "after paint",
 * which is two macrotasks (the rAF shim in setup.ts fires a callback that
 * itself does setTimeout(cb)). ExpenseForm resets the whole draft in a mount
 * effect, so anything typed before that lands gets wiped.
 */
const settle = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 50));

/** Taps ride pointerup in this app (see Row.tsx), so tests must too. */
function tap(el: Element | undefined | null): void {
  if (!el) throw new Error("tap() got no element");
  el.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  el.dispatchEvent(new Event("pointerup", { bubbles: true }));
}

const button = (text: string): HTMLButtonElement | undefined =>
  Array.from(host.querySelectorAll("button")).find(
    (b) => (b.textContent ?? "").trim() === text,
  ) as HTMLButtonElement | undefined;

/** The per-member blocks, in the doc's own id order: Ann, Bob, Cid. */
const rows = (): HTMLElement[] =>
  Array.from(host.querySelectorAll(".split-member"));

/** [−, +] of the stepper inside a member block. */
const stepper = (row: HTMLElement): HTMLButtonElement[] =>
  Array.from(row.querySelectorAll(".stepper button"));

const readout = (row: HTMLElement): string =>
  (
    row.querySelector(".share-controls .field-suffix")?.textContent ?? ""
  ).trim();

/**
 * The member's own money, from the row itself. The readout deliberately does
 * NOT repeat it — the row shows it right-aligned with everyone else's, which
 * is what makes the column scannable — so the two are asserted separately.
 */
const rowAmount = (row: HTMLElement): string =>
  (row.querySelector(".row-amount")?.textContent ?? "").trim();

/** Types into the amount field the way the user does. */
async function setAmount(text: string): Promise<void> {
  const input = host.querySelector(".amount-input") as HTMLInputElement;
  input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await flush();
}

const EUR = (cents: number): string => formatMoney(cents, "EUR");

beforeEach(async () => {
  importSnapshot(
    JSON.stringify({
      settings: { groupCurrency: "EUR" },
      members: {
        "a@x.de": { id: "a@x.de", name: "Ann" },
        "b@x.de": { id: "b@x.de", name: "Bob" },
        "c@x.de": { id: "c@x.de", name: "Cid" },
      },
    }),
  );
  host = document.createElement("div");
  document.body.appendChild(host);
  render(<ExpenseForm open onClose={() => {}} />, host);
  await settle();
  await setAmount("30");
});

afterEach(() => {
  render(null, host);
  host.remove();
});

/** Opens the sheet on Shares mode with all three members at 1 share. */
async function shares(): Promise<void> {
  tap(button("Shares"));
  await flush();
}

describe("the Shares split mode", () => {
  it("is called Shares, never Weights", async () => {
    expect(button("Shares")).toBeDefined();
    expect(button("Weights")).toBeUndefined();
    await shares();
    // Not in the hint, not in a field label, not anywhere.
    expect(host.textContent).not.toMatch(/weight/i);
    expect(host.textContent).toContain(
      "Give someone 2 shares if they're covering two people.",
    );
  });

  it("offers steppers, not a numeric keyboard", async () => {
    await shares();
    expect(host.querySelectorAll("input[type=number]").length).toBe(0);
    expect(host.querySelectorAll(".stepper").length).toBe(3);
    // Two real buttons per member, reachable by keyboard and by tap.
    expect(stepper(rows()[0]).length).toBe(2);
    expect(
      host.querySelector('.stepper[aria-label="Shares for Ann"]'),
    ).not.toBeNull();
  });

  it("shows shares, percentage and money, and follows + and −", async () => {
    await shares();
    // Three members, one share each: an even split spelled out.
    expect(readout(rows()[0])).toBe("1 share · 33%");
    expect(rowAmount(rows()[0])).toBe(EUR(1000));
    expect(host.textContent).toContain("3 shares in total");

    // Ann covers two people.
    tap(stepper(rows()[0])[1]);
    await flush();
    expect(readout(rows()[0])).toBe("2 shares · 50%");
    expect(rowAmount(rows()[0])).toBe(EUR(1500));
    expect(readout(rows()[1])).toBe("1 share · 25%");
    expect(rowAmount(rows()[1])).toBe(EUR(750));
    expect(host.textContent).toContain("4 shares in total");

    // …and back down again.
    tap(stepper(rows()[0])[0]);
    await flush();
    expect(readout(rows()[0])).toBe("1 share · 33%");
    expect(rowAmount(rows()[0])).toBe(EUR(1000));
    expect(host.textContent).toContain("3 shares in total");
  });

  it("makes 0 shares visibly different from being included", async () => {
    await shares();
    tap(stepper(rows()[1])[0]); // Bob: 1 → 0
    await flush();

    const bob = rows()[1];
    expect(readout(bob)).toBe("0 shares — pays nothing");
    expect(bob.querySelector(".row-zero")).not.toBeNull();
    // The others are still plain included rows.
    expect(rows()[0].querySelector(".row-zero")).toBeNull();
    expect(readout(rows()[0])).toBe("1 share · 50%");
    expect(rowAmount(rows()[0])).toBe(EUR(1500));
    expect(host.textContent).toContain("2 shares in total");

    // Clamped at zero: − is dead, and tapping it cannot go negative.
    expect(stepper(bob)[0].disabled).toBe(true);
    tap(stepper(bob)[0]);
    await flush();
    expect(readout(rows()[1])).toBe("0 shares — pays nothing");
  });

  it("clamps the + button at the upper bound", async () => {
    await shares();
    for (let i = 0; i < 25; i++) {
      tap(stepper(rows()[0])[1]);
      await flush();
    }
    expect(rows()[0].querySelector(".stepper-value")?.textContent).toBe("20");
    expect(stepper(rows()[0])[1].disabled).toBe(true);
  });

  // The compatibility guarantee: only the LABEL changed.
  it('still stores the mode as the string "weights"', async () => {
    await shares();
    tap(stepper(rows()[0])[1]); // Ann 2
    await flush();
    tap(stepper(rows()[1])[0]); // Bob 0
    await flush();
    tap(button("Save"));
    await flush();

    const saved = listExpenses();
    expect(saved.length).toBe(1);
    expect(saved[0].split.mode).toBe("weights");
    expect(saved[0].split.entries).toEqual({
      "a@x.de": 2,
      "b@x.de": 0,
      "c@x.de": 1,
    });
    expect(saved[0].amountCents).toBe(3000);
  });
});
