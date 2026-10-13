// Who may edit whom on the members screen. The rule: only manually-added
// ("virtual") members can be renamed or removed. A real member is someone
// actually in the Delta Chat group — their name is the messenger's to report
// (registerSelf re-syncs it) and they stay in the split.
//
// Everything here goes through the store API rather than MembersSheet on
// purpose: the guard has to live in the writer, or a peer on an older build
// (which still renders the old buttons) would smuggle the change into the
// shared document anyway.
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { netBalances } from "../src/state/balances";
import { createDoc, type Store } from "../src/state/doc";
import type { Expense } from "../src/state/model";

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

describe("virtual members are editable", () => {
  it("renames and removes one", () => {
    const s = createDoc();
    const gran = s.addVirtualMember("Grandma", 1);

    expect(s.renameMember(gran.id, "Oma")).toBeNull();
    expect(s.getMember(gran.id)?.name).toBe("Oma");

    expect(s.removeMember(gran.id)).toBeNull();
    expect(s.getMember(gran.id)).toBeUndefined();
  });

  it("refuses an empty name and keeps the old one", () => {
    const s = createDoc();
    const gran = s.addVirtualMember("Grandma", 1);

    expect(s.renameMember(gran.id, "   ")).toMatch(/cannot be empty/);
    expect(s.getMember(gran.id)?.name).toBe("Grandma");
  });

  it("still blocks removal while the ledger references them", () => {
    const s = createDoc();
    const gran = s.addVirtualMember("Grandma", 1);
    s.addExpense(
      expense("e1", {
        payerId: gran.id,
        split: { mode: "even", entries: { [gran.id]: 1, "b@x.de": 1 } },
      }),
    );

    expect(s.removeMember(gran.id)).toMatch(/paid for 1 expense/);
    expect(s.getMember(gran.id)).toBeDefined();

    // A ledger reference is the fixable gate: clear it and the removal lands.
    s.deleteExpense("e1");
    expect(s.removeMember(gran.id)).toBeNull();
    expect(s.getMember(gran.id)).toBeUndefined();
  });
});

describe("real members are not", () => {
  it("refuses to rename one and leaves the stored name untouched", () => {
    const s = createDoc();
    s.registerSelf("a@x.de", "Anna");

    expect(s.renameMember("a@x.de", "Not Anna")).toMatch(
      /comes from Delta Chat/,
    );
    expect(s.getMember("a@x.de")?.name).toBe("Anna");
  });

  it("refuses to remove one", () => {
    const s = createDoc();
    s.registerSelf("a@x.de", "Anna");

    expect(s.removeMember("a@x.de")).toMatch(/in this chat/);
    expect(s.getMember("a@x.de")).toBeDefined();
  });

  it("reports being in the chat, not the ledger reference, when both apply", () => {
    const s = createDoc();
    s.registerSelf("a@x.de", "Anna");
    s.addExpense(expense("e1")); // Anna paid for it

    // The gate no edit can clear wins: telling the user to delete the expense
    // first would be a lie, since it still wouldn't let them remove Anna.
    expect(s.removeMember("a@x.de")).toMatch(/in this chat/);
    expect(s.removeMember("a@x.de")).not.toMatch(/paid for/);
    expect(s.getMember("a@x.de")).toBeDefined();
  });

  it("is a no-op with no reason for an id that isn't a member", () => {
    const s = createDoc();
    expect(s.renameMember("ghost@x.de", "Ghost")).toBeNull();
    expect(s.removeMember("ghost@x.de")).toBeNull();
  });

  // The point of putting the guard in the writer: a peer that still renders
  // the old editable row calls the same function, so nothing lands in the
  // shared document for the other peers to merge.
  it("cannot be smuggled in from another peer", () => {
    const a = createDoc();
    const b = createDoc();
    a.registerSelf("a@x.de", "Anna");
    b.registerSelf("b@x.de", "Bob");
    sync(a, b);

    // Bob's peer tries both edits against Anna, the way a stale screen would.
    expect(b.renameMember("a@x.de", "Idiot")).not.toBeNull();
    expect(b.removeMember("a@x.de")).not.toBeNull();
    sync(a, b);

    for (const p of [a, b]) {
      expect(p.getMember("a@x.de")?.name).toBe("Anna");
      expect(p.listMembers().map((m) => m.name)).toEqual(["Anna", "Bob"]);
    }
  });
});

