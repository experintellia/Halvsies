// Shared type contract for the whole app (Plan.md §4). All Yjs-backed data
// shapes and cross-module value types live here — nothing else defines these.

export type MemberId = string;
export type ExpenseId = string;
export type SettlementId = string;

/** Y.Map "settings" (single entry). */
export interface Settings {
  /** ISO 4217 code, e.g. "EUR". All expenses/balances render in this currency. */
  groupCurrency: string;
  title?: string;
}

/** Y.Map "members" entry, keyed by MemberId. */
export interface Member {
  id: MemberId;
  name: string;
  /** true for members added manually (e.g. "Grandma") who never open the app. */
  isVirtual: boolean;
  /** webxdc.selfAddr, set for real members who registered themselves. */
  addr?: string;
}

export interface CustomPaymentMethod {
  /** Stable id so a list of these can be edited/removed without reordering bugs. */
  id: string;
  label: string;
  /** e.g. "https://pay.example/{amount}/{currency}/{ref}" */
  urlTemplate: string;
}

/**
 * A crypto address to receive at. Deliberately NOT amount-carrying: the ledger
 * is fiat-denominated and this app has no network, so it cannot convert. The
 * payer's wallet does the conversion at pay time (Plan.md §5 M2).
 */
export interface CryptoPaymentMethod {
  /** User-facing name, e.g. "Bitcoin" or "USDC on Base". */
  label: string;
  address: string;
  /** Selects the URI scheme; anything else means "show the address only". */
  network?: "bitcoin" | "ethereum" | "monero" | "other";
}

/** Y.Map "profiles" entry, keyed by MemberId — self-edited only. */
export interface PaymentProfile {
  paypalMe?: string;
  iban?: string;
  accountHolder?: string;
  bic?: string;
  revolutTag?: string;
  wiseTag?: string;
  venmo?: string;
  monzoMe?: string;
  /** bunq.me handle (EUR). */
  bunqMe?: string;
  /** Cash App $cashtag, stored WITHOUT the leading "$". */
  cashtag?: string;
  /** UPI virtual payment address, e.g. "anna@upi" (INR). */
  upiVpa?: string;
  crypto?: CryptoPaymentMethod;
  /** Any number of user-defined link templates (Twint, MobilePay, PayNow…). */
  customs?: CustomPaymentMethod[];
  /** Free text: "IBAN transfers only please", "no PayPal after the 3rd", … */
  note?: string;
}

export type SplitMode = "even" | "weights" | "exact";

export interface Split {
  mode: SplitMode;
  /**
   * Keyed by MemberId. Meaning depends on mode:
   * - "even": participant set — keys matter, values are ignored.
   * - "weights": relative share weights (any positive numbers).
   * - "exact": integer cents each member owes; must sum to the expense amount.
   */
  entries: Record<MemberId, number>;
}

/** Y.Map "expenses" entry, keyed by ExpenseId (ULID-like, sortable). */
export interface Expense {
  id: ExpenseId;
  title: string;
  amountCents: number;
  payerId: MemberId;
  split: Split;
  /** ISO date string, e.g. "2026-07-30". */
  date: string;
  category?: string;
  createdBy: MemberId;
  /** ms timestamp of last edit, passed in by the caller (never Date.now() internally). */
  editedAt: number;
}

/** Y.Map "settlements" entry, keyed by SettlementId — a recorded/marked-paid payment. */
export interface Settlement {
  id: SettlementId;
  fromId: MemberId;
  toId: MemberId;
  amountCents: number;
  /** free-text label of how it was paid, e.g. "PayPal", "cash". */
  method?: string;
  date: string;
  createdBy: MemberId;
}

/** One suggested payment produced by simplify.ts to zero out net balances. */
export interface Transfer {
  fromId: MemberId;
  toId: MemberId;
  amountCents: number;
}

/**
 * ISO-4217 shape check. Intl.NumberFormat throws RangeError on anything that
 * isn't three ASCII letters, so every write path that can set a currency must
 * gate on this — a bad value is durable CRDT state that would otherwise blank
 * the app on every peer, including inside the provider flush.
 */
export function isCurrencyCode(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z]{3}$/.test(v);
}

/** Formats integer cents as a localized currency string. Divides by 100 only here. */
export function formatMoney(
  cents: number,
  currency: string,
  locale?: string,
): string {
  // Defence in depth: writers gate on isCurrencyCode, but a peer still running
  // an older build can sync a malformed code. Falling back to a plain number
  // keeps the UI (and the provider flush) alive instead of throwing RangeError.
  if (!isCurrencyCode(currency)) return (cents / 100).toFixed(2);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  }).format(cents / 100);
}

/**
 * A ULID-ish lexicographically-sortable id: base36 timestamp (fixed width,
 * zero-padded) + a short random suffix. `timestampMs` is a parameter, never
 * Date.now() internally, so callers stay deterministic/testable (Plan.md §7).
 */
export function newId(timestampMs: number, seq = 0): string {
  const ts = timestampMs.toString(36).padStart(9, "0");
  const suffix = (seq >>> 0).toString(36).padStart(4, "0");
  const rand = Math.random().toString(36).slice(2, 6).padStart(4, "0");
  return `${ts}${suffix}${rand}`;
}
