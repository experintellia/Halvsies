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
