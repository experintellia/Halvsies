import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { createDoc, describeChange, type Store } from "../src/state/doc";
import { netBalances } from "../src/state/balances";
import { simplifyDebts } from "../src/state/simplify";
import {
  formatMoney,
  type Expense,
  type MemberId,
  type Transfer,
} from "../src/state/model";
import { paymentMethodsFor } from "../src/pay/links";

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

/**
 * Let every peer see every other peer's state, the way the checklist's "leave
 * the app idle a few seconds" step does: merge them all into the first, then
 * hand the merged state back out.
 */
function syncAll(peers: Store[]): void {
  for (const p of peers) push(p, peers[0]);
  for (const p of peers) push(peers[0], p);
}

const balancesOf = (s: Store): Record<MemberId, number> =>
  netBalances(
    s.listExpenses(),
    s.listSettlements(),
    s.listMembers().map((m) => m.id),
  );

/** What the Balances tab lists as "suggested transfers", for one peer. */
const transfersOf = (s: Store): Transfer[] => simplifyDebts(balancesOf(s));

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

/** The checklist's three peers: Anna, Bob and Carol, each on their own doc. */
function peers(): [Store, Store, Store] {
  const a = createDoc();
  const b = createDoc();
  const c = createDoc();
  a.registerSelf("a@x.de", "Anna");
  b.registerSelf("b@x.de", "Bob");
  c.registerSelf("c@x.de", "Carol");
  syncAll([a, b, c]);
  return [a, b, c];
}

/** An even split over all three of them. */
const evenThree = (): Expense["split"] => ({
  mode: "even",
  entries: { "a@x.de": 1, "b@x.de": 1, "c@x.de": 1 },
});

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

  // MANUAL A4 — which value wins is Yjs' business and peer count changes
  // nothing about it; that every peer ends up on the same one is the item.
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

