import { describe, expect, it } from "vitest";
import {
  COMMON_CURRENCIES,
  currencyCodes,
  currencyName,
  regionOf,
  suggestCurrency,
} from "../src/state/currency";
import { isCurrencyCode } from "../src/state/model";

describe("regionOf", () => {
  it("finds the region subtag wherever it sits", () => {
    expect(regionOf("de-DE")).toBe("DE");
    expect(regionOf("en-gb")).toBe("GB");
    expect(regionOf("zh-Hant-TW")).toBe("TW"); // script subtag in between
    expect(regionOf("sr-Latn-RS")).toBe("RS");
  });

  it("is undefined when there is no region to read", () => {
    expect(regionOf("de")).toBeUndefined();
    expect(regionOf("")).toBeUndefined();
    // "419" (Latin America) is a UN M49 region, which this app doesn't map.
    expect(regionOf("es-419")).toBeUndefined();
  });
});

describe("suggestCurrency", () => {
  it("reads the region, not the language", () => {
    expect(suggestCurrency(["de-DE"])).toBe("EUR");
    expect(suggestCurrency(["de-AT"])).toBe("EUR");
    expect(suggestCurrency(["en-GB"])).toBe("GBP");
    expect(suggestCurrency(["en-US"])).toBe("USD");
    expect(suggestCurrency(["pt-BR"])).toBe("BRL");
    expect(suggestCurrency(["hi-IN"])).toBe("INR");
  });

  // The case the two-pass order exists for: "de" alone is not in the language
  // table (Germany/Austria/Switzerland disagree), and a naive language-first
  // lookup on a de-CH device would have to answer EUR, which is wrong.
  it("prefers a region on a later tag over a language on an earlier one", () => {
    expect(suggestCurrency(["de-CH"])).toBe("CHF");
    expect(suggestCurrency(["de", "de-CH"])).toBe("CHF");
    expect(suggestCurrency(["en", "en-GB"])).toBe("GBP");
  });

  it("falls back to the language only where one country owns it", () => {
    expect(suggestCurrency(["ja"])).toBe("JPY");
    expect(suggestCurrency(["sv"])).toBe("SEK");
    expect(suggestCurrency(["pl"])).toBe("PLN");
  });

  // A missing suggestion is fine; a confidently wrong one is not. "en" could
  // be six continents, "es" and "pt" likewise.
  it("declines to guess when the language spans countries", () => {
    expect(suggestCurrency(["en"])).toBeUndefined();
    expect(suggestCurrency(["es"])).toBeUndefined();
    expect(suggestCurrency(["pt"])).toBeUndefined();
    expect(suggestCurrency(["de"])).toBeUndefined();
    expect(suggestCurrency([])).toBeUndefined();
    expect(suggestCurrency(["xx-YY"])).toBeUndefined();
  });

  it("only ever suggests something formatMoney can render", () => {
    const tags = ["de-DE", "en-GB", "ja", "sv", "tr-TR", "pt-BR", "en-ZA"];
    for (const tag of tags) {
      const code = suggestCurrency([tag]);
      expect(code === undefined || isCurrencyCode(code)).toBe(true);
    }
  });
});

describe("currencyCodes", () => {
  it("is a sorted list of valid codes", () => {
    const codes = currencyCodes();
    expect(codes.length).toBeGreaterThanOrEqual(COMMON_CURRENCIES.length);
    expect(codes.every((c) => isCurrencyCode(c))).toBe(true);
    expect([...codes].sort()).toEqual(codes);
    expect(new Set(codes).size).toBe(codes.length); // no duplicates
  });

  // A <select> that silently dropped the group's current currency would
  // change it the next time anyone opened the screen.
  it("always contains the value it was asked to include", () => {
    expect(currencyCodes("XTS")).toContain("XTS");
    expect(currencyCodes("eur")).toContain("EUR");
    expect(currencyCodes("EUR").filter((c) => c === "EUR")).toHaveLength(1);
  });
});

describe("currencyName", () => {
  it("names a currency, or says nothing rather than echoing the code", () => {
    const eur = currencyName("EUR", ["en"]);
    expect(eur === undefined || /euro/i.test(eur)).toBe(true);
    // A code with no display name must come back undefined, never "XTS".
    expect(currencyName("XTS", ["en"])).not.toBe("XTS");
  });
});