describe("registerSelf keeps the host's name in sync", () => {
  it("adopts a name the user changed in Delta Chat", () => {
    const s = createDoc();
    s.registerSelf("a@x.de", "Anna");

    expect(s.registerSelf("a@x.de", "Anna B.").name).toBe("Anna B.");
    expect(s.getMember("a@x.de")?.name).toBe("Anna B.");
    expect(s.listMembers()).toHaveLength(1); // re-synced, not re-added
  });

  it("writes nothing when the name has not changed", () => {
    const s = createDoc();
    s.registerSelf("a@x.de", "Anna");

    // Opening the app must not emit a CRDT update (and so a chat flush) just
    // for saying hello again.
    let updates = 0;
    const stop = s.subscribe(() => updates++);
    s.registerSelf("a@x.de", "Anna");
    s.registerSelf("a@x.de", "Anna");
    stop();

    expect(updates).toBe(0);
  });

  it("does not overwrite a real name when the host reports nothing useful", () => {
    const s = createDoc();
    s.registerSelf("a@x.de", "Anna");

    // ensureSelfRegistered passes `host.selfName || host.selfAddr`, so a host
    // with no display name hands us the address — which is not a rename.
    expect(s.registerSelf("a@x.de", "a@x.de").name).toBe("Anna");
    expect(s.registerSelf("a@x.de", "").name).toBe("Anna");
    expect(s.getMember("a@x.de")?.name).toBe("Anna");
  });

  it("upgrades an address-shaped placeholder once the host has a name", () => {
    const s = createDoc();
    // First open on a host with no selfName.
    expect(s.registerSelf("a@x.de", "a@x.de").name).toBe("a@x.de");

    expect(s.registerSelf("a@x.de", "Anna").name).toBe("Anna");
    expect(s.getMember("a@x.de")?.name).toBe("Anna");
  });

  it("only ever touches the caller's own entry", () => {
    const a = createDoc();
    const b = createDoc();
    a.registerSelf("a@x.de", "Anna");
    b.registerSelf("b@x.de", "Bob");
    const gran = a.addVirtualMember("Grandma", 1);
    sync(a, b);

    b.registerSelf("b@x.de", "Bobby");
    sync(a, b);

    expect(a.getMember("a@x.de")?.name).toBe("Anna");
    expect(a.getMember("b@x.de")?.name).toBe("Bobby");
    expect(a.getMember(gran.id)?.name).toBe("Grandma");
    expect(a.listMembers()).toEqual(b.listMembers());
  });
});

