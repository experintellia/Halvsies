// Regression tests for defects found by the adversarial review pass. Each case
// is a concrete failing input from that review — they exist to stop these
// specific money bugs coming back, so keep the finding reference in the name.
import { describe, expect, it } from "vitest";
import {
  MAX_AMOUNT_CENTS,
  netBalances,
  splitShares,
  validateSplit,
} from "../src/state/balances";
import { simplifyDebts } from "../src/state/simplify";
import { parseSnapshot } from "../src/state/doc";
import { paymentMethodsFor } from "../src/pay/links";
import { formatMoney, isCurrencyCode, type Expense } from "../src/state/model";
import { buildEpcPayload } from "../src/pay/epcqr";
import { parseAmountInput } from "../src/ui/components/Amount";

function expense(over: Partial<Expense> = {}): Expense {
  return {
    id: "e1",
    title: "Pizza",
    amountCents: 3000,
    payerId: "alice",
    split: { mode: "even", entries: { alice: 0, bob: 0 } },
    date: "2026-07-30",
    createdBy: "alice",
    editedAt: 0,
    ...over,
  };
}

describe("weights split does not charge a zero-weight member", () => {
  // A weight-0 member is deliberately excluded; the old residual loop walked
  // ids from index 0 and handed them a ±1c share, inventing a transfer row.
  it("gives the excluded member exactly nothing (100c over 8 payers + 1 excluded)", () => {
    const shares = splitShares(
      expense({
        amountCents: 100,
        split: {
          mode: "weights",
          entries: { a: 0, b: 1, c: 1, d: 1, e: 1, f: 1, g: 1, h: 1, i: 1 },
        },
      }),
      [],
    );
    expect(shares.a).toBe(0);
    expect(Object.values(shares).reduce((s, n) => s + n, 0)).toBe(100);
  });

  it("gives the excluded member nothing when the residual is negative too", () => {
    const shares = splitShares(
      expense({
        amountCents: 10,
        split: { mode: "weights", entries: { a: 0, b: 1, c: 1, d: 1 } },
      }),
      [],
    );
    expect(shares.a).toBe(0);
    expect(Object.values(shares).reduce((s, n) => s + n, 0)).toBe(10);
  });
});

describe("amount upper bound keeps split math exact", () => {
  // Past 2^53 the arithmetic silently left integer land, netBalances stopped
  // summing to 0, and simplifyDebts threw on every peer.
  it("rejects an amount above MAX_AMOUNT_CENTS", () => {
    expect(validateSplit(expense({ amountCents: 1e20 }))).toBe(
      "Amount is too large",
    );
    expect(validateSplit(expense({ amountCents: MAX_AMOUNT_CENTS + 1 }))).toBe(
      "Amount is too large",
    );
    expect(
      validateSplit(expense({ amountCents: MAX_AMOUNT_CENTS })),
    ).toBeNull();
  });

  it("refuses to parse an out-of-range amount from the input field", () => {
    expect(parseAmountInput("999999999999999999")).toBeNull();
    expect(parseAmountInput("1000000000.00")).toBeNull(); // one cent over
    expect(parseAmountInput("999999999.99")).toBe(MAX_AMOUNT_CENTS);
  });

  it("keeps netBalances summing to zero at the maximum amount", () => {
    const balances = netBalances(
      [
        expense({
          amountCents: MAX_AMOUNT_CENTS,
          split: { mode: "even", entries: { alice: 0, bob: 0, carol: 0 } },
        }),
      ],
      [],
      ["alice", "bob", "carol"],
    );
    expect(Object.values(balances).reduce((s, n) => s + n, 0)).toBe(0);
    expect(() => simplifyDebts(balances)).not.toThrow();
  });
});

describe("parseSnapshot rejects unbookable imported ledgers", () => {
  const wrap = (body: Record<string, unknown>) =>
    JSON.stringify({
      settings: { groupCurrency: "EUR" },
      members: {
        alice: { id: "alice", name: "Alice", isVirtual: false },
        bob: { id: "bob", name: "Bob", isVirtual: false },
      },
      profiles: {},
      expenses: {},
      settlements: {},
      ...body,
    });

  it("rejects a negative expense amount (invents a reversed debt)", () => {
    expect(() =>
      parseSnapshot(
        wrap({
          expenses: {
            e1: {
              id: "e1",
              amountCents: -5000,
              payerId: "alice",
              split: { mode: "even", entries: { alice: 0, bob: 0 } },
            },
          },
        }),
      ),
    ).toThrow(/more than zero/i);
  });

  it("rejects a negative settlement amount (doubles the debt)", () => {
    expect(() =>
      parseSnapshot(
        wrap({
          settlements: {
            s1: { id: "s1", fromId: "bob", toId: "alice", amountCents: -2350 },
          },
        }),
      ),
    ).toThrow(/positive whole number/i);
  });

  it("rejects fractional cents in an exact split", () => {
    expect(() =>
      parseSnapshot(
        wrap({
          expenses: {
            e1: {
              id: "e1",
              amountCents: 100,
              payerId: "alice",
              split: {
                mode: "exact",
                entries: { alice: 0.7, bob: 0.1, carol: 99.2 },
              },
            },
          },
        }),
      ),
    ).toThrow(/whole cents/i);
  });
});

