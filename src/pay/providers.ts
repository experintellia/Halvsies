// Metadata for the "add a payment method" wizard: what to call each provider,
// where the user actually finds their handle, and how to check what they typed.
//
// This is a table rather than a switch because three places need the same
// facts — the picker, the help step, and the saved-methods list. Adding a
// provider should mean adding one row here and one optional field on
// PaymentProfile, nothing else.

import type { CryptoPaymentMethod, PaymentProfile } from "../state/model";
import {
  bunqLink,
  cashAppLink,
  cryptoLink,
  currenciesFor,
  monzoLink,
  paypalLink,
  revolutLink,
  upiLink,
  venmoLink,
  wiseLink,
  type PayMethodKind,
} from "./links";

/** The PaymentProfile keys that hold a single provider handle. */
export type HandleField =
  | "paypalMe"
  | "revolutTag"
  | "wiseTag"
  | "venmo"
  | "monzoMe"
  | "bunqMe"
  | "cashtag"
  | "upiVpa";

export interface ProviderSpec {
  field: HandleField;
  /** The links.ts kind, so the currency gate is read from there, never re-declared. */
  kind: PayMethodKind;
  label: string;
  /** One line under the title in the picker. */
  blurb: string;
  /** Step 2 heading: literally where to look. */
  whereToFind: string;
  placeholder: string;
  /** Shown as a hint below the input. */
  example: string;
  /** null when the value is usable, else why it isn't. */
  validate: (value: string) => string | null;
  /** Applied before storing, where the stored shape differs from what's typed. */
  normalize?: (value: string) => string;
  /** Set when the method only works under conditions worth stating up front. */
  caveat?: string;
}

// Each validator reuses the real generator, so the wizard can never accept a
// handle that paymentMethodsFor() would later silently drop. Anything with a
// currency or amount gate is checked with a forced in-range amount in an
// allowed currency, to isolate the *handle* format from the currency/limit
// gate, which is a property of the debt, not of the profile.
const check =
  (fn: (v: string) => unknown, msg: string) =>
  (value: string): string | null =>
    fn(value.trim()) ? null : msg;

