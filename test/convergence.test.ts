import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { createDoc, describeChange, type Store } from "../src/state/doc";
import { formatMoney, type Expense } from "../src/state/model";

// Built with formatMoney so the assertions test our sentence, not the runner's
// Intl locale (which decides symbol placement and spacing).
const eur = (cents: number): string => formatMoney(cents, "EUR");

// y-webxdc exchanges v2 updates, so the tests use the same encoding.
function push(from: Store, to: Store): void {
  Y.applyUpdateV2(to.doc, Y.encodeStateAsUpdateV2(from.doc));
}

function sync(a: Store, b: Store): void {
  push(a, b);
  push(b, a);
}

function expense(id: string, over: Partial<Expense> = {}): Expense {
  return {
    id,
    title: `Expense ${id}`,
    amountCents: 3000,
    payerId: "a@x.de",
    split: { mode: "even", entries: { "a@x.de": 1, "b@x.de": 1 } },
    date: "2026-07-30",
    createdBy: "a@x.de",
    editedAt: 1,
    ...over,
  };
}

describe("peer convergence", () => {
  it("merges concurrent edits from two peers in both directions", () => {
    const a = createDoc();
    const b = createDoc();
    a.addExpense(expense("001", { title: "Pizza" }));
    b.addExpense(expense("002", { title: "Beer", amountCents: 1250 }));

    sync(a, b);

    expect(a.listExpenses()).toEqual(b.listExpenses());
    expect(a.listExpenses().map((e) => e.title)).toEqual(["Pizza", "Beer"]);
  });

  it("replays the full state to a late joiner", () => {
    const a = createDoc();
    a.setSettings({ groupCurrency: "eur", title: "Rome trip" });
    a.registerSelf("a@x.de", "Anna");
    a.addExpense(expense("001"));
    a.addExpense(expense("002"));
    a.updateExpense("001", { amountCents: 4200 }, 99);
    a.addSettlement({
      id: "s1",
      fromId: "b@x.de",
      toId: "a@x.de",
      amountCents: 2100,
      date: "2026-07-30",
      createdBy: "b@x.de",
    });

    const late = createDoc();
    push(a, late);

    expect(late.listExpenses()).toEqual(a.listExpenses());
    expect(late.listSettlements()).toEqual(a.listSettlements());
    expect(late.listMembers()).toEqual(a.listMembers());
    expect(late.getSettings()).toEqual({
      groupCurrency: "EUR",
      title: "Rome trip",
    });
  });

  it("agrees on one value when both peers edit the same expense", () => {
    const a = createDoc();
    const b = createDoc();
    a.addExpense(expense("001", { title: "Pizza" }));
    sync(a, b);

    a.updateExpense("001", { title: "Pizza (A)", amountCents: 1000 }, 10);
    b.updateExpense("001", { title: "Pizza (B)", amountCents: 2000 }, 11);
    sync(a, b);

    // Last-write-wins: which one wins is Yjs' business, agreement is ours.
    expect(a.listExpenses()).toEqual(b.listExpenses());
    expect(a.listExpenses()).toHaveLength(1);
    expect(["Pizza (A)", "Pizza (B)"]).toContain(a.listExpenses()[0].title);
  });

  it("keeps self-registration idempotent per peer and distinct across peers", () => {
    const a = createDoc();
    const b = createDoc();
    a.registerSelf("a@x.de", "Anna");
    a.registerSelf("a@x.de", "Anna");
    b.registerSelf("b@x.de", "Bob");

    sync(a, b);

    expect(a.listMembers()).toEqual(b.listMembers());
    expect(a.listMembers().map((m) => m.name)).toEqual(["Anna", "Bob"]);
  });

  it("deletes converge", () => {
    const a = createDoc();
    const b = createDoc();
    a.addExpense(expense("001"));
    a.addExpense(expense("002"));
    sync(a, b);

    b.deleteExpense("001");
    sync(a, b);

    expect(a.listExpenses().map((e) => e.id)).toEqual(["002"]);
    expect(a.listExpenses()).toEqual(b.listExpenses());
  });
});