describe("a malformed currency code cannot blank the app", () => {
  // Intl.NumberFormat throws RangeError on a non-3-letter code. A bad value is
  // durable CRDT state, so formatMoney must survive one synced from an
  // unpatched peer rather than killing the render tree and the provider flush.
  it("classifies currency codes", () => {
    expect(isCurrencyCode("EUR")).toBe(true);
    expect(isCurrencyCode("EU")).toBe(false);
    expect(isCurrencyCode("E1R")).toBe(false);
    expect(isCurrencyCode("")).toBe(false);
  });

  it("falls back to a plain number instead of throwing", () => {
    expect(() => formatMoney(2350, "EU")).not.toThrow();
    expect(formatMoney(2350, "EU")).toBe("23.50");
    expect(formatMoney(2350, "EUR")).toContain("23");
  });

  it("drops an invalid code instead of persisting it", () => {
    const snap = parseSnapshot(
      JSON.stringify({
        settings: { groupCurrency: "EUR" },
        members: {},
        profiles: {},
        expenses: {},
        settlements: {},
      }),
    );
    expect(snap.settings.groupCurrency).toBe("EUR");
  });
});

describe("EPC payload stays scannable", () => {
  const base = {
    name: "Alice Example",
    iban: "DE89370400440532013000",
    amountCents: 2350,
    currency: "EUR",
    reference: "Halvsies: Rome trip",
  };

  it("never ends in a field separator", () => {
    expect(buildEpcPayload(base).endsWith("\n")).toBe(false);
    expect(
      buildEpcPayload({ ...base, reference: undefined }).endsWith("\n"),
    ).toBe(false);
  });

  it("normalizes a BIC that only a remote peer could have written", () => {
    expect(
      buildEpcPayload({ ...base, bic: "coba deff xxx" }).split("\n")[4],
    ).toBe("COBADEFFXXX");
  });
});

describe("multiple custom payment links", () => {
  const twoCustoms = {
    customs: [
      {
        id: "a",
        label: "Twint",
        urlTemplate: "https://twint.example/{amount}",
      },
      { id: "b", label: "PayNow", urlTemplate: "https://paynow.example/{ref}" },
    ],
  };

  it("emits one method per template, in stored order", () => {
    const methods = paymentMethodsFor(twoCustoms, 2350, "EUR", "rent");
    expect(methods.map((m) => m.label)).toEqual(["Twint", "PayNow"]);
    expect(methods[0].url).toBe("https://twint.example/23.50");
    expect(methods[1].url).toBe("https://paynow.example/rent");
  });

  it("gives every method a unique id (kind alone would collide)", () => {
    const methods = paymentMethodsFor(
      { ...twoCustoms, paypalMe: "alice" },
      2350,
      "EUR",
      "rent",
    );
    const ids = methods.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(methods.filter((m) => m.kind === "custom")).toHaveLength(2);
  });

  it("drops only the invalid template, keeping the rest", () => {
    const methods = paymentMethodsFor(
      {
        customs: [
          {
            id: "a",
            label: "Good",
            urlTemplate: "https://ok.example/{amount}",
          },
          { id: "b", label: "Evil", urlTemplate: "javascript:alert(1)" },
        ],
      },
      100,
      "EUR",
      "x",
    );
    expect(methods.map((m) => m.label)).toEqual(["Good"]);
  });
});

describe("snapshot import of custom links", () => {
  const wrapProfile = (profile: unknown) =>
    JSON.stringify({
      settings: { groupCurrency: "EUR" },
      members: {},
      profiles: { "a@x.de": profile },
      expenses: {},
      settlements: {},
    });

  it("accepts the pre-0.2 single `custom` object and folds it into the array", () => {
    const snap = parseSnapshot(
      wrapProfile({
        custom: { label: "Twint", urlTemplate: "https://pay.example/{amount}" },
      }),
    );
    const customs = snap.profiles["a@x.de"].customs;
    expect(customs).toHaveLength(1);
    expect(customs![0].label).toBe("Twint");
    expect(customs![0].id).toBeTruthy(); // synthesized, so list edits work
  });

  it("de-duplicates ids so list edits can't hit the wrong row", () => {
    const snap = parseSnapshot(
      wrapProfile({
        customs: [
          { id: "same", label: "A", urlTemplate: "https://a.example/" },
          { id: "same", label: "B", urlTemplate: "https://b.example/" },
        ],
      }),
    );
    const ids = snap.profiles["a@x.de"].customs!.map((c) => c.id);
    expect(new Set(ids).size).toBe(2);
  });

  it("still rejects a javascript: template inside the array", () => {
    expect(() =>
      parseSnapshot(
        wrapProfile({
          customs: [{ id: "a", label: "x", urlTemplate: "javascript:evil()" }],
        }),
      ),
    ).toThrow(/http\(s\)/i);
  });
});
