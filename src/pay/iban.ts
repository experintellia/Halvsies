// ISO 13616 IBAN validation + display formatting. Pure, no DOM.

/** Strips all whitespace and uppercases. */
export function normalizeIban(input: string): string {
  return input.replace(/\s+/g, "").toUpperCase();
}

const IBAN_SHAPE = /^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/;

/** Full ISO 13616 check: shape + mod-97 == 1, computed incrementally (no BigInt). */
export function isValidIban(input: string): boolean {
  const iban = normalizeIban(input);
  if (iban.length < 15 || iban.length > 34) return false;
  if (!IBAN_SHAPE.test(iban)) return false;

  const rearranged = iban.slice(4) + iban.slice(0, 4);

  let remainder = 0;
  for (const ch of rearranged) {
    const code = ch.charCodeAt(0);
    // Letters A-Z map to 10-35 (two digits each); digits map to themselves.
    const digits = code >= 65 && code <= 90 ? String(code - 55) : ch;
    for (const d of digits) {
      remainder = (remainder * 10 + Number(d)) % 97;
    }
  }
  return remainder === 1;
}

/** Groups the normalized IBAN in 4s for display, e.g. "DE89 3704 0044 0532 0130 00". */
export function formatIban(input: string): string {
  const iban = normalizeIban(input);
  return (iban.match(/.{1,4}/g) ?? []).join(" ");
}

const BIC_SHAPE = /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/;

export function isValidBic(input: string): boolean {
  return BIC_SHAPE.test(normalizeIban(input));
}
