// Picking the group's currency: a suggestion from the device's language, and
// the list of codes to choose from. Pure except for the two Intl probes at the
// bottom, which are feature-detected because both sit at or above this app's
// browser floor (Plan.md: es2020 / chrome87 / safari14.1 / firefox78).
//
// No network, so none of this can be looked up — the region table below is the
// price of the feature. It is deliberately partial: a suggestion that is
// sometimes absent is fine, a wrong one is not.

/**
 * Region subtag → ISO 4217 code. Only regions where the answer is unambiguous
 * and stable; anywhere with a pegged-but-separate currency, a dual-currency
 * economy, or an imminent euro accession is better left unsuggested than
 * guessed. Not exhaustive by design.
 */
const REGION_CURRENCY: Record<string, string> = {
  // Eurozone
  AT: "EUR",
  BE: "EUR",
  CY: "EUR",
  DE: "EUR",
  EE: "EUR",
  ES: "EUR",
  FI: "EUR",
  FR: "EUR",
  GR: "EUR",
  HR: "EUR",
  IE: "EUR",
  IT: "EUR",
  LT: "EUR",
  LU: "EUR",
  LV: "EUR",
  MT: "EUR",
  NL: "EUR",
  PT: "EUR",
  SI: "EUR",
  SK: "EUR",
  // Rest of Europe
  AL: "ALL",
  BA: "BAM",
  BG: "BGN",
  CH: "CHF",
  CZ: "CZK",
  DK: "DKK",
  GB: "GBP",
  HU: "HUF",
  IS: "ISK",
  LI: "CHF",
  MD: "MDL",
  MK: "MKD",
  NO: "NOK",
  PL: "PLN",
  RO: "RON",
  RS: "RSD",
  SE: "SEK",
  UA: "UAH",
  // Americas
  AR: "ARS",
  BO: "BOB",
  BR: "BRL",
  CA: "CAD",
  CL: "CLP",
  CO: "COP",
  CR: "CRC",
  DO: "DOP",
  GT: "GTQ",
  MX: "MXN",
  PE: "PEN",
  PY: "PYG",
  US: "USD",
  UY: "UYU",
  // Asia-Pacific
  AU: "AUD",
  BD: "BDT",
  CN: "CNY",
  HK: "HKD",
  ID: "IDR",
  IN: "INR",
  JP: "JPY",
  KH: "KHR",
  KR: "KRW",
  LK: "LKR",
  MY: "MYR",
  NP: "NPR",
  NZ: "NZD",
  PH: "PHP",
  PK: "PKR",
  SG: "SGD",
  TH: "THB",
  TW: "TWD",
  VN: "VND",
  // Africa & Middle East
  AE: "AED",
  EG: "EGP",
  ET: "ETB",
  GH: "GHS",
  IL: "ILS",
  JO: "JOD",
  KE: "KES",
  MA: "MAD",
  NG: "NGN",
  QA: "QAR",
  SA: "SAR",
  TN: "TND",
  TR: "TRY",
  TZ: "TZS",
  UG: "UGX",
  ZA: "ZAR",
};

/**
 * Language subtag → ISO 4217, for the case where the tag carries no region
 * ("ja" rather than "ja-JP"). Only languages with effectively one home
 * country: "de" could be Germany, Austria or Switzerland, and "en", "es",
 * "fr", "pt" and "ar" span continents, so none of them are here.
 */
const LANGUAGE_CURRENCY: Record<string, string> = {
  bg: "BGN",
  cs: "CZK",
  da: "DKK",
  el: "EUR",
  et: "EUR",
  fi: "EUR",
  he: "ILS",
  hi: "INR",
  hr: "EUR",
  hu: "HUF",
  is: "ISK",
  ja: "JPY",
  ko: "KRW",
  lt: "EUR",
  lv: "EUR",
  mt: "EUR",
  nb: "NOK",
  nl: "EUR",
  nn: "NOK",
  no: "NOK",
  pl: "PLN",
  ro: "RON",
  sk: "EUR",
  sl: "EUR",
  sr: "RSD",
  sv: "SEK",
  th: "THB",
  tr: "TRY",
  uk: "UAH",
  vi: "VND",
};