// The in-process version of the webxdc-dev checklist: three peers, one
// process, updates exchanged by hand instead of by the autosave loop.
describe("three peers", () => {
  // MANUAL A1
  it("A1 — a late joiner replays every expense, with identical balances", () => {
    const a = createDoc();
    a.registerSelf("a@x.de", "Anna");
    const bob = a.addVirtualMember("Bob", 1);
    const split = {
      mode: "even" as const,
      entries: { "a@x.de": 1, [bob.id]: 1 },
    };
    a.addExpense(expense("001", { title: "Pizza", split }));
    a.addExpense(expense("002", { title: "Beer", amountCents: 1250, split }));
    a.addExpense(expense("003", { title: "Taxi", amountCents: 999, split }));

    // Peer 2 opens for the first time only now.
    const late = createDoc();
    late.registerSelf("d@x.de", "Dan");
    sync(a, late);

    expect(late.listExpenses()).toEqual(a.listExpenses());
    expect(late.listExpenses()).toHaveLength(3);
    expect(balancesOf(late)).toEqual(balancesOf(a));
  });

  // MANUAL A3
  it("A3 — concurrent adds on two peers all survive, on all three", () => {
    const [a, b, c] = peers();
    a.addExpense(
      expense("001", { title: "Pizza", payerId: "a@x.de", split: evenThree() }),
    );
    b.addExpense(
      expense("002", {
        title: "Beer",
        amountCents: 1200,
        payerId: "b@x.de",
        createdBy: "b@x.de",
        split: evenThree(),
      }),
    );

    syncAll([a, b, c]);

    for (const p of [a, b, c]) {
      expect(p.listExpenses().map((e) => e.title)).toEqual(["Pizza", "Beer"]);
      expect(balancesOf(p)).toEqual(balancesOf(a));
    }
  });

  // MANUAL A5
  it("A5 — a peer that was closed catches up with everything it missed", () => {
    const [a, b, c] = peers(); // c is "closed" from here on
    a.addExpense(
      expense("001", { title: "Pizza", payerId: "a@x.de", split: evenThree() }),
    );
    b.addExpense(
      expense("002", {
        title: "Beer",
        amountCents: 1200,
        payerId: "b@x.de",
        createdBy: "b@x.de",
        split: evenThree(),
      }),
    );
    a.addSettlement({
      id: "s1",
      fromId: "b@x.de",
      toId: "a@x.de",
      amountCents: 400,
      date: "2026-07-30",
      createdBy: "a@x.de",
    });
    sync(a, b);

    syncAll([a, b, c]); // c reopens

    expect(c.listExpenses()).toEqual(a.listExpenses());
    expect(c.listSettlements()).toEqual(a.listSettlements());
    expect(balancesOf(c)).toEqual(balancesOf(a));
  });

  // MANUAL A6
  it("A6 — the extra cent of €10.00 between three lands on the same member everywhere", () => {
    const [a, b, c] = peers();
    a.addExpense(
      expense("001", {
        title: "Coffee",
        amountCents: 1000,
        payerId: "a@x.de",
        split: evenThree(),
      }),
    );

    syncAll([a, b, c]);

    // Shares are 3.34 / 3.33 / 3.33 — the extra cent to the lowest id, so the
    // payer (who is that lowest id) is owed 10.00 - 3.34.
    for (const p of [a, b, c]) {
      expect(balancesOf(p)).toEqual({
        "a@x.de": 666,
        "b@x.de": -333,
        "c@x.de": -333,
      });
    }
  });

  // MANUAL A7
  it("A7 — a settlement covering a suggested transfer removes it on every peer", () => {
    const [a, b, c] = peers();
    a.addExpense(
      expense("001", {
        title: "Coffee",
        amountCents: 1000,
        payerId: "a@x.de",
        split: evenThree(),
      }),
    );
    syncAll([a, b, c]);

    const target = transfersOf(b)[0];
    expect(transfersOf(a)).toHaveLength(2);
    b.addSettlement({
      id: "s1",
      fromId: target.fromId,
      toId: target.toId,
      amountCents: target.amountCents,
      date: "2026-07-30",
      createdBy: target.fromId,
    });

    syncAll([a, b, c]);

    for (const p of [a, b, c]) {
      expect(transfersOf(p)).toEqual(transfersOf(a));
      expect(transfersOf(p)).not.toContainEqual(target);
    }
    expect(transfersOf(a)).toHaveLength(1); // the other debtor still owes
  });

  // MANUAL CM1
  it("CM1 — a virtual member added on one peer is a usable payer on all of them", () => {
    const [a, b, c] = peers();
    const gran = a.addVirtualMember("Grandma", 1);
    syncAll([a, b, c]);
    for (const p of [a, b, c]) {
      expect(p.getMember(gran.id)?.name).toBe("Grandma");
    }

    b.addExpense(
      expense("001", {
        title: "Cake",
        amountCents: 900,
        payerId: gran.id,
        createdBy: "b@x.de",
        split: {
          mode: "even",
          entries: { [gran.id]: 1, "a@x.de": 1, "b@x.de": 1 },
        },
      }),
    );
    syncAll([a, b, c]);

    for (const p of [a, b, c]) {
      expect(balancesOf(p)[gran.id]).toBe(600);
      expect(balancesOf(p)).toEqual(balancesOf(a));
    }
  });
});

describe("payment profiles across peers", () => {
  // MANUAL C1
  it("C1 — a profile filled in on one peer is what the other peer offers to pay", () => {
    const [a, b] = peers();
    b.setProfile("b@x.de", { paypalMe: "bob", note: "IBAN please" });

    sync(a, b);

    const seen = a.getProfile("b@x.de");
    expect(seen).toEqual(b.getProfile("b@x.de"));
    expect(
      paymentMethodsFor(seen ?? {}, 2350, "EUR", "Halvsies").map((m) => m.url),
    ).toEqual(["https://paypal.me/bob/23.50EUR"]);
  });
});

// The chat lines, through the real editInfo() the provider calls on flush —
// not describeChange() alone, which cannot show where the numbers come from.
describe("chat info lines", () => {
  /** Simon's peer, with Anna in the group and an empty ledger. */
  function group(): { s: Store; annaId: MemberId } {
    const s = createDoc();
    s.registerSelf("simon@x.de", "Simon");
    return { s, annaId: s.addVirtualMember("Anna", 1).id };
  }

  const pizza = (annaId: MemberId): Expense =>
    expense("001", {
      title: "Pizza",
      amountCents: 3000,
      payerId: "simon@x.de",
      createdBy: "simon@x.de",
      split: { mode: "even", entries: { "simon@x.de": 1, [annaId]: 1 } },
    });

  // MANUAL B1
  it("B1 — an added expense posts who added what, and for how much", () => {
    const { s, annaId } = group();
    s.addExpense(pizza(annaId));

    expect(s.editInfo().startinfo).toBe(`Simon added *Pizza* — ${eur(3000)}`);
  });

  // MANUAL B2 — the summary is derived here, on the flush the write itself
  // triggers. Nothing in this test renders the Balances screen, which is
  // exactly the bug it pins (a counter only that screen used to set).
  it("B2 — the summary counts the open debt immediately, with no Balances screen involved", () => {
    const { s, annaId } = group();
    expect(s.editInfo().summary).toBe("All settled up");

    s.addExpense(pizza(annaId));

    expect(s.editInfo().summary).toBe(`1 open debt · ${eur(1500)}`);
  });

  // MANUAL B3
  it("B3 — marking a payment posts who paid whom", () => {
    const { s, annaId } = group();
    s.addSettlement({
      id: "s1",
      fromId: "simon@x.de",
      toId: annaId,
      amountCents: 2350,
      date: "2026-07-30",
      createdBy: "simon@x.de",
    });

    expect(s.editInfo().startinfo).toBe(`Simon paid Anna ${eur(2350)}`);
  });
});