describe("claiming a member", () => {
  it("folds Grandma's expenses, shares and payments into you", () => {
    const s = createDoc();
    s.registerSelf("anna@x", "Anna");
    s.registerSelf("bob@x", "Bob"); // second peer's entry, same doc for brevity
    s.registerSelf("anna@x", "Anna");
    const gran = s.addVirtualMember("Grandma", 1);
    const g = gran.id;
    s.addExpense(
      expense("e1", {
        payerId: g,
        createdBy: g,
        split: { mode: "even", entries: { [g]: 1, "anna@x": 1, "bob@x": 1 } },
      }),
    );
    s.addExpense(
      expense("e2", {
        payerId: "bob@x",
        split: { mode: "exact", entries: { [g]: 1000, "bob@x": 2000 } },
      }),
    );
    s.addSettlement({
      id: "s1",
      fromId: g,
      toId: "anna@x",
      amountCents: 500,
      date: "",
      createdBy: "anna@x",
    });
    const ids = () => s.listMembers().map((m) => m.id);
    const before = netBalances(s.listExpenses(), s.listSettlements(), ids());

    expect(s.claimMember(g)).toBeNull();

    expect(ids()).not.toContain(g); // a hidden tombstone now
    const [e1, e2] = s.listExpenses();
    expect(e1.payerId).toBe("anna@x");
    expect(e1.createdBy).toBe("anna@x");
    expect(e1.split).toEqual({
      mode: "weights",
      entries: { "anna@x": 2, "bob@x": 1 },
    });
    expect(e2.split.entries).toEqual({ "anna@x": 1000, "bob@x": 2000 });
    expect(s.listSettlements()).toEqual([]); // Grandma paying Anna nets out
    const after = netBalances(s.listExpenses(), s.listSettlements(), ids());
    expect(after["anna@x"]).toBe(before["anna@x"] + before[g]);
    expect(after["bob@x"]).toBe(before["bob@x"]);
  });

  it("refuses real members and yourself", () => {
    const s = createDoc();
    s.registerSelf("bob@x", "Bob");
    s.registerSelf("anna@x", "Anna");
    expect(s.claimMember("bob@x")).toMatch(/only someone/);
    expect(s.claimMember("anna@x")).toMatch(/only someone/);
    expect(s.getMember("bob@x")).toBeDefined();
  });

  it("import from another instance leaves everyone claimable but you", () => {
    const old = createDoc();
    old.registerSelf("old-anna", "Anna");
    old.registerSelf("old-bob", "Bob");
    const snap = old.exportSnapshot();

    const s = createDoc();
    s.registerSelf("new-anna", "Anna");
    s.importSnapshot(snap);
    expect(s.getMember("old-anna")?.isVirtual).toBe(true);
    expect(s.getMember("old-bob")?.isVirtual).toBe(true);
    expect(s.getMember("new-anna")?.isVirtual).toBe(false); // re-added
    expect(s.claimMember("old-anna")).toBeNull();
    expect(s.listMembers().map((m) => m.id)).toEqual(["new-anna", "old-bob"]);
  });

  it("an untitled backup still marks the group as set up", () => {
    const s = createDoc();
    s.importSnapshot("{}");
    expect(s.getSettings().title).toBe("");
  });

  it("restore into the same instance leaves live members unclaimable", () => {
    const s = createDoc();
    s.registerSelf("bob@x", "Bob");
    s.registerSelf("anna@x", "Anna");
    s.importSnapshot(s.exportSnapshot());
    expect(s.getMember("anna@x")?.isVirtual).toBe(false);
    expect(s.getMember("bob@x")?.isVirtual).toBe(false);
    expect(s.claimMember("bob@x")).toMatch(/only someone/);
  });

  it("someone who wasn't here at import turns real again on their open", () => {
    const old = createDoc();
    old.registerSelf("bob@x", "Bob");
    const s = createDoc();
    s.importSnapshot(old.exportSnapshot()); // first run: nobody registered
    expect(s.getMember("bob@x")?.isVirtual).toBe(true);
    s.registerSelf("bob@x", "Bob");
    expect(s.getMember("bob@x")?.isVirtual).toBe(false);
  });

  it("an imported addr can't make a stranger real", () => {
    const s = createDoc();
    s.registerSelf("anna@x", "Anna");
    s.importSnapshot(
      JSON.stringify({
        members: { ghost: { id: "ghost", name: "Bob", addr: "anna@x" } },
      }),
    );
    expect(s.getMember("ghost")?.isVirtual).toBe(true);
  });

  it('ignores inherited keys like "constructor" as member ids', () => {
    const s = createDoc();
    s.registerSelf("me@x", "Me");
    s.importSnapshot(
      JSON.stringify({
        members: {
          c: { id: "constructor", name: "Old", addr: "x" },
          b: { id: "b@x", name: "B" },
        },
        expenses: {
          e: expense("e", {
            payerId: "b@x",
            createdBy: "b@x",
            split: { mode: "exact", entries: { "b@x": 3000 } },
          }),
        },
      }),
    );
    expect(s.claimMember("constructor")).toBeNull();
    expect(s.listExpenses()[0].split.entries).toEqual({ "b@x": 3000 });
  });

  it("keeps even-split semantics whatever the stored values", () => {
    const s = createDoc();
    s.registerSelf("anna@x", "Anna");
    const g = s.addVirtualMember("Grandma", 1).id;
    s.addExpense(
      expense("e", {
        amountCents: 900,
        payerId: "bob@x",
        split: { mode: "even", entries: { [g]: 5, "bob@x": 0, "c@x": 1 } },
      }),
    );
    s.claimMember(g);
    const [e] = s.listExpenses();
    expect(e.split).toEqual({
      mode: "even",
      entries: { "anna@x": 1, "bob@x": 1, "c@x": 1 },
    });
  });

  it("moves their recorded payments to you; their details on request", () => {
    const s = createDoc();
    s.registerSelf("anna@x", "Anna");
    const g = s.addVirtualMember("Grandma", 1).id;
    s.setProfile(g, { paypalMe: "grandma" });
    s.addSettlement({
      id: "s1",
      fromId: "bob@x",
      toId: g,
      amountCents: 500,
      date: "",
      createdBy: g,
    });
    s.claimMember(g);
    // Not copied: parked on the tombstone until you say they are yours.
    expect(s.getProfile("anna@x")).toBeUndefined();
    expect(s.getProfile(g)).toEqual({ paypalMe: "grandma" });
    s.keepClaimedProfile(g, true);
    expect(s.getProfile("anna@x")).toEqual({ paypalMe: "grandma" });
    expect(s.getProfile(g)).toBeUndefined();
    expect(s.listSettlements()[0]).toMatchObject({
      fromId: "bob@x",
      toId: "anna@x",
      createdBy: "anna@x",
    });
    expect(s.getMember("anna@x")?.claimAsked).toBe(true);
  });

  it("discarding their payment details leaves yours empty", () => {
    const s = createDoc();
    s.registerSelf("anna@x", "Anna");
    const g = s.addVirtualMember("Grandma", 1).id;
    s.setProfile(g, { iban: "DE02120300000000202051" });
    s.claimMember(g);
    s.keepClaimedProfile(g, false);
    expect(s.getProfile("anna@x")).toBeUndefined();
    expect(s.getProfile(g)).toBeUndefined();
  });

  it("never offers their details over your own", () => {
    const s = createDoc();
    s.registerSelf("anna@x", "Anna");
    s.setProfile("anna@x", { paypalMe: "anna" });
    const g = s.addVirtualMember("Grandma", 1).id;
    s.setProfile(g, { paypalMe: "grandma" });
    s.claimMember(g);
    expect(s.getProfile(g)).toBeUndefined(); // dropped at the claim
    s.keepClaimedProfile(g, true); // a stale screen can't sneak them in
    expect(s.getProfile("anna@x")).toEqual({ paypalMe: "anna" });
  });

  it("only the claimer can take a parked profile", () => {
    const s = createDoc();
    s.registerSelf("anna@x", "Anna");
    const g = s.addVirtualMember("Grandma", 1).id;
    s.setProfile(g, { paypalMe: "grandma" });
    s.keepClaimedProfile(g, true); // not merged into anyone yet
    expect(s.getProfile("anna@x")).toBeUndefined();
  });

  it("exports the ledger as it reads: no tombstones, claims resolved", () => {
    const s = createDoc();
    s.registerSelf("anna@x", "Anna");
    const g = s.addVirtualMember("Grandma", 1).id;
    s.addExpense(expense("e", { payerId: g, createdBy: g }));
    s.claimMember(g);
    const snap = JSON.parse(s.exportSnapshot());
    expect(Object.keys(snap.members)).toEqual(["anna@x"]);
    expect(snap.expenses.e.payerId).toBe("anna@x");
  });
});