/** The region subtag of a BCP-47 tag ("de-DE" → "DE", "zh-Hant-TW" → "TW"). */
export function regionOf(tag: string): string | undefined {
  for (const part of tag.split("-").slice(1)) {
    // A region subtag is two letters (or three digits, which we don't map).
    if (/^[A-Za-z]{2}$/.test(part)) return part.toUpperCase();
  }
  return undefined;
}

/**
 * The most likely currency for these BCP-47 tags, or undefined when the guess
 * would be a coin flip. Takes the list (navigator.languages) so a device set
 * to "en-US, de-DE" still gets an answer from the second entry.
 */
export function suggestCurrency(
  locales: readonly string[],
): string | undefined {
  for (const tag of locales) {
    const region = regionOf(tag);
    if (region && REGION_CURRENCY[region]) return REGION_CURRENCY[region];
  }
  // Only after every tag's region has failed: a region is far better evidence
  // than a language, so "de-CH" must reach CHF rather than stopping at "de".
  for (const tag of locales) {
    const language = tag.split("-")[0].toLowerCase();
    if (LANGUAGE_CURRENCY[language]) return LANGUAGE_CURRENCY[language];
  }
  return undefined;
}

/** What the device says it speaks. Empty outside a browser. */
export function deviceLocales(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  const list = navigator.languages;
  if (list && list.length > 0) return list;
  return navigator.language ? [navigator.language] : [];
}

/**
 * Shown first in the picker, so the common case is one tap rather than a scroll
 * through 160 codes. Also the whole list on engines without
 * `Intl.supportedValuesOf` (ES2022 / Chrome 99, above our floor).
 */
export const COMMON_CURRENCIES: readonly string[] = [
  "EUR",
  "USD",
  "GBP",
  "CHF",
  "SEK",
  "NOK",
  "DKK",
  "PLN",
  "CZK",
  "HUF",
  "RON",
  "BGN",
  "ISK",
  "TRY",
  "UAH",
  "RSD",
  "ILS",
  "AED",
  "SAR",
  "EGP",
  "ZAR",
  "NGN",
  "KES",
  "MAD",
  "INR",
  "PKR",
  "BDT",
  "LKR",
  "NPR",
  "CNY",
  "JPY",
  "KRW",
  "TWD",
  "HKD",
  "SGD",
  "MYR",
  "THB",
  "VND",
  "IDR",
  "PHP",
  "AUD",
  "NZD",
  "CAD",
  "BRL",
  "MXN",
  "ARS",
  "CLP",
  "COP",
  "PEN",
  "UYU",
];

/**
 * Every ISO 4217 code the engine knows, or {@link COMMON_CURRENCIES} where it
 * cannot say. Sorted, and never missing `include` (the stored value) — a
 * <select> that silently drops the currency a group is already using would
 * change it on the next save.
 */
export function currencyCodes(include?: string): string[] {
  const supported = (Intl as { supportedValuesOf?: (key: string) => string[] })
    .supportedValuesOf;
  const all =
    typeof supported === "function"
      ? supported("currency")
      : [...COMMON_CURRENCIES];
  const set = new Set(all.map((c) => c.toUpperCase()));
  if (include) set.add(include.toUpperCase());
  return [...set].sort();
}

/**
 * "Swedish Krona" for SEK, in the device's language. Undefined when the engine
 * has no display-name data — callers show the bare code, which is the thing
 * that actually identifies the currency anyway.
 */
export function currencyName(
  code: string,
  locales: readonly string[] = deviceLocales(),
): string | undefined {
  const DisplayNames = (
    Intl as {
      DisplayNames?: new (
        l: readonly string[],
        o: object,
      ) => {
        of(code: string): string | undefined;
      };
    }
  ).DisplayNames;
  if (typeof DisplayNames !== "function") return undefined;
  try {
    const name = new DisplayNames(locales.length ? locales : ["en"], {
      type: "currency",
    }).of(code);
    // Engines echo the input back when they have no name for it.
    return name && name !== code ? name : undefined;
  } catch {
    return undefined;
  }
}
