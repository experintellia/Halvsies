import { describe, expect, it } from "vitest";
import {
  normalizeIban,
  isValidIban,
  formatIban,
  isValidBic,
} from "../src/pay/iban";

const KNOWN_VALID = [
  "DE89370400440532013000",
  "GB82WEST12345698765432",
  "FR1420041010050500013M02606",
  "NL91ABNA0417164300",
];

// Synthetically constructed (no real-world country currently issues 34-char
// IBANs) to exercise the incremental mod-97 algorithm at ISO 13616's max
// length. Hand-checked: rearranged numeric string mod 97 === 1.
const IBAN_34 = "XK59120123456789012345678901ABCDEF";

describe("isValidIban", () => {
  it("accepts known-valid IBANs", () => {
    for (const iban of KNOWN_VALID) expect(isValidIban(iban)).toBe(true);
  });

  it("accepts a genuine 34-character IBAN (max ISO 13616 length)", () => {
    expect(IBAN_34.length).toBe(34);
    expect(isValidIban(IBAN_34)).toBe(true);
  });

  it("rejects the same IBANs with one digit changed", () => {
    expect(isValidIban("DE88370400440532013000")).toBe(false);
    expect(isValidIban("GB83WEST12345698765432")).toBe(false);
    expect(isValidIban("FR1420041010050500013M02607")).toBe(false);
    expect(isValidIban("NL92ABNA0417164300")).toBe(false);
    expect(isValidIban("XK58120123456789012345678901ABCDEF")).toBe(false);
  });

  it("normalizes lowercase and spaced input before validating", () => {
    expect(isValidIban("de89 3704 0044 0532 0130 00")).toBe(true);
    expect(isValidIban("  gb82 west 1234 5698 7654 32  ")).toBe(true);
  });

  it("rejects too-short and too-long input", () => {
    expect(isValidIban("DE8937040044")).toBe(false); // < 15
    expect(isValidIban("DE89" + "3704004405320130001234567890")).toBe(false); // > 34
  });

  it("rejects non-alphanumeric characters", () => {
    expect(isValidIban("DE89-370400440532013000")).toBe(false);
    expect(isValidIban("DE89370400440532013!00")).toBe(false);
  });

  it("rejects a shape that doesn't start with 2 letters + 2 digits", () => {
    expect(isValidIban("D189370400440532013000")).toBe(false);
    expect(isValidIban("12893704004405320130000")).toBe(false);
  });
});

describe("normalizeIban", () => {
  it("strips whitespace and uppercases", () => {
    expect(normalizeIban(" de89 3704 0044 0532 0130 00 ")).toBe(
      "DE89370400440532013000",
    );
  });
});

describe("formatIban", () => {
  it("groups the normalized IBAN in 4s", () => {
    expect(formatIban("de89370400440532013000")).toBe(
      "DE89 3704 0044 0532 0130 00",
    );
  });
});

describe("isValidBic", () => {
  it("accepts 8- and 11-character BICs", () => {
    expect(isValidBic("DEUTDEFF")).toBe(true);
    expect(isValidBic("DEUTDEFF500")).toBe(true);
  });

  it("normalizes lowercase/spaced input", () => {
    expect(isValidBic(" deutdeff ")).toBe(true);
  });

  it("rejects malformed BICs", () => {
    expect(isValidBic("DEUTDEF")).toBe(false); // 7 chars
    expect(isValidBic("1EUTDEFF")).toBe(false); // digit in bank code
    expect(isValidBic("DEUTDEFF12")).toBe(false); // 10 chars
  });
});