describe("snapshots", () => {
  it("round-trips a full document into an empty one", () => {
    const a = createDoc();
    a.setSettings({ groupCurrency: "EUR", title: "Rome trip" });
    a.registerSelf("a@x.de", "Anna");
    a.addVirtualMember("Grandma", 1_700_000_000_000);
    a.setProfile("a@x.de", {
      iban: "DE02120300000000202051",
      accountHolder: "Anna",
      custom: { label: "Twint", urlTemplate: "https://pay.example/{amount}" },
    });
    a.addExpense(expense("001", { title: "Pizza" }));
    a.addSettlement({
      id: "s1",
      fromId: "b@x.de",
      toId: "a@x.de",
      amountCents: 1500,
      method: "PayPal",
      date: "2026-07-30",
      createdBy: "b@x.de",
    });

    const b = createDoc();
    b.importSnapshot(a.exportSnapshot());

    expect(b.getSettings()).toEqual(a.getSettings());
    expect(b.listMembers()).toEqual(a.listMembers());
    expect(b.listExpenses()).toEqual(a.listExpenses());
    expect(b.listSettlements()).toEqual(a.listSettlements());
    expect(b.getProfile("a@x.de")).toEqual(a.getProfile("a@x.de"));
  });

  it("replaces existing data unless merging", () => {
    const a = createDoc();
    a.addExpense(expense("001"));
    const snapshot = a.exportSnapshot();

    const b = createDoc();
    b.addExpense(expense("999", { title: "Old" }));
    b.importSnapshot(snapshot);
    expect(b.listExpenses().map((e) => e.id)).toEqual(["001"]);

    const c = createDoc();
    c.addExpense(expense("999", { title: "Old" }));
    c.importSnapshot(snapshot, { merge: true });
    expect(c.listExpenses().map((e) => e.id)).toEqual(["001", "999"]);
  });

  it("rejects malformed input with a readable message", () => {
    const s = createDoc();
    expect(() => s.importSnapshot("not json")).toThrow(/not valid JSON/);
    expect(() => s.importSnapshot("[1,2]")).toThrow(/JSON object/);
    expect(() => s.importSnapshot('{"expenses": 7}')).toThrow(/"expenses"/);
    expect(() =>
      s.importSnapshot(
        JSON.stringify({ expenses: { "001": { ...expense("001"), id: "" } } }),
      ),
    ).toThrow(/has no id/);
    expect(() =>
      s.importSnapshot(
        JSON.stringify({
          expenses: { "001": { ...expense("001"), amountCents: "30.00" } },
        }),
      ),
    ).toThrow(/integer number of cents/);
    expect(() =>
      s.importSnapshot(
        JSON.stringify({
          expenses: { "001": { ...expense("001"), amountCents: 30.5 } },
        }),
      ),
    ).toThrow(/integer number of cents/);
    expect(() =>
      s.importSnapshot(
        JSON.stringify({
          expenses: { "001": { ...expense("001"), split: {} } },
        }),
      ),
    ).toThrow(/invalid split/);
    expect(() =>
      s.importSnapshot(JSON.stringify({ settings: { groupCurrency: "Euro" } })),
    ).toThrow(/ISO currency code/);
    expect(() =>
      s.importSnapshot(
        JSON.stringify({
          profiles: {
            "a@x.de": {
              custom: { label: "x", urlTemplate: "javascript:evil()" },
            },
          },
        }),
      ),
    ).toThrow(/http/);
    // nothing was written by any failed import
    expect(s.listExpenses()).toEqual([]);
  });
});

describe("describeChange", () => {
  const base = {
    actorName: "Simon",
    currency: "EUR",
    openDebts: 3,
    openTotalCents: 5720,
  };

  it("formats an add and the open-debt summary", () => {
    const { text, summary } = describeChange("add", {
      ...base,
      title: "Pizza",
      amountCents: 3000,
    });
    expect(text).toBe(`Simon added *Pizza* — ${eur(3000)}`);
    expect(summary).toBe(`3 open debts · ${eur(5720)}`);
  });

  it("formats a settlement, singular debts and a settled group", () => {
    expect(
      describeChange("settle", {
        ...base,
        toName: "Anna",
        amountCents: 2350,
        openDebts: 1,
        openTotalCents: 2350,
      }),
    ).toEqual({
      text: `Simon paid Anna ${eur(2350)}`,
      summary: `1 open debt · ${eur(2350)}`,
    });
    expect(
      describeChange("join", { ...base, openDebts: 0, openTotalCents: 0 })
        .summary,
    ).toBe("All settled up");
  });
});