describe("claim prompt answer", () => {
  it("is stored on your own entry, survives re-registering, and syncs", () => {
    const a = createDoc();
    a.registerSelf("anna@x", "Anna");
    a.markClaimAsked();
    a.registerSelf("anna@x", "Anna Renamed");
    expect(a.getMember("anna@x")).toMatchObject({
      name: "Anna Renamed",
      claimAsked: true,
    });

    const other = createDoc();
    sync(a, other);
    expect(other.getMember("anna@x")?.claimAsked).toBe(true);
  });
});

describe("claims across peers", () => {
  /** An imported ledger nobody here has claimed yet, on two peers. */
  function importedOnTwoPeers(): { a: Store; b: Store } {
    const old = createDoc();
    old.registerSelf("old-a", "A");
    old.registerSelf("old-b", "B");
    old.addExpense(
      expense("e1", {
        payerId: "old-a",
        createdBy: "old-a",
        split: { mode: "even", entries: { "old-a": 1, "old-b": 1 } },
      }),
    );
    const a = createDoc();
    a.registerSelf("a@x", "A");
    a.importSnapshot(old.exportSnapshot());
    const b = createDoc();
    sync(a, b);
    b.registerSelf("b@x", "B");
    sync(a, b);
    return { a, b };
  }
  const balances = (s: Store): Record<string, number> =>
    netBalances(
      s.listExpenses(),
      s.listSettlements(),
      s.listMembers().map((m) => m.id),
    );

  it("two people claiming different members at once both land", () => {
    const { a, b } = importedOnTwoPeers();
    a.claimMember("old-a");
    b.claimMember("old-b");
    sync(a, b);
    for (const s of [a, b]) {
      expect(s.listMembers().map((m) => m.id)).toEqual(["a@x", "b@x"]);
      expect(balances(s)).toEqual({ "a@x": 1500, "b@x": -1500 });
    }
  });

  it("an expense added concurrently with a claim still lands on the claimer", () => {
    const { a, b } = importedOnTwoPeers();
    a.claimMember("old-b");
    b.addExpense(
      expense("e2", {
        payerId: "a@x",
        createdBy: "b@x",
        split: { mode: "exact", entries: { "old-b": 3000 } },
      }),
    );
    sync(a, b);
    expect(balances(a)).toEqual(balances(b));
    // e2 is old-b's share paid by a@x — a@x claimed old-b, so it nets out.
    expect(balances(a)).toEqual({ "a@x": -1500, "b@x": 0, "old-a": 1500 });
  });

  it("two people claiming the same member at once agree on who got them", () => {
    const { a, b } = importedOnTwoPeers();
    a.claimMember("old-a");
    b.claimMember("old-a");
    sync(a, b);
    expect(a.getMember("old-a")?.mergedInto).toBe(
      b.getMember("old-a")?.mergedInto,
    );
    expect(balances(a)).toEqual(balances(b));
  });
});

