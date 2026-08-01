// Payment deep-link generators (Plan.md §5 M2). Pure functions only — no I/O,
// no DOM. Every generator skips silently (returns null) on invalid/missing
// input rather than emitting a broken or unsafe link.

import type {
  CryptoPaymentMethod,
  CustomPaymentMethod,
  PaymentProfile,
} from "../state/model";

export type PayMethodKind =
  | "paypal"
  | "revolut"
  | "wise"
  | "venmo"
  | "monzo"
  | "bunq"
  | "cashapp"
  | "upi"
  | "crypto"
  | "custom";

export interface PayMethod {
  /**
   * Unique within one paymentMethodsFor() result — the kind for built-ins,
   * `custom:<id>` for user templates. `kind` is NOT unique any more (a profile
   * may carry several custom links), so this is what UI keys and per-method
   * toggles must use.
   */
  id: string;
  kind: PayMethodKind;
  label: string; // "PayPal", "Revolut", "Monzo", or the custom label
  url: string; // the deep link, amount pre-filled where supported
  amountPrefilled: boolean; // false where the service can't take an amount
  caveat?: string; // e.g. the Monzo limits, shown as a UI hint
  /**
   * Crypto only: the plain address, so the UI's mandatory raw-address-with-copy
   * fallback (appendix A.3) never has to re-parse `url`. Many devices have no
   * handler for `bitcoin:`/`ethereum:`/`monero:`, so tapping the link can be a
   * no-op — the address must always be shown in full next to it.
   */
  rawAddress?: string;
}

// --- Currency gates --------------------------------------------------------

/**
 * The single source of truth for "which currencies may this method be offered
 * in". Generators gate on it and the UI's warning pill reads it, so the two can
 * never disagree. null = any currency.
 */
const PAY_METHOD_CURRENCIES: Record<PayMethodKind, readonly string[] | null> = {
  paypal: null,
  revolut: null,
  wise: null,
  venmo: null,
  monzo: ["GBP"],
  bunq: ["EUR"],
  cashapp: ["USD", "GBP"],
  upi: ["INR"],
  crypto: null, // the ledger stays fiat; the payer's wallet converts
  custom: null,
};

/** Currencies a method may be offered in, or null when it takes any. */
export function currenciesFor(kind: PayMethodKind): readonly string[] | null {
  return PAY_METHOD_CURRENCIES[kind];
}

/** True when `currency` passes `kind`'s gate. Case-insensitive. */
export function currencyAllowedFor(
  kind: PayMethodKind,
  currency: string,
): boolean {
  const allowed = currenciesFor(kind);
  return allowed === null || allowed.includes(currency.trim().toUpperCase());
}

/**
 * encodeURIComponent, tightened to RFC 3986: it leaves !'()* alone, which are
 * reserved sub-delims. Used for the Monero URI parameters.
 */
function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** Integer cents -> "23.50". No locale, no separators: a URL parameter, not a display string. */
export function amountForUrl(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  const whole = Math.floor(abs / 100);
  const frac = (abs % 100).toString().padStart(2, "0");
  return `${sign}${whole}.${frac}`;
}

// --- PayPal.Me ---------------------------------------------------------

const PAYPAL_HANDLE_RE = /^[A-Za-z0-9]{1,20}$/;