describe("snapshots", () => {
  // MANUAL E1
  it("round-trips a full document into an empty one", () => {
    const a = createDoc();
    a.setSettings({ groupCurrency: "EUR", title: "Rome trip" });
    a.registerSelf("a@x.de", "Anna");
    a.addVirtualMember("Grandma", 1_700_000_000_000);
    a.setProfile("a@x.de", {
      iban: "DE02120300000000202051",
      accountHolder: "Anna",
      customs: [
        {
          id: "c1",
          label: "Twint",
          urlTemplate: "https://pay.example/{amount}",
        },
      ],
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
              customs: [
                { id: "c1", label: "x", urlTemplate: "javascript:evil()" },
              ],
            },
          },
        }),
      ),
    ).toThrow(/http/);
    // nothing was written by any failed import
    expect(s.listExpenses()).toEqual([]);
  });

  // MANUAL E2 — a negative amount invents a reversed debt on every peer, so
  // the file is refused whole; the existing ledger must survive intact.
  it("E2 — refuses a hand-edited negative amountCents and leaves the ledger untouched", () => {
    const s = createDoc();
    s.setSettings({ title: "Rome trip" });
    s.addExpense(expense("001", { title: "Pizza" }));
    const before = s.listExpenses();

    const tampered = JSON.parse(s.exportSnapshot()) as {
      expenses: Record<string, Expense>;
    };
    tampered.expenses["001"].amountCents = -5000;

    expect(() => s.importSnapshot(JSON.stringify(tampered))).toThrow(
      /more than zero/i,
    );
    expect(s.listExpenses()).toEqual(before);
    expect(s.getSettings().title).toBe("Rome trip");
  });
});

describe("payment-details-only export", () => {
  const anna = (): Store => {
    const a = createDoc();
    a.registerSelf("a@x.de", "Anna");
    a.setProfile("a@x.de", {
      paypalMe: "anna",
      note: "IBAN please",
      customs: [
        {
          id: "c1",
          label: "Twint",
          urlTemplate: "https://twint.example/{amount}",
        },
        {
          id: "c2",
          label: "PayNow",
          urlTemplate: "https://paynow.example/{ref}",
        },
      ],
    });
    return a;
  };

  // MANUAL E4 (first half: the file carries your links into another group)
  it("round-trips a profile with several custom links into another group", () => {
    const a = anna();
    const file = a.exportOwnProfile();
    expect(Object.keys(JSON.parse(file))).toEqual(["profile"]);

    const b = createDoc();
    b.registerSelf("b@x.de", "Bob");
    b.importOwnProfile(file);

    expect(b.getProfile("b@x.de")).toEqual(a.getProfile("a@x.de"));
    expect(b.getProfile("b@x.de")!.customs).toHaveLength(2);
    // Written to the local member id only — never the exporter's.
    expect(b.getProfile("a@x.de")).toBeUndefined();
  });

  // MANUAL E4 (second half: group B's expenses are untouched)
  it("leaves the ledger alone, unlike a full restore", () => {
    const b = createDoc();
    b.registerSelf("b@x.de", "Bob");
    b.setSettings({ title: "Rome trip" });
    b.addExpense(expense("001", { title: "Pizza" }));

    b.importOwnProfile(anna().exportOwnProfile());

    expect(b.listExpenses().map((e) => e.title)).toEqual(["Pizza"]);
    expect(b.getSettings().title).toBe("Rome trip");
    expect(b.listMembers().map((m) => m.id)).toEqual(["b@x.de"]);
  });

  it("still accepts a full snapshot on the same doc", () => {
    const a = anna();
    a.addExpense(expense("001", { title: "Pizza" }));

    const b = createDoc();
    b.registerSelf("b@x.de", "Bob");
    b.importOwnProfile(a.exportOwnProfile());
    b.importSnapshot(a.exportSnapshot());

    expect(b.listExpenses().map((e) => e.title)).toEqual(["Pizza"]);
    expect(b.getProfile("a@x.de")).toEqual(a.getProfile("a@x.de"));
  });

  it("rejects a hostile or malformed payment-details file", () => {
    const b = createDoc();
    b.registerSelf("b@x.de", "Bob");
    const wrap = (profile: unknown): string => JSON.stringify({ profile });

    expect(() =>
      b.importOwnProfile(
        wrap({
          customs: [{ id: "c", label: "x", urlTemplate: "javascript:evil()" }],
        }),
      ),
    ).toThrow(/http\(s\)/i);
    expect(() => b.importOwnProfile("not json")).toThrow(/not valid JSON/);
    expect(() => b.importOwnProfile('{"members":{}}')).toThrow(
      /does not contain payment details/,
    );
    expect(() => b.importOwnProfile(wrap("nope"))).toThrow(/not an object/);
    expect(() =>
      b.importOwnProfile(wrap({ customs: [{ label: "x" }] })),
    ).toThrow(/invalid custom payment method/);
    expect(b.getProfile("b@x.de")).toBeUndefined();
  });
});