export const PROVIDERS: readonly ProviderSpec[] = [
  {
    field: "paypalMe",
    kind: "paypal",
    label: "PayPal",
    blurb: "Pays with the amount already filled in.",
    whereToFind:
      "Open PayPal → Send/Request → PayPal.Me, or visit paypal.me and sign in. Your link looks like paypal.me/yourname — you need the last part.",
    placeholder: "yourname",
    example: "You can paste the whole paypal.me/yourname link; we'll trim it.",
    validate: check(
      (v) => paypalLink(v, 1000, "EUR"),
      "That doesn't look like a PayPal.Me handle (letters and numbers, up to 20).",
    ),
  },
  {
    field: "revolutTag",
    kind: "revolut",
    label: "Revolut",
    blurb: "Opens your Revolut profile. Amount not pre-filled.",
    whereToFind:
      "Revolut app → tap your avatar (top left) → your @tag is under your name. Enter it without the @.",
    placeholder: "yourtag",
    example: "3–16 letters or numbers.",
    validate: check(
      revolutLink,
      "That doesn't look like a Revolut tag (3–16 letters or numbers).",
    ),
    caveat: "Revolut can't pre-fill the amount — the payer types it in.",
  },
  {
    field: "wiseTag",
    kind: "wise",
    label: "Wise",
    blurb: "Opens your Wise payment page. Amount not pre-filled.",
    whereToFind:
      "Wise app → Home → Receive → your Wisetag is shown as @yourtag. Enter it without the @.",
    placeholder: "yourtag",
    example: "Letters, numbers, dots, dashes.",
    validate: check(wiseLink, "That doesn't look like a Wise tag."),
    caveat: "Wise can't pre-fill the amount — the payer types it in.",
  },
  {
    field: "venmo",
    kind: "venmo",
    label: "Venmo",
    blurb: "Opens your Venmo profile. Amount not pre-filled.",
    whereToFind:
      "Venmo app → Me → your username is under your name, starting with @. Enter it without the @.",
    placeholder: "yourname",
    example: "Letters, numbers, dashes, underscores.",
    validate: check(venmoLink, "That doesn't look like a Venmo username."),
    caveat: "Venmo is US-only in practice, and can't pre-fill the amount.",
  },
  {
    field: "monzoMe",
    kind: "monzo",
    label: "Monzo",
    blurb: "UK only. The payer needs no Monzo account.",
    whereToFind:
      "Monzo app → Account → Monzo.Me. Your link looks like monzo.me/yourname — you need the last part.",
    placeholder: "yourname",
    example: "Letters, numbers, dots, dashes.",
    // Forced GBP + in-range amount: this step checks the username only.
    validate: check(
      (v) => monzoLink(v, 1000, "GBP", "x"),
      "That doesn't look like a Monzo.Me username.",
    ),
    caveat:
      "Only £1–£100 per payment (you can receive max £1,000 per 30 days).",
  },
  {
    field: "bunqMe",
    kind: "bunq",
    label: "bunq",
    blurb: "Pays with the amount filled in. No bunq account needed.",
    whereToFind:
      "bunq app → tap your avatar (top left) → Profile → bunq.me. Your link looks like bunq.me/yourname — you need the last part. If you've never opened that screen, bunq asks you to pick the name there first.",
    placeholder: "yourname",
    example: "Letters, numbers, dots, dashes.",
    // Forced EUR + in-range amount: this step checks the handle only.
    validate: check(
      (v) => bunqLink(v, 1000, "EUR", "x"),
      "That doesn't look like a bunq.me name.",
    ),
    caveat:
      "The payer needs no bunq account — the landing page takes iDEAL/Wero, Bancontact, card and Apple/Google Pay. Above €2,000 iDEAL drops out, so they'd pay by card or in two goes.",
  },
  {
    field: "cashtag",
    kind: "cashapp",
    label: "Cash App",
    blurb: "US/UK. Pays with the amount already filled in.",
    whereToFind:
      "Cash App → tap your profile icon (top right) → your $cashtag is right under your name. Enter it without the $.",
    placeholder: "yourname",
    example: "Letters, numbers, dashes, underscores — the $ is optional here.",
    // Forced USD: this step checks the cashtag only.
    validate: check(
      (v) => cashAppLink(v, 1000, "USD"),
      "That doesn't look like a $cashtag.",
    ),
    // Stored without the "$" (see PaymentProfile.cashtag); links.ts re-adds it.
    normalize: (v) => v.trim().replace(/^\$/, ""),
    caveat: "No reference can be attached — Cash App links carry no note.",
  },
  {
    field: "upiVpa",
    kind: "upi",
    label: "UPI",
    blurb: "India. Opens any UPI app with the amount filled in.",
    whereToFind:
      "Your UPI ID is in whichever app you use: PhonePe → tap your photo (top left) → UPI IDs; Google Pay → tap your photo → your UPI IDs; Paytm → Profile → UPI & Payment Settings. It looks like yourname@okhdfcbank or 9876543210@ybl.",
    placeholder: "yourname@okhdfcbank",
    example: "The whole thing, including the part after the @.",
    // Forced INR + in-range amount: this step checks the VPA only.
    validate: check(
      (v) => upiLink(v, "You", 1000, "INR", "x"),
      "That doesn't look like a UPI ID (something@bank).",
    ),
    caveat:
      "Opens the payer's UPI app (GPay, PhonePe, Paytm…) with the amount and reference already filled in.",
  },
] as const;

/** Copy for the crypto step. Not a ProviderSpec: it stores an object, not a handle. */
export const CRYPTO_STEP = {
  label: "Crypto",
  blurb: "One wallet address, shown with a copy button.",
  whereToFind:
    "Your wallet app → Receive. Copy the address as text (not the QR image) and pick the matching network below. If your wallet offers a fresh receiving address, use that one.",
  hint: "The amount is not embedded — the payer's wallet converts the amount you're owed.",
} as const;

/** The networks the crypto step offers, in picker order. */
export const CRYPTO_NETWORKS = [
  { value: "bitcoin", label: "Bitcoin" },
  { value: "ethereum", label: "Ethereum" },
  { value: "monero", label: "Monero" },
  { value: "other", label: "Other (address only)" },
] as const satisfies readonly {
  value: NonNullable<CryptoPaymentMethod["network"]>;
  label: string;
}[];

/**
 * Same contract as ProviderSpec.validate, for the crypto step's three fields.
 * "other" has no URI scheme, so cryptoLink() returns null by design — that is a
 * savable method (the UI shows the raw address), not an invalid one.
 */
