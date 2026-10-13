// When "Were you in this group before?" asks, and whom it offers. The rules
// live in a pure function so they can be pinned without a webxdc host.
import { describe, expect, it } from "vitest";
import { promptCandidates } from "../src/ui/ClaimPrompt";
import {
  hasPaymentDetails,
  type Expense,
  type Member,
} from "../src/state/model";

const member = (id: string, name: string, over: Partial<Member> = {}) => ({
  id,
  name,
  isVirtual: true,
  addr: id,
  ...over,
});
const me = member("me@x", "Anna", { isVirtual: false });
const oldAnna = member("old-anna", "anna "); // same name, other case/space
const oldBob = member("old-bob", "Bob");
const grandma = member("0001", "Grandma", { addr: undefined });

const names = (ms: Member[]): string[] => ms.map((m) => m.id);

describe("promptCandidates", () => {
  it("offers imported people, same name first, never yourself", () => {
    expect(
      names(promptCandidates("me@x", [oldBob, me, oldAnna], [], [])),
    ).toEqual(["old-anna", "old-bob"]);
  });

  it("stays quiet once you answered", () => {
    const answered = { ...me, claimAsked: true };
    expect(promptCandidates("me@x", [answered, oldBob], [], [])).toEqual([]);
  });

  it("stays quiet once an expense names you", () => {
    const e: Expense = {
      id: "e",
      title: "Pizza",
      amountCents: 1000,
      payerId: "old-bob",
      split: { mode: "even", entries: { "me@x": 1, "old-bob": 1 } },
      date: "",
      createdBy: "old-bob",
      editedAt: 0,
    };
    expect(promptCandidates("me@x", [me, oldBob], [e], [])).toEqual([]);
  });

  it("stays quiet once a recorded payment names you", () => {
    const paid = {
      id: "s",
      fromId: "me@x",
      toId: "old-bob",
      amountCents: 500,
      date: "",
      createdBy: "me@x",
    };
    expect(promptCandidates("me@x", [me, oldBob], [], [paid])).toEqual([]);
  });

  it("never asks about hand-added people", () => {
    expect(promptCandidates("me@x", [me, grandma], [], [])).toEqual([]);
  });

  it("asks nothing before you are registered", () => {
    expect(promptCandidates(undefined, [oldBob], [], [])).toEqual([]);
  });
});

describe("hasPaymentDetails", () => {
  it("doesn't count fields that only qualify another one", () => {
    expect(hasPaymentDetails({ preferred: "paypal" })).toBe(false);
    expect(hasPaymentDetails({ accountHolder: "Anna", bic: "X" })).toBe(false);
    expect(hasPaymentDetails({ note: "cash only" })).toBe(true);
    expect(hasPaymentDetails({ customs: [] })).toBe(false);
  });
});