describe("merge marks that must not stick", () => {
  it("reopening the app undoes a wrong merge of a real member", () => {
    const s = createDoc();
    s.registerSelf("mallory@x", "Mallory");
    s.registerSelf("bob@x", "Bob");
    s.addExpense(expense("e", { payerId: "bob@x", createdBy: "bob@x" }));
    // A peer's raw write (or a mistaken claim after an import).
    const bob = s.getMember("bob@x")!;
    s.doc.getMap("members").set("bob@x", { ...bob, mergedInto: "mallory@x" });
    expect(s.listMembers().map((m) => m.id)).not.toContain("bob@x");

    s.registerSelf("bob@x", "Bob"); // Bob opens the app
    expect(s.getMember("bob@x")?.mergedInto).toBeUndefined();
    expect(s.listExpenses()[0].payerId).toBe("bob@x");
  });

  it("ignores a mark that points at nobody on file", () => {
    const s = createDoc();
    s.registerSelf("anna@x", "Anna");
    const g = s.addVirtualMember("Grandma", 1);
    s.addExpense(
      expense("e", {
        payerId: g.id,
        createdBy: g.id,
        split: { mode: "even", entries: { [g.id]: 1, "anna@x": 1 } },
      }),
    );
    for (const target of ["constructor", "__proto__", "stranger"]) {
      s.doc.getMap("members").set(g.id, { ...g, mergedInto: target });
      const ids = s.listMembers().map((m) => m.id);
      const b = netBalances(s.listExpenses(), s.listSettlements(), ids);
      expect(Object.values(b).reduce((x, y) => x + y, 0)).toBe(0);
      expect(s.listExpenses()[0].payerId).toBe(g.id);
    }
  });

  it("a merged member can't be removed or renamed", () => {
    const s = createDoc();
    s.registerSelf("anna@x", "Anna");
    const g = s.addVirtualMember("Grandma", 1).id;
    s.claimMember(g);
    s.removeMember(g);
    s.renameMember(g, "Oma");
    expect(s.getMember(g)).toMatchObject({
      name: "Grandma",
      mergedInto: "anna@x",
    });
  });

  it("backups leave out payment details parked on a merged member", () => {
    const s = createDoc();
    s.registerSelf("anna@x", "Anna");
    const g = s.addVirtualMember("Grandma", 1).id;
    s.setProfile(g, { paypalMe: "grandma" });
    s.claimMember(g); // parked, not yet answered
    expect(JSON.parse(s.exportSnapshot()).profiles).toEqual({});
  });

  it("keeping parked details never overwrites ones you added meanwhile", () => {
    const s = createDoc();
    s.registerSelf("anna@x", "Anna");
    const g = s.addVirtualMember("Grandma", 1).id;
    s.setProfile(g, { paypalMe: "grandma" });
    s.claimMember(g);
    s.setProfile("anna@x", { paypalMe: "anna" }); // e.g. another device
    s.keepClaimedProfile(g, true);
    expect(s.getProfile("anna@x")).toEqual({ paypalMe: "anna" });
  });

  it("a replace import keeps people who are in the chat right now", () => {
    const old = createDoc();
    old.registerSelf("old-a", "A");
    const s = createDoc();
    s.registerSelf("ben@x", "Ben");
    s.markClaimAsked();
    s.registerSelf("anna@x", "Anna");
    s.importSnapshot(old.exportSnapshot());
    expect(s.getMember("ben@x")).toMatchObject({ isVirtual: false });
    // Asked afresh: this ledger is new to everyone.
    expect(s.getMember("ben@x")?.claimAsked).toBeUndefined();
    expect(s.getMember("old-a")?.isVirtual).toBe(true);
  });
});