export function validateCrypto(method: CryptoPaymentMethod): string | null {
  if (!method.label.trim()) return "Give it a name, e.g. Bitcoin.";
  if (!method.address.trim()) return "Paste your wallet address.";
  if (
    method.network &&
    method.network !== "other" &&
    !cryptoLink(method, "x", "x")
  )
    return "That address can't be turned into a payment link.";
  return null;
}

export function providerFor(field: HandleField): ProviderSpec {
  const spec = PROVIDERS.find((p) => p.field === field);
  if (!spec) throw new Error(`unknown payment provider field: ${field}`);
  return spec;
}

/** Handle-based providers the profile already has a value for. */
export function configuredProviders(p: PaymentProfile): ProviderSpec[] {
  return PROVIDERS.filter((spec) => (p[spec.field] ?? "").trim() !== "");
}

// --- the picker table ------------------------------------------------------

/** What tapping a picker entry puts the wizard into. */
export type PickerTarget =
  | { kind: "provider"; field: HandleField }
  | { kind: "bank" }
  | { kind: "crypto" }
  | { kind: "custom" };

export interface PickerEntry {
  target: PickerTarget;
  label: string;
  blurb: string;
  /** Currencies this entry will actually be offered for; null = any. */
  currencies: readonly string[] | null;
}

const providerEntry = (field: HandleField): PickerEntry => {
  const spec = providerFor(field);
  return {
    target: { kind: "provider", field },
    label: spec.label,
    blurb: spec.blurb,
    currencies: currenciesFor(spec.kind),
  };
};

/**
 * Picker order, grouped. Sections and their contents are data, not JSX
 * branches, so re-ordering is an edit here and nowhere else.
 */
export const PICKER_SECTIONS: readonly {
  id: string;
  title: string;
  entries: readonly PickerEntry[];
}[] = [
  {
    id: "bank",
    title: "Bank & national standards",
    // Brazil's PIX (BR Code payload) belongs in this section if it's ever added.
    entries: [
      {
        target: { kind: "bank" },
        label: "Bank transfer",
        // An IBAN is ISO 13616, not a euro thing — a GBP/CHF/SEK transfer to
        // one is ordinary, so the method takes any currency (null). Only the
        // EPC069-12 QR is EUR-only (see validateEpcParams() in epcqr.ts), and
        // currencyPill can only say "method unavailable", which would be a
        // lie here — so that caveat lives in the blurb, which renders in every
        // currency, instead of in the pill.
        blurb: "Works in any currency. The scannable QR code is EUR-only.",
        currencies: null,
      },
      providerEntry("upiVpa"),
    ],
  },
  {
    id: "apps",
    title: "Payment apps",
    entries: [
      providerEntry("paypalMe"),
      providerEntry("revolutTag"),
      providerEntry("wiseTag"),
      providerEntry("venmo"),
      providerEntry("monzoMe"),
      providerEntry("bunqMe"),
      providerEntry("cashtag"),
    ],
  },
  {
    id: "other",
    title: "Anything else",
    entries: [
      {
        target: { kind: "crypto" },
        label: CRYPTO_STEP.label,
        blurb: CRYPTO_STEP.blurb,
        currencies: currenciesFor("crypto"),
      },
      {
        target: { kind: "custom" },
        label: "Custom link",
        blurb: "Anything else — Twint, MobilePay, PayNow…",
        currencies: currenciesFor("custom"),
      },
    ],
  },
];

/**
 * Short warning pill for a method that won't be offered in this group's
 * currency, e.g. "EUR only" / "USD or GBP only". null when it's fine.
 * A warning, never a block: the group currency can change after setup.
 */
export function currencyPill(
  currencies: readonly string[] | null,
  currency: string,
): string | null {
  if (!currencies) return null;
  if (currencies.includes(currency.trim().toUpperCase())) return null;
  return `${currencies.join(" or ")} only`;
}

/**
 * Why a *saved* provider is not being offered in this group, or null when it
 * is. Same gate as {@link currencyPill}, worded for someone looking at their
 * own profile rather than at a picker.
 *
 * The profile screen needs this because a method the currency excludes simply
 * vanishes from what the payer sees — and a creditor who has just added a bunq
 * handle to a SEK group has no way to tell that from the app being broken.
 */
export function notOfferedReason(
  spec: Pick<ProviderSpec, "kind">,
  currency: string,
): string | null {
  const code = currency.trim().toUpperCase();
  const currencies = currenciesFor(spec.kind);
  if (!currencies || currencies.includes(code)) return null;
  return `${currencies.join(" or ")} only — not offered for ${code} debts`;
}
