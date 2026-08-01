// Metadata for the "add a payment method" wizard: what to call each provider,
// where the user actually finds their handle, and how to check what they typed.
//
// This is a table rather than a switch because three places need the same
// facts — the picker, the help step, and the saved-methods list. Adding a
// provider should mean adding one row here and one optional field on
// PaymentProfile, nothing else.

import type { PaymentProfile } from "../state/model";
import {
  monzoLink,
  paypalLink,
  revolutLink,
  venmoLink,
  wiseLink,
} from "./links";

/** The PaymentProfile keys that hold a single provider handle. */
export type HandleField =
  "paypalMe" | "revolutTag" | "wiseTag" | "venmo" | "monzoMe";

export interface ProviderSpec {
  field: HandleField;
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
  /** Set when the method only works under conditions worth stating up front. */
  caveat?: string;
}

// Each validator reuses the real generator, so the wizard can never accept a
// handle that paymentMethodsFor() would later silently drop. Monzo is checked
// with a forced GBP in-range amount to isolate the *username* format from the
// currency/limit gate, which is a property of the debt, not of the profile.
const check =
  (fn: (v: string) => unknown, msg: string) =>
  (value: string): string | null =>
    fn(value.trim()) ? null : msg;

export const PROVIDERS: readonly ProviderSpec[] = [
  {
    field: "paypalMe",
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
      "Only offered when the debt is in GBP, and only for £1–£100 per payment (you can receive max £1,000 per 30 days).",
  },
] as const;

export function providerFor(field: HandleField): ProviderSpec {
  const spec = PROVIDERS.find((p) => p.field === field);
  if (!spec) throw new Error(`unknown payment provider field: ${field}`);
  return spec;
}

/** Handle-based providers the profile already has a value for. */
export function configuredProviders(p: PaymentProfile): ProviderSpec[] {
  return PROVIDERS.filter((spec) => (p[spec.field] ?? "").trim() !== "");
}
