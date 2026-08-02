// Short Payment Descriptor (SPD / SPAYD) — the Czech "QR Platba" standard,
// backed by the Czech Banking Association.
//
//   SPD*1.0*ACC:CZ6508000000192000145399*AM:23.50*CC:CZK*MSG:HALVSIES ROME TRIP
//
// Plain text, `KEY:VALUE` pairs separated by `*`. No checksum, no compression,
// no per-field slot order — considerably simpler than EPC069-12.
//
// CZK ONLY, deliberately. The `CC` field accepts any ISO 4217 code on paper,
// but in practice this is read by Czech banking apps paying in korunas, and a
// QR that looks scannable but isn't is worse than no QR at all — the payer
// finds out at the bank, not here. Same reasoning as the Monzo currency gate.
//
// Not implemented alongside it, and why: PAY by square (SK) is LZMA-compressed
// binary — a compression dependency against a 1 MB budget, for one country.
// Swiss QR-bill is designed as a payment slip rather than a standalone code.
// Bezahlcode (DE) is superseded by EPC.

import { isValidIban, normalizeIban } from "./iban";

export interface SpdParams {
  iban: string;
  amountCents: number;
  currency: string;
  /** Free-text note for the payer's statement. */
  message?: string;
  bic?: string;
}

/** The only currency this format is offered for. See the header. */
export const SPD_CURRENCY = "CZK";

/** SPD caps the message at 60 characters. */
const MAX_MESSAGE = 60;

/**
 * Largest amount SPD can carry: `AM` is at most 10 digits including the two
 * decimals, i.e. 99,999,999.99.
 */
const MAX_AMOUNT_CENTS = 9999999999;

/**
 * The QR alphanumeric mode covers 0-9, A-Z, space and `$%*+-./:` — staying
 * inside it keeps the code small and, more importantly, keeps every scanner
 * agreeing on what the bytes mean. `*` is the field delimiter, so it can never
 * survive in a value.
 */
function sanitizeMessage(text: string): string {
  return (
    text
      // Decompose accents and drop the combining marks: "Přerov" → "PREROV",
      // which a Czech banking app shows correctly, rather than mojibake.
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/[^0-9A-Z $%+\-./:]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_MESSAGE)
      .trim()
  );
}

/** Integer cents → "23.50". Dot decimal, always two places, no separators. */
function formatAmount(cents: number): string {
  const whole = Math.floor(cents / 100);
  return `${whole}.${(cents % 100).toString().padStart(2, "0")}`;
}

/** null when an SPD code can be built, otherwise why it cannot. */
export function validateSpdParams(p: SpdParams): string | null {
  if (p.currency?.trim().toUpperCase() !== SPD_CURRENCY) {
    return `QR Platba only supports ${SPD_CURRENCY}`;
  }
  if (!isValidIban(p.iban)) return "A valid IBAN is required";
  if (!Number.isInteger(p.amountCents) || p.amountCents <= 0) {
    return "Amount must be more than zero";
  }
  if (p.amountCents > MAX_AMOUNT_CENTS) return "Amount is too large for SPD";
  return null;
}

/**
 * The payload string, ready to render as a QR. Call {@link validateSpdParams}
 * first — this assumes valid input, exactly as buildEpcPayload does.
 *
 * `ACC` carries `IBAN+BIC` when a BIC is known; the plain IBAN otherwise.
 */
export function buildSpdPayload(p: SpdParams): string {
  const iban = normalizeIban(p.iban);
  const bic = p.bic ? normalizeIban(p.bic) : "";
  const fields = [
    `ACC:${bic ? `${iban}+${bic}` : iban}`,
    `AM:${formatAmount(p.amountCents)}`,
    `CC:${SPD_CURRENCY}`,
  ];
  const message = sanitizeMessage(p.message ?? "");
  if (message) fields.push(`MSG:${message}`);
  return `SPD*1.0*${fields.join("*")}`;
}
