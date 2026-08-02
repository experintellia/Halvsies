// Which scannable code, if any, a bank transfer gets for this debt.
//
// Two standards, each locked to its own currency, so the debt's currency picks
// one and there is nothing for the user to choose: EPC069-12 encodes a SEPA
// Credit Transfer and is EUR-only; SPD ("QR Platba") is read by Czech banking
// apps and is offered for CZK only. Everything else gets no code — which is
// not the same as no bank transfer: the IBAN, holder, BIC and reference are
// still shown, because an IBAN is ISO 13616 and works in ~85 countries.
//
// One place decides, so the pay-up sheet and the profile preview cannot
// disagree about what the payer will actually see.

import { buildEpcPayload, validateEpcParams, type EpcParams } from "./epcqr";
import { buildSpdPayload, validateSpdParams } from "./spd";

export interface BankQrParams {
  name: string;
  iban: string;
  amountCents: number;
  currency: string;
  reference?: string;
  bic?: string;
}

export type BankQr =
  | {
      ok: true;
      format: "EPC" | "SPD";
      payload: string;
      /** One line telling the payer what to do with it. */
      hint: string;
    }
  | { ok: false; reason: string };

const epcParams = (p: BankQrParams): EpcParams => ({
  name: p.name,
  iban: p.iban,
  amountCents: p.amountCents,
  currency: p.currency,
  reference: p.reference,
  bic: p.bic,
});

export function bankQr(p: BankQrParams): BankQr {
  const epcError = validateEpcParams(epcParams(p));
  if (!epcError) {
    return {
      ok: true,
      format: "EPC",
      payload: buildEpcPayload(epcParams(p)),
      hint: "Scan with your banking app.",
    };
  }

  const spd = {
    iban: p.iban,
    amountCents: p.amountCents,
    currency: p.currency,
    message: p.reference,
    bic: p.bic,
  };
  if (!validateSpdParams(spd)) {
    return {
      ok: true,
      format: "SPD",
      payload: buildSpdPayload(spd),
      // Named, not just shown: a Czech-only code that looks generic is worse
      // than none, because the payer only finds out at their bank.
      hint: "Scan with a Czech banking app (QR Platba).",
    };
  }

  // Report the EUR gate, not the Czech one: it is the reason that applies to
  // almost everyone who reaches this branch.
  return { ok: false, reason: epcError };
}
