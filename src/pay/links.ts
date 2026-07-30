// Payment deep-link generators (Plan.md §5 M2). Pure functions only — no I/O,
// no DOM. Every generator skips silently (returns null) on invalid/missing
// input rather than emitting a broken or unsafe link.

import type { PaymentProfile } from "../state/model";

export interface PayMethod {
  kind: "paypal" | "revolut" | "wise" | "venmo" | "monzo" | "custom";
  label: string; // "PayPal", "Revolut", "Monzo", or the custom label
  url: string; // the deep link, amount pre-filled where supported
  amountPrefilled: boolean; // false where the service can't take an amount
  caveat?: string; // e.g. the Monzo limits, shown as a UI hint
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
  if (currency !== "GBP") return "Monzo only supports GBP.";
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
    kind: "monzo",
    label: "Monzo",
    url: `https://monzo.me/${encodeURIComponent(user)}/${amountForUrl(amountCents)}?d=${encodeURIComponent(reference)}`,
    amountPrefilled: true,
    caveat: MONZO_LIMITS_CAVEAT,
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
  label: string,
  template: string,
  amountCents: number,
  currency: string,
  reference: string,
): PayMethod | null {
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
    kind: "custom",
    label: label || "Custom",
    url,
    amountPrefilled: true,
  };
}

// --- Aggregate -------------------------------------------------------------

/** Which payment methods this creditor can offer for this debt, in a fixed, deterministic order. */
export function paymentMethodsFor(
  profile: PaymentProfile,
  amountCents: number,
  currency: string,
  reference: string,
): PayMethod[] {
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
  if (profile.custom) {
    const m = customLink(
      profile.custom.label,
      profile.custom.urlTemplate,
      amountCents,
      currency,
      reference,
    );
    if (m) methods.push(m);
  }
  return methods;
}
