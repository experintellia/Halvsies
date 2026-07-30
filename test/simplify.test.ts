import { describe, expect, it } from "vitest";
import { simplifyDebts } from "../src/state/simplify";
import type { MemberId, Transfer } from "../src/state/model";

function apply(
  balances: Record<MemberId, number>,
  transfers: Transfer[],
): Record<MemberId, number> {
  const out = { ...balances };
  for (const t of transfers) {
    out[t.fromId] = (out[t.fromId] ?? 0) + t.amountCents;
    out[t.toId] = (out[t.toId] ?? 0) - t.amountCents;
  }
  return out;
}

function expectAllZero(balances: Record<MemberId, number>): void {
  for (const id of Object.keys(balances)) {
    expect(balances[id], `member ${id}`).toBe(0);
  }
}

/** Deterministic PRNG (mulberry32) — no Math.random in tests. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("simplifyDebts", () => {
  it("settles a two-person debt with one transfer", () => {
    expect(simplifyDebts({ a: -50, b: 50 })).toEqual([
      { fromId: "a", toId: "b", amountCents: 50 },
    ]);
  });

  it("settles a three-way case in at most n-1 transfers", () => {
    const balances = { a: -100, b: 40, c: 60 };
    const transfers = simplifyDebts(balances);
    expect(transfers.length).toBeLessThanOrEqual(2);
    expectAllZero(apply(balances, transfers));
  });

  it("ignores zero balances", () => {
    const transfers = simplifyDebts({ a: -30, b: 0, c: 30 });
    expect(transfers).toEqual([{ fromId: "a", toId: "c", amountCents: 30 }]);
  });

  it("is independent of key insertion order", () => {
    const orders: MemberId[][] = [
      ["a", "b", "c", "d"],
      ["d", "c", "b", "a"],
      ["c", "a", "d", "b"],
      ["b", "d", "a", "c"],
    ];
    const amounts: Record<MemberId, number> = {
      a: -7500,
      b: 2500,
      c: -1500,
      d: 6500,
    };
    const results = orders.map((order) => {
      const balances: Record<MemberId, number> = {};
      for (const id of order) balances[id] = amounts[id];
      return simplifyDebts(balances);
    });
    for (const r of results) expect(r).toEqual(results[0]);
    expectAllZero(apply(amounts, results[0]));
  });

  it("breaks ties by member id", () => {
    const balances = { a: -50, b: -50, c: 50, d: 50 };
    expect(simplifyDebts(balances)).toEqual([
      { fromId: "a", toId: "c", amountCents: 50 },
      { fromId: "b", toId: "d", amountCents: 50 },
    ]);
  });

  it("does not mutate its input", () => {
    const balances = { a: -100, b: 100 };
    simplifyDebts(balances);
    expect(balances).toEqual({ a: -100, b: 100 });
  });

  it("throws when balances do not sum to zero", () => {
    expect(() => simplifyDebts({ a: -50, b: 40 })).toThrow(/sum to 0/);
  });

  it("zeroes random zero-sum balance maps within n-1 transfers", () => {
    const rand = prng(0xc0ffee);
    for (let round = 0; round < 50; round++) {
      const n = 2 + Math.floor(rand() * 9);
      const balances: Record<MemberId, number> = {};
      const ids: MemberId[] = [];
      let sum = 0;
      for (let i = 0; i < n; i++) {
        const id = `m${i}`;
        ids.push(id);
        const amount = Math.floor(rand() * 20000) - 10000;
        balances[id] = amount;
        sum += amount;
      }
      // absorb the remainder so the map sums to exactly 0
      balances[ids[0]] -= sum;

      const transfers = simplifyDebts(balances);
      const nonZero = ids.filter((id) => balances[id] !== 0).length;
      expect(transfers.length).toBeLessThanOrEqual(Math.max(0, nonZero - 1));
      for (const t of transfers) {
        expect(t.amountCents).toBeGreaterThan(0);
        expect(Number.isInteger(t.amountCents)).toBe(true);
      }
      expectAllZero(apply(balances, transfers));
    }
  });
});
