// Unit tests for the wizard's provider table: the currency pill, the crypto
// step's validator, and the invariant that every provider is reachable from the
// picker (a new PROVIDERS row that nobody can tap is the easy mistake here).
import { describe, expect, it } from "vitest";
import {
  PICKER_SECTIONS,
  PROVIDERS,
  currencyPill,
  providerFor,
  validateCrypto,
} from "../src/pay/providers";
import { currenciesFor } from "../src/pay/links";

describe("currencyPill", () => {
  it("is null when the method takes any currency", () => {
    expect(currencyPill(null, "CHF")).toBeNull();
  });

  it("is null when the group currency is supported", () => {
    expect(currencyPill(["EUR"], "EUR")).toBeNull();
    expect(currencyPill(["USD", "GBP"], "gbp")).toBeNull(); // case-insensitive
  });

  it("names the supported currencies when it isn't", () => {
    expect(currencyPill(["EUR"], "CHF")).toBe("EUR only");
    expect(currencyPill(["USD", "GBP"], "CHF")).toBe("USD or GBP only");
  });
});

describe("validateCrypto", () => {
  const ADDRESS = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";

  it("accepts a filled-in bitcoin method", () => {
    expect(
      validateCrypto({
        label: "Bitcoin",
        address: ADDRESS,
        network: "bitcoin",
      }),
    ).toBeNull();
  });

  it("requires a name and an address", () => {
    expect(
      validateCrypto({ label: "  ", address: ADDRESS, network: "bitcoin" }),
    ).not.toBeNull();
    expect(
      validateCrypto({ label: "Bitcoin", address: " ", network: "bitcoin" }),
    ).not.toBeNull();
  });

  it("still accepts network 'other', which has no link but is savable", () => {
    expect(
      validateCrypto({ label: "Zcash", address: ADDRESS, network: "other" }),
    ).toBeNull();
  });
});

describe("provider table", () => {
  it("reads every currency gate from links.ts", () => {
    for (const section of PICKER_SECTIONS) {
      for (const entry of section.entries) {
        if (entry.target.kind !== "provider") continue;
        const spec = providerFor(entry.target.field);
        expect(entry.currencies).toBe(currenciesFor(spec.kind));
      }
    }
  });

  it("makes every provider reachable from the picker exactly once", () => {
    const fields = PICKER_SECTIONS.flatMap((s) => s.entries)
      .map((e) => (e.target.kind === "provider" ? e.target.field : null))
      .filter((f) => f !== null);
    expect(fields.slice().sort()).toEqual(
      PROVIDERS.map((p) => p.field)
        .slice()
        .sort(),
    );
  });

  it("groups the picker: bank standards, then apps, then everything else", () => {
    expect(PICKER_SECTIONS.map((s) => s.title)).toEqual([
      "Bank & national standards",
      "Payment apps",
      "Anything else",
    ]);
    expect(PICKER_SECTIONS[0].entries.map((e) => e.label)).toEqual([
      "Bank transfer",
      "UPI",
    ]);
    // Custom link stays last overall.
    const last = PICKER_SECTIONS[PICKER_SECTIONS.length - 1].entries;
    expect(last[last.length - 1].label).toBe("Custom link");
  });

  it("accepts a realistic handle for every provider, and rejects junk", () => {
    const samples: Record<string, string> = {
      paypalMe: "anna",
      revolutTag: "annab",
      wiseTag: "anna-b",
      venmo: "anna-b",
      monzoMe: "anna",
      bunqMe: "anna",
      cashtag: "$anna",
      upiVpa: "anna@okhdfcbank",
    };
    for (const spec of PROVIDERS) {
      expect(spec.validate(samples[spec.field])).toBeNull();
      expect(spec.validate("no spaces allowed")).not.toBeNull();
    }
  });

  it("stores the cashtag without its leading $", () => {
    expect(providerFor("cashtag").normalize!(" $anna ")).toBe("anna");
  });
});