describe("removing members", () => {
  // MANUAL CM2 (the ledger-level guard; MembersSheet's disabled button and
  // its reason are asserted in render.test.tsx)
  it("refuses while the ledger still references them, then allows it", () => {
    const s = createDoc();
    const gran = s.addVirtualMember("Grandma", 1);
    s.addExpense(
      expense("e1", {
        payerId: gran.id,
        split: { mode: "even", entries: { [gran.id]: 1, "b@x.de": 1 } },
      }),
    );

    expect(s.removeMember(gran.id)).toMatch(/paid for 1 expense/);
    expect(s.removeMember(gran.id)).toMatch(/is in 1 split/);
    expect(s.getMember(gran.id)).toBeDefined();

    s.deleteExpense("e1");
    expect(s.removeMember(gran.id)).toBeNull();
    expect(s.getMember(gran.id)).toBeUndefined();
  });

  it("blocks on a settlement too, and takes the profile with the member", () => {
    const s = createDoc();
    const gran = s.addVirtualMember("Grandma", 1);
    s.setProfile(gran.id, { note: "cash only" });
    s.addSettlement({
      id: "s1",
      fromId: "b@x.de",
      toId: gran.id,
      amountCents: 500,
      date: "2026-07-30",
      createdBy: "b@x.de",
    });

    expect(s.removeMember(gran.id)).toMatch(/1 recorded payment/);

    // A settlement can't be deleted, so remove one that never had any.
    const other = s.addVirtualMember("Nobody", 2);
    s.setProfile(other.id, { note: "x" });
    expect(s.removeMember(other.id)).toBeNull();
    expect(s.getProfile(other.id)).toBeUndefined();
  });

  it("is a no-op for an id that isn't a member", () => {
    const s = createDoc();
    expect(s.removeMember("ghost@x.de")).toBeNull();
  });

  // MANUAL CM3
  it("CM3 — a removal reaches every peer, and the balances still sum to zero", () => {
    const [a, b, c] = peers();
    const gran = a.addVirtualMember("Grandma", 1);
    a.addExpense(
      expense("001", {
        title: "Cake",
        amountCents: 900,
        payerId: "a@x.de",
        split: evenThree(),
      }),
    );
    syncAll([a, b, c]);
    expect(c.getMember(gran.id)).toBeDefined();

    expect(a.removeMember(gran.id)).toBeNull();
    syncAll([a, b, c]);

    for (const p of [a, b, c]) {
      expect(p.getMember(gran.id)).toBeUndefined();
      expect(p.listMembers()).toEqual(a.listMembers());
      const sum = Object.values(balancesOf(p)).reduce((s, n) => s + n, 0);
      expect(sum).toBe(0);
    }
  });

  it("propagates the removal to other peers", () => {
    const a = createDoc();
    const b = createDoc();
    const gran = a.addVirtualMember("Grandma", 1);
    sync(a, b);
    expect(b.getMember(gran.id)).toBeDefined();

    a.removeMember(gran.id);
    sync(a, b);
    expect(b.getMember(gran.id)).toBeUndefined();
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