/** Accepts a bare handle or a pasted paypal.me/paypal.me/ URL and normalizes to the handle. */
function normalizePaypalHandle(input: string): string | null {
  let handle = input.trim();
  const urlMatch = handle.match(
    /^(?:https?:\/\/)?(?:www\.)?paypal\.me\/([^/?#\s]+)/i,
  );
  if (urlMatch) {
    handle = urlMatch[1];
  }
  return PAYPAL_HANDLE_RE.test(handle) ? handle : null;
}

export function paypalLink(
  handleInput: string,
  amountCents: number,
  currency: string,
): PayMethod | null {
  const handle = normalizePaypalHandle(handleInput);
  if (!handle) return null;
  return {
    id: "paypal",
    kind: "paypal",
    label: "PayPal",
    url: `https://paypal.me/${encodeURIComponent(handle)}/${amountForUrl(amountCents)}${encodeURIComponent(currency)}`,
    amountPrefilled: true,
  };
}

// --- Revolut -------------------------------------------------------------

const REVOLUT_TAG_RE = /^[A-Za-z0-9]{3,16}$/;

export function revolutLink(tagInput: string): PayMethod | null {
  const tag = tagInput.trim();
  if (!REVOLUT_TAG_RE.test(tag)) return null;
  return {
    id: "revolut",
    kind: "revolut",
    label: "Revolut",
    url: `https://revolut.me/${encodeURIComponent(tag)}`,
    amountPrefilled: false,
  };
}

// --- Wise ------------------------------------------------------------------

const WISE_TAG_RE = /^[A-Za-z0-9._-]{1,50}$/;

export function wiseLink(tagInput: string): PayMethod | null {
  const tag = tagInput.trim();
  if (!WISE_TAG_RE.test(tag)) return null;
  return {
    id: "wise",
    kind: "wise",
    label: "Wise",
    url: `https://wise.com/pay/me/${encodeURIComponent(tag)}`,
    amountPrefilled: false,
  };
}

// --- Venmo -------------------------------------------------------------

const VENMO_USER_RE = /^[A-Za-z0-9_-]{1,50}$/;

export function venmoLink(userInput: string): PayMethod | null {
  const user = userInput.trim();
  if (!VENMO_USER_RE.test(user)) return null;
  return {
    id: "venmo",
    kind: "venmo",
    label: "Venmo",
    url: `https://venmo.com/u/${encodeURIComponent(user)}`,
    amountPrefilled: false,
    caveat: "US-only in practice.",
  };
}

// --- Monzo -------------------------------------------------------------

const MONZO_USER_RE = /^[A-Za-z0-9._-]{1,50}$/;
const MONZO_MIN_CENTS = 100; // £1
const MONZO_MAX_CENTS = 10_000; // £100
const MONZO_LIMITS_CAVEAT =
  "£1–£100 per payment; recipient max £1,000 per 30 days.";

/** Explains why Monzo isn't offered, or null if it would be. Amount/currency only. */
export function monzoUnavailableReason(
  amountCents: number,
  currency: string,
): string | null {
  if (!currencyAllowedFor("monzo", currency)) return "Monzo only supports GBP.";
  if (amountCents < MONZO_MIN_CENTS) return "Amount below Monzo's £1 minimum.";
  if (amountCents > MONZO_MAX_CENTS) return "Amount above Monzo's £100 limit.";
  return null;
}

export function monzoLink(
  userInput: string,
  amountCents: number,
  currency: string,
  reference: string,
): PayMethod | null {
  const user = userInput.trim();
  if (!MONZO_USER_RE.test(user)) return null;
  if (monzoUnavailableReason(amountCents, currency) !== null) return null;
  return {
    id: "monzo",
    kind: "monzo",
    label: "Monzo",
    url: `https://monzo.me/${encodeURIComponent(user)}/${amountForUrl(amountCents)}?d=${encodeURIComponent(reference)}`,
    amountPrefilled: true,
    caveat: MONZO_LIMITS_CAVEAT,
  };
}

// --- bunq.me ---------------------------------------------------------------

const BUNQ_HANDLE_RE = /^[A-Za-z0-9._-]{1,50}$/;
/** iDEAL — the payment option most bunq.me payers use — is capped at €2,000. */
const BUNQ_IDEAL_CAP_CENTS = 200_000;
const BUNQ_CAVEAT =
  "The payer needs no bunq account: the landing page takes iDEAL/Wero, Bancontact, card and Apple/Google Pay.";
const BUNQ_OVER_CAP_HINT =
  " Above €2,000 iDEAL is unavailable, so the payer has to use a card or split the payment.";

export function bunqLink(
  handleInput: string,
  amountCents: number,
  currency: string,
  reference: string,
): PayMethod | null {
  const handle = handleInput.trim();
  if (!BUNQ_HANDLE_RE.test(handle)) return null;
  if (!currencyAllowedFor("bunq", currency)) return null;
  const description = reference.trim();
  const base = `https://bunq.me/${encodeURIComponent(handle)}/${amountForUrl(amountCents)}`;
  return {
    id: "bunq",
    kind: "bunq",
    label: "bunq",
    url: description ? `${base}/${encodeURIComponent(description)}` : base,
    amountPrefilled: true,
    caveat:
      amountCents > BUNQ_IDEAL_CAP_CENTS
        ? BUNQ_CAVEAT + BUNQ_OVER_CAP_HINT
        : BUNQ_CAVEAT,
  };
}

// --- Cash App --------------------------------------------------------------

const CASHTAG_RE = /^[A-Za-z0-9_-]{1,20}$/;

/**
 * Accepts a bare cashtag, a pasted "$anna", or a full cash.app URL and
 * normalizes to the bare tag (stored without the "$"), the way
 * normalizePaypalHandle does for PayPal.
 */
function normalizeCashtag(input: string): string | null {
  let tag = input.trim();
  const urlMatch = tag.match(
    /^(?:https?:\/\/)?(?:www\.)?cash\.app\/\$?([^/?#\s]+)/i,
  );
  if (urlMatch) tag = urlMatch[1];
  if (tag.startsWith("$")) tag = tag.slice(1);
  return CASHTAG_RE.test(tag) ? tag : null;
}

/** Cash App has no note/reference parameter — the amount goes in the path, nothing else. */
export function cashAppLink(
  cashtagInput: string,
  amountCents: number,
  currency: string,
): PayMethod | null {
  const tag = normalizeCashtag(cashtagInput);
  if (!tag) return null;
  if (!currencyAllowedFor("cashapp", currency)) return null;
  return {
    id: "cashapp",
    kind: "cashapp",
    label: "Cash App",
    url: `https://cash.app/$${encodeURIComponent(tag)}/${amountForUrl(amountCents)}`,
    amountPrefilled: true,
    caveat: "No reference can be attached — Cash App links carry no note.",
  };
}

// --- UPI -------------------------------------------------------------------

/** `local@handle`: the VPA shape. Deliberately strict — it goes into a URI unescaped. */
const UPI_VPA_RE = /^[A-Za-z0-9._-]{2,64}@[A-Za-z][A-Za-z0-9.-]{1,64}$/;

/**
 * A fully static deep link. The UI renders this exact same string as a QR code
 * (offline, same component as the EPC QR) — payload and link must stay equal.
 */
export function upiLink(
  vpaInput: string,
  payeeName: string,
  amountCents: number,
  currency: string,
  reference: string,
): PayMethod | null {
  const vpa = vpaInput.trim();
  if (!UPI_VPA_RE.test(vpa)) return null;
  if (!currencyAllowedFor("upi", currency)) return null;
  // vpa is emitted raw: UPI apps expect the literal "@", and the regex above
  // already excludes everything that could break out of the query string.
  const params = [
    `pa=${vpa}`,
    `pn=${encodeURIComponent(payeeName.trim())}`,
    `am=${amountForUrl(amountCents)}`,
    "cu=INR",
    `tn=${encodeURIComponent(reference.trim())}`,
  ];
  return {
    id: "upi",
    kind: "upi",
    label: "UPI",
    url: `upi://pay?${params.join("&")}`,
    amountPrefilled: true,
  };
}

// --- Crypto ----------------------------------------------------------------

const CRYPTO_SCHEMES: Record<string, string> = {
  bitcoin: "bitcoin",
  ethereum: "ethereum",
  monero: "monero",
};

const CRYPTO_CAVEAT =
  "No amount is embedded — the payer's wallet converts the fiat amount at pay time. If the link does nothing, copy the address.";

/**
 * Any currency: the ledger stays fiat-denominated and this app has no network,
 * so it can never convert. Nothing amount-carrying is ever emitted — no
 * `amount=`, and Monero's `tx_amount` stays deliberately unused.
 *
 * Returns null for network "other"/undefined: those have no URI scheme, and an
 * empty url would be a broken link. The UI falls back to the raw address alone
 * (appendix A.3); for the schemes that do exist, `rawAddress` on the returned
 * method carries that same address for the mandatory copy button.
 */
export function cryptoLink(
  method: CryptoPaymentMethod,
  reference: string,
  payeeName: string,
): PayMethod | null {
  const address = method.address.trim();
  if (!address) return null; // non-empty is the only address check: no checksum validation
  const scheme = CRYPTO_SCHEMES[method.network ?? ""];
  if (!scheme) return null;
  let url = `${scheme}:${encodeRfc3986(address)}`;
  if (scheme === "monero") {
    const params: string[] = [];
    if (reference.trim())
      params.push(`tx_description=${encodeRfc3986(reference.trim())}`);
    if (payeeName.trim())
      params.push(`recipient_name=${encodeRfc3986(payeeName.trim())}`);
    if (params.length) url += `?${params.join("&")}`;
  }
  return {
    id: "crypto",
    kind: "crypto",
    label: method.label.trim() || "Crypto",
    url,
    amountPrefilled: false,
    caveat: CRYPTO_CAVEAT,
    rawAddress: address,
  };
}

// --- Custom template -----------------------------------------------------

const MAX_TEMPLATE_LEN = 2000;

/** Returns an error message if the template is unsafe/invalid, else null. */
export function validateCustomTemplate(template: string): string | null {
  if (template.length === 0) return "Template is empty.";
  if (template.length > MAX_TEMPLATE_LEN) return "Template is too long.";
  if (!/^https:\/\//i.test(template))
    return "Template must start with https://.";
  return null;
}

export function customLink(
  method: CustomPaymentMethod,
  amountCents: number,
  currency: string,
  reference: string,
): PayMethod | null {
  const { id, label, urlTemplate: template } = method;
  if (validateCustomTemplate(template) !== null) return null;
  const url = template
    .split("{amount}")
    .join(amountForUrl(amountCents))
    .split("{currency}")
    .join(encodeURIComponent(currency))
    .split("{ref}")
    .join(encodeURIComponent(reference));
  // Re-validate after substitution: a placeholder value could not have
  // introduced "https://" itself (encodeURIComponent strips ":" and "/"),
  // but this keeps the guarantee airtight against future placeholder changes.
  if (!/^https:\/\//i.test(url)) return null;
  return {
    id: `custom:${id}`,
    kind: "custom",
    label: label || "Custom",
    url,
    amountPrefilled: true,
  };
}

// --- Aggregate -------------------------------------------------------------

/**
 * Which payment methods this creditor can offer for this debt, in a fixed,
 * deterministic order. `payeeName` (the creditor's display name) feeds UPI's
 * `pn` and Monero's `recipient_name`; it falls back to the profile's account
 * holder, then to empty.
 */
export function paymentMethodsFor(
  profile: PaymentProfile,
  amountCents: number,
  currency: string,
  reference: string,
  payeeName?: string,
): PayMethod[] {
  const name = payeeName ?? profile.accountHolder ?? "";
  const methods: PayMethod[] = [];
  if (profile.paypalMe) {
    const m = paypalLink(profile.paypalMe, amountCents, currency);
    if (m) methods.push(m);
  }
  if (profile.revolutTag) {
    const m = revolutLink(profile.revolutTag);
    if (m) methods.push(m);
  }
  if (profile.wiseTag) {
    const m = wiseLink(profile.wiseTag);
    if (m) methods.push(m);
  }
  if (profile.venmo) {
    const m = venmoLink(profile.venmo);
    if (m) methods.push(m);
  }
  if (profile.monzoMe) {
    const m = monzoLink(profile.monzoMe, amountCents, currency, reference);
    if (m) methods.push(m);
  }
  if (profile.bunqMe) {
    const m = bunqLink(profile.bunqMe, amountCents, currency, reference);
    if (m) methods.push(m);
  }
  if (profile.cashtag) {
    const m = cashAppLink(profile.cashtag, amountCents, currency);
    if (m) methods.push(m);
  }
  if (profile.upiVpa) {
    const m = upiLink(profile.upiVpa, name, amountCents, currency, reference);
    if (m) methods.push(m);
  }
  if (profile.crypto) {
    const m = cryptoLink(profile.crypto, reference, name);
    if (m) methods.push(m);
  }
  // Custom templates last, in stored order, so the list stays stable across
  // peers. Each keeps its own id, so several can coexist without colliding.
  for (const c of profile.customs ?? []) {
    const m = customLink(c, amountCents, currency, reference);
    if (m) methods.push(m);
  }
  return methods;
}
