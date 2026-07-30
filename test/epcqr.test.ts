import { describe, expect, it } from "vitest";
import {
  buildEpcPayload,
  validateEpcParams,
  epcReference,
  type EpcParams,
} from "../src/pay/epcqr";

const base: EpcParams = {
  name: "Alice Example",
  iban: "DE89 3704 0044 0532 0130 00",
  amountCents: 2350,
  currency: "EUR",
  reference: "Halvsies: Rome trip - Pizza",
  bic: "COBADEFFXXX",
};

describe("buildEpcPayload", () => {
  it("emits the exact golden payload field by field", () => {
    expect(buildEpcPayload(base)).toBe(
      [
        "BCD",
        "002",
        "1",
        "SCT",
        "COBADEFFXXX",
        "Alice Example",
        "DE89370400440532013000",
        "EUR23.50",
        "", // purpose
        "", // structured creditor reference (mutually exclusive with the next)
        "Halvsies: Rome trip - Pizza",
        // Field 12 (beneficiary-to-originator info) is empty and therefore
        // omitted: the spec allows dropping trailing empty fields, and keeping
        // it would end the payload in a separator.
      ].join("\n"),
    );
  });

  it("has no trailing newline", () => {
    expect(buildEpcPayload(base).endsWith("\n")).toBe(false);
  });

  it("drops trailing empty fields but keeps the required prefix", () => {
    const noRef = buildEpcPayload({ ...base, reference: undefined });
    expect(noRef.endsWith("\n")).toBe(false);
    expect(noRef.split("\n")).toHaveLength(8); // BCD..Amount
    expect(noRef.split("\n")[7]).toBe("EUR23.50");
  });

  it("normalizes a spaced/lowercase BIC into the payload", () => {
    const payload = buildEpcPayload({ ...base, bic: "coba deff xxx" });
    expect(payload.split("\n")[4]).toBe("COBADEFFXXX");
  });

  it.each([
    [2350, "EUR23.50"],
    [5, "EUR0.05"],
    [100000, "EUR1000.00"],
  ])(
    "formats %i cents as %s with no thousands separator",
    (cents, expected) => {
      const payload = buildEpcPayload({ ...base, amountCents: cents });
      expect(payload.split("\n")[7]).toBe(expected);
    },
  );
});

describe("validateEpcParams", () => {
  it("accepts the golden params", () => {
    expect(validateEpcParams(base)).toBeNull();
  });

  it("rejects a 71-char name", () => {
    expect(validateEpcParams({ ...base, name: "A".repeat(71) })).toMatch(
      /name/i,
    );
  });

  it("rejects a 141-char reference", () => {
    expect(validateEpcParams({ ...base, reference: "A".repeat(141) })).toMatch(
      /reference/i,
    );
  });

  it("rejects a bad IBAN", () => {
    expect(
      validateEpcParams({ ...base, iban: "DE88370400440532013000" }),
    ).toMatch(/iban/i);
  });

  it("rejects a non-EUR currency", () => {
    expect(validateEpcParams({ ...base, currency: "USD" })).toMatch(/EUR/);
  });

  it("rejects a zero amount", () => {
    expect(validateEpcParams({ ...base, amountCents: 0 })).toMatch(/amount/i);
  });

  it("rejects a payload over 331 bytes even when every field is within its own character limit", () => {
    const oversized: EpcParams = {
      ...base,
      name: "A".repeat(70),
      reference: "é".repeat(140), // 140 chars but 280 bytes in UTF-8
    };
    // Sanity: no individual field-length rule is violated.
    expect(oversized.name.length).toBe(70);
    expect(oversized.reference!.length).toBe(140);

    const result = validateEpcParams(oversized);
    expect(result).toMatch(/331|byte/i);
  });

  it("rejects a field containing a newline", () => {
    expect(validateEpcParams({ ...base, name: "Alice\nExample" })).toMatch(
      /newline/i,
    );
  });
});

describe("epcReference", () => {
  it("builds a group-only reference", () => {
    expect(epcReference("Rome trip")).toBe("Halvsies: Rome trip");
  });

  it("builds a group + expense reference, swapping em dash for hyphen", () => {
    expect(epcReference("Rome trip", "Pizza")).toBe(
      "Halvsies: Rome trip - Pizza",
    );
  });

  it("falls back when there is no group title", () => {
    expect(epcReference(undefined)).toBe("Halvsies");
    expect(epcReference(undefined, "Pizza")).toBe("Halvsies - Pizza");
  });

  it("truncates to 140 chars on a word boundary", () => {
    const longExpense = "word ".repeat(40).trim(); // way over 140 once combined
    const result = epcReference("Rome trip", longExpense);
    expect(result.length).toBeLessThanOrEqual(140);
    expect(result.endsWith("word")).toBe(true); // cut at a space, not mid-word
  });
});
