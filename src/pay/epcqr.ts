// EPC069-12 ("SEPA Credit Transfer" QR) payload builder + validation.
// https://www.europeanpaymentscouncil.eu — "Quick Response Code: Guidelines to
// Enable Data Capture for the Initiation of a SEPA Credit Transfer".

import { isValidIban, normalizeIban, isValidBic } from "./iban";

export interface EpcParams {
  name: string;
  iban: string;
  amountCents: number;
  currency: string;
  reference?: string;
  bic?: string;
  purpose?: string;
}

const MAX_PAYLOAD_BYTES = 331;

function formatAmount(cents: number): string {
  const whole = Math.trunc(cents / 100);
  const frac = (cents % 100).toString().padStart(2, "0");
  return `EUR${whole}.${frac}`;
}

/** Builds the newline-joined EPC069-12 payload. Fields are emitted as-is; call
 * validateEpcParams first to enforce length/format limits. */
export function buildEpcPayload(p: EpcParams): string {
  const fields = [
    "BCD",
    "002",
    "1",
    "SCT",
    // Normalized like the IBAN below: a profile is written by another chat
    // member and only the local form normalizes on input, so a spaced or
    // lowercase BIC ("coba deff xxx") would otherwise pass validation (which
    // normalizes before checking) and land out-of-spec in the payload.
    p.bic ? normalizeIban(p.bic) : "",
    p.name,
    normalizeIban(p.iban),
    formatAmount(p.amountCents),
    p.purpose ?? "",
    "", // structured creditor reference — unused, mutually exclusive with field 11
    p.reference ?? "",
    "", // beneficiary-to-originator information
  ];
  // The spec permits omitting trailing empty fields, and requires the payload
  // not end in a separator — joining all 12 with an empty field 12 would leave
  // a trailing LF that strict scanners reject. Never trim below field 8
  // (Amount), which is the last one we always populate.
  while (fields.length > 8 && fields[fields.length - 1] === "") fields.pop();
  return fields.join("\n");
}

function hasNewline(s: string | undefined): boolean {
  return !!s && s.includes("\n");
}

/** Returns null if params are valid, else a short human-readable reason. */
export function validateEpcParams(p: EpcParams): string | null {
  // The SCT scheme is EUR-denominated, so the *QR* is EUR-only. This says
  // nothing about bank transfers at large: an IBAN (ISO 13616, ~85 countries)
  // is paid in GBP/CHF/SEK/… every day. Callers must gate only the QR on this,
  // never the IBAN/holder/BIC/reference details.
  if (p.currency !== "EUR") return "EPC QR only supports EUR";
  if (
    !Number.isInteger(p.amountCents) ||
    p.amountCents < 1 ||
    p.amountCents > 99999999999
  )
    return "amount out of range";
  if (p.name.length === 0 || p.name.length > 70)
    return "name must be 1-70 characters";
  if (!isValidIban(p.iban)) return "invalid IBAN";
  if (p.bic !== undefined && p.bic !== "" && !isValidBic(p.bic))
    return "invalid BIC";
  if (p.reference !== undefined && p.reference.length > 140)
    return "reference must be at most 140 characters";
  if (p.purpose !== undefined && p.purpose.length > 4)
    return "purpose must be at most 4 characters";
  if (
    hasNewline(p.name) ||
    hasNewline(p.iban) ||
    hasNewline(p.reference) ||
    hasNewline(p.bic) ||
    hasNewline(p.purpose)
  )
    return "fields must not contain newlines";

  const payload = buildEpcPayload(p);
  if (new TextEncoder().encode(payload).length > MAX_PAYLOAD_BYTES)
    return "payload exceeds 331 bytes";

  return null;
}

/** Builds the unstructured remittance text, truncated to 140 chars on a word
 * boundary. Em dashes are swapped for hyphens for scanner compatibility. */
export function epcReference(
  groupTitle: string | undefined,
  expenseTitle?: string,
): string {
  const title = groupTitle?.trim();
  let text = title ? `Halvsies: ${title}` : "Halvsies";
  const expense = expenseTitle?.trim();
  if (expense) text += ` - ${expense}`;
  text = text.replace(/—/g, "-");

  if (text.length <= 140) return text;
  const cut = text.slice(0, 140);
  const lastSpace = cut.lastIndexOf(" ");
  return lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
}
