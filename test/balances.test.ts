import { describe, it, expect } from "vitest";

import { netBalances, splitShares, validateSplit } from "../src/state/balances";
import type { Expense, MemberId, Settlement, Split } from "../src/state/model";

const NOBODY: MemberId[] = [];

function expense(
  id: string,
  amountCents: number,
  payerId: MemberId,
  split: Split,
): Expense {
  return {
    id,
    title: id,
    amountCents,
    payerId,
    split,
    date: "2026-07-30",
    createdBy: payerId,
    editedAt: 0,
  };
}

function settlement(
  id: string,
  fromId: MemberId,
  toId: MemberId,
  amountCents: number,
): Settlement {
  return {
    id,
    fromId,
    toId,
    amountCents,
    date: "2026-07-30",
    createdBy: fromId,
  };
}

function sum(record: Record<string, number>): number {
  return Object.keys(record).reduce((acc, k) => acc + record[k], 0);
}

/** Deterministic PRNG (mulberry32) so a failing property case reproduces. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("splitShares — even", () => {
  it("gives leftover cents to the lowest ids", () => {
    const shares = splitShares(
      expense("e1", 100, "a", { mode: "even", entries: { a: 0, b: 0, c: 0 } }),
      NOBODY,
    );
    expect(shares).toEqual({ a: 34, b: 33, c: 33 });
    expect(sum(shares)).toBe(100);
  });

  it("is independent of key insertion order (cross-peer determinism)", () => {
    // 1000 / 7 = 142 each, 6 cents left over → the six lowest ids get one.
    const one = splitShares(
      expense("e1", 1000, "a", {
        mode: "even",
        entries: { anna: 0, bob: 0, cleo: 0, dan: 0, eve: 0, finn: 0, gus: 0 },
      }),
      NOBODY,
    );
    const other = splitShares(
      expense("e1", 1000, "a", {
        mode: "even",
        entries: { gus: 0, cleo: 0, finn: 0, anna: 0, eve: 0, dan: 0, bob: 0 },
      }),
      NOBODY,
    );
    expect(other).toEqual(one);
    expect(sum(one)).toBe(1000);
    expect(one).toEqual({
      anna: 143,
      bob: 143,
      cleo: 143,
      dan: 143,
      eve: 143,
      finn: 143,
      gus: 142,
    });
  });

  it("ignores entry values", () => {
    expect(
      splitShares(
        expense("e1", 10, "a", { mode: "even", entries: { a: 7, b: 99 } }),
        NOBODY,
      ),
    ).toEqual({ a: 5, b: 5 });
  });
});

describe("splitShares — weights", () => {
  it("sums exactly with equal weights that do not divide", () => {
    const shares = splitShares(
      expense("e1", 1000, "a", {
        mode: "weights",
        entries: { a: 1, b: 1, c: 1 },
      }),
      NOBODY,
    );
    expect(sum(shares)).toBe(1000);
    expect(shares).toEqual({ a: 334, b: 333, c: 333 });
  });

  it("sums exactly with uneven weights", () => {
    const shares = splitShares(
      expense("e1", 333, "a", { mode: "weights", entries: { a: 1, b: 2 } }),
      NOBODY,
    );
    expect(shares).toEqual({ a: 111, b: 222 });
    expect(sum(shares)).toBe(333);
  });

  it("handles fractional weights", () => {
    const shares = splitShares(
      expense("e1", 1000, "a", {
        mode: "weights",
        entries: { a: 0.5, b: 0.25, c: 1.75 },
      }),
      NOBODY,
    );
    expect(sum(shares)).toBe(1000);
    expect(shares).toEqual({ a: 200, b: 100, c: 700 });
  });

  it("falls back to an even split when all weights are zero", () => {
    const shares = splitShares(
      expense("e1", 100, "a", { mode: "weights", entries: { a: 0, b: 0 } }),
      NOBODY,
    );
    expect(shares).toEqual({ a: 50, b: 50 });
  });

  it("gives a zero weight nothing", () => {
    expect(
      splitShares(
        expense("e1", 900, "a", { mode: "weights", entries: { a: 0, b: 1 } }),
        NOBODY,
      ),
    ).toEqual({ a: 0, b: 900 });
  });
});

describe("splitShares — exact", () => {
  it("passes entries through unchanged", () => {
    const entries = { a: 700, b: 250, c: 50 };
    const e = expense("e1", 1000, "a", { mode: "exact", entries });
    expect(splitShares(e, NOBODY)).toEqual(entries);
    expect(splitShares(e, NOBODY)).not.toBe(entries);
    expect(entries).toEqual({ a: 700, b: 250, c: 50 });
  });

  it("does not repair a mismatched split", () => {
    expect(
      splitShares(
        expense("e1", 1000, "a", { mode: "exact", entries: { a: 1, b: 2 } }),
        NOBODY,
      ),
    ).toEqual({ a: 1, b: 2 });
  });
});

describe("validateSplit", () => {
  const even: Split = { mode: "even", entries: { a: 0, b: 0 } };

  it("accepts a plain even split", () => {
    expect(validateSplit(expense("e1", 100, "a", even))).toBeNull();
  });

  it("rejects non-positive or fractional amounts", () => {
    expect(validateSplit(expense("e1", 0, "a", even))).toMatch(/zero/i);
    expect(validateSplit(expense("e1", -5, "a", even))).toMatch(/zero/i);
    expect(validateSplit(expense("e1", 12.5, "a", even))).toMatch(/zero/i);
  });

  it("rejects an empty participant set", () => {
    expect(
      validateSplit(expense("e1", 100, "a", { mode: "even", entries: {} })),
    ).toMatch(/participant/i);
  });

  it("rejects a mismatched exact split", () => {
    expect(
      validateSplit(
        expense("e1", 1000, "a", {
          mode: "exact",
          entries: { a: 400, b: 400 },
        }),
      ),
    ).toMatch(/add up/i);
    expect(
      validateSplit(
        expense("e1", 1000, "a", {
          mode: "exact",
          entries: { a: 600, b: 400 },
        }),
      ),
    ).toBeNull();
  });

  it("rejects non-integer or negative exact cents", () => {
    expect(
      validateSplit(
        expense("e1", 100, "a", {
          mode: "exact",
          entries: { a: 50.5, b: 49.5 },
        }),
      ),
    ).toMatch(/whole cents/i);
    expect(
      validateSplit(
        expense("e1", 100, "a", { mode: "exact", entries: { a: -10, b: 110 } }),
      ),
    ).toMatch(/whole cents/i);
  });

  it("rejects bad weights", () => {
    expect(
      validateSplit(
        expense("e1", 100, "a", { mode: "weights", entries: { a: -1, b: 2 } }),
      ),
    ).toMatch(/weights/i);
    expect(
      validateSplit(
        expense("e1", 100, "a", {
          mode: "weights",
          entries: { a: Number.POSITIVE_INFINITY, b: 2 },
        }),
      ),
    ).toMatch(/weights/i);
    expect(
      validateSplit(
        expense("e1", 100, "a", { mode: "weights", entries: { a: 0, b: 0 } }),
      ),
    ).toMatch(/more than zero/i);
    expect(
      validateSplit(
        expense("e1", 100, "a", { mode: "weights", entries: { a: 0, b: 0.5 } }),
      ),
    ).toBeNull();
  });
});

describe("netBalances", () => {
  it("credits the payer and debits the participants", () => {
    const balances = netBalances(
      [
        expense("e1", 3000, "a", {
          mode: "even",
          entries: { a: 0, b: 0, c: 0 },
        }),
      ],
      [],
      ["a", "b", "c"],
    );
    expect(balances).toEqual({ a: 2000, b: -1000, c: -1000 });
  });

  it("includes untouched members as zero", () => {
    const balances = netBalances([], [], ["a", "b"]);
    expect(balances).toEqual({ a: 0, b: 0 });
  });

  it("does not drop money for members outside the roster", () => {
    const balances = netBalances(
      [expense("e1", 100, "ghost", { mode: "even", entries: { a: 0, b: 0 } })],
      [],
      ["a"],
    );
    expect(balances).toEqual({ a: -50, b: -50, ghost: 100 });
    expect(sum(balances)).toBe(0);
  });

  it("lets a settlement fully zero a two-person debt", () => {
    const expenses = [
      expense("e1", 4700, "anna", {
        mode: "even",
        entries: { anna: 0, bob: 0 },
      }),
    ];
    expect(netBalances(expenses, [], ["anna", "bob"])).toEqual({
      anna: 2350,
      bob: -2350,
    });
    const paid = [settlement("s1", "bob", "anna", 2350)];
    expect(netBalances(expenses, paid, ["anna", "bob"])).toEqual({
      anna: 0,
      bob: 0,
    });
  });

  it("sums to zero across a mixed ledger", () => {
    const members = ["anna", "bob", "cleo", "dan"];
    const expenses = [
      expense("e1", 4321, "anna", {
        mode: "even",
        entries: { anna: 0, bob: 0, cleo: 0, dan: 0 },
      }),
      expense("e2", 999, "bob", {
        mode: "weights",
        entries: { anna: 1, bob: 2, cleo: 0.5 },
      }),
      expense("e3", 5000, "cleo", {
        mode: "exact",
        entries: { anna: 1234, dan: 3766 },
      }),
      expense("e4", 7, "dan", { mode: "even", entries: { bob: 0, cleo: 0 } }),
    ];
    const settlements = [
      settlement("s1", "dan", "cleo", 3766),
      settlement("s2", "anna", "bob", 12),
    ];
    expect(sum(netBalances(expenses, settlements, members))).toBe(0);
  });

  it("stays balanced even for a malformed exact split", () => {
    const balances = netBalances(
      [expense("e1", 1000, "a", { mode: "exact", entries: { a: 1, b: 2 } })],
      [],
      ["a", "b"],
    );
    expect(sum(balances)).toBe(0);
  });
});

describe("property checks (seeded)", () => {
  const members = ["anna", "bob", "cleo", "dan", "eve", "finn"];
  const modes = ["even", "weights", "exact"] as const;

  it("shares always sum to the amount and balances always sum to zero", () => {
    const rand = rng(20260730);
    const pick = (n: number) => Math.floor(rand() * n);

    for (let round = 0; round < 50; round++) {
      const expenses: Expense[] = [];
      const settlements: Settlement[] = [];

      for (let i = 0; i < 1 + pick(4); i++) {
        const participants = members.filter(() => rand() < 0.6);
        if (participants.length === 0) {
          participants.push(members[pick(members.length)]);
        }
        const amountCents = 1 + pick(100000);
        const mode = modes[pick(modes.length)];
        const entries: Record<MemberId, number> = {};

        if (mode === "weights") {
          for (const id of participants) {
            entries[id] = Math.round(rand() * 400) / 100;
          }
          if (!participants.some((id) => entries[id] > 0)) {
            entries[participants[0]] = 1;
          }
        } else if (mode === "exact") {
          // Hand out the whole amount so the split is a valid one.
          let left = amountCents;
          participants.forEach((id, idx) => {
            const cents =
              idx === participants.length - 1 ? left : pick(left + 1);
            entries[id] = cents;
            left -= cents;
          });
        } else {
          for (const id of participants) entries[id] = 0;
        }

        const e = expense(
          `e${round}-${i}`,
          amountCents,
          members[pick(members.length)],
          { mode, entries },
        );
        expect(validateSplit(e)).toBeNull();
        expect(sum(splitShares(e, members))).toBe(amountCents);
        expenses.push(e);
      }

      for (let i = 0; i < pick(3); i++) {
        settlements.push(
          settlement(
            `s${round}-${i}`,
            members[pick(members.length)],
            members[pick(members.length)],
            1 + pick(50000),
          ),
        );
      }

      expect(sum(netBalances(expenses, settlements, members))).toBe(0);
    }
  });
});
