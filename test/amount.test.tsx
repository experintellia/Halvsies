import { describe, expect, it } from "vitest";
import { parseAmountInput } from "../src/ui/components/Amount";

describe("parseAmountInput", () => {
  it("accepts a comma decimal separator", () => {
    expect(parseAmountInput("12,50")).toBe(1250);
  });

  it("accepts a dot decimal separator", () => {
    expect(parseAmountInput("12.5")).toBe(1250);
  });

  it("keeps a leading-zero fraction", () => {
    expect(parseAmountInput("0.05")).toBe(5);
  });

  it("truncates a third decimal instead of rounding up", () => {
    expect(parseAmountInput("12.999")).toBe(1299);
  });

  it("strips currency symbols and spaces", () => {
    expect(parseAmountInput("€ 12,50")).toBe(1250);
  });

  it("treats an empty string as zero", () => {
    expect(parseAmountInput("")).toBe(0);
  });

  it("rejects non-numeric input instead of producing NaN", () => {
    expect(parseAmountInput("abc")).toBeNull();
  });

  it("rejects negative amounts", () => {
    expect(parseAmountInput("-5")).toBeNull();
  });

  it("never returns NaN or a float for any input", () => {
    for (const s of ["", "abc", "-5", "12,50", "0.05", "€12.999", "..", "-"]) {
      const v = parseAmountInput(s);
      if (v !== null) expect(Number.isInteger(v)).toBe(true);
    }
  });
});
