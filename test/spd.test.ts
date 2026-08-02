// SPD / "QR Platba" — the Czech bank-transfer QR standard — and the one
// function that decides which QR standard (if any) a debt gets.
import { describe, expect, it } from "vitest";
import { buildSpdPayload, validateSpdParams } from "../src/pay/spd";
import { bankQr } from "../src/pay/bankqr";

const CZ_IBAN = "CZ6508000000192000145399";
const DE_IBAN = "DE89370400440532013000";

const spd = (over: Partial<Parameters<typeof buildSpdPayload>[0]> = {}) => ({
  iban: CZ_IBAN,
  amountCents: 2350,
  currency: "CZK",
  message: "Halvsies: Rome trip",
  ...over,
});

describe("validateSpdParams", () => {
  it("accepts a CZK debt to a valid IBAN", () => {
    expect(validateSpdParams(spd())).toBeNull();
  });

  // The whole point of the gate: the CC field takes any ISO 4217 code on
  // paper, but this is read by Czech banking apps paying in korunas. A QR that
  // looks scannable and isn't is worse than none — the payer finds out at the
  // bank, not here.
  it("refuses every currency but CZK", () => {
    for (const currency of ["EUR", "USD", "GBP", "SEK", "czk "]) {
      const reason = validateSpdParams(spd({ currency }));
      if (currency.trim().toUpperCase() === "CZK") continue;
      expect(reason).toMatch(/only supports CZK/);
    }
  });

  it("refuses a bad IBAN and a non-positive or oversized amount", () => {
    expect(validateSpdParams(spd({ iban: "CZ65080000001920001453" }))).toMatch(
      /valid IBAN/,
    );
    expect(validateSpdParams(spd({ amountCents: 0 }))).toMatch(
      /more than zero/,
    );
    expect(validateSpdParams(spd({ amountCents: -100 }))).toMatch(
      /more than zero/,
    );
    expect(validateSpdParams(spd({ amountCents: 1.5 }))).not.toBeNull();
    expect(validateSpdParams(spd({ amountCents: 10_000_000_000 }))).toMatch(
      /too large/,
    );
  });
});

describe("buildSpdPayload", () => {
  it("builds the documented shape", () => {
    expect(buildSpdPayload(spd())).toBe(
      `SPD*1.0*ACC:${CZ_IBAN}*AM:23.50*CC:CZK*MSG:HALVSIES: ROME TRIP`,
    );
  });

  it("appends the BIC to ACC when there is one", () => {
    expect(buildSpdPayload(spd({ bic: "GIBACZPX" }))).toContain(
      `ACC:${CZ_IBAN}+GIBACZPX`,
    );
  });

  it("formats whole and sub-unit amounts alike", () => {
    expect(buildSpdPayload(spd({ amountCents: 100 }))).toContain("AM:1.00");
    expect(buildSpdPayload(spd({ amountCents: 5 }))).toContain("AM:0.05");
    expect(buildSpdPayload(spd({ amountCents: 123456 }))).toContain(
      "AM:1234.56",
    );
  });

  // `*` is the field delimiter, so a value carrying one would split the record
  // and hand the scanner fields nobody wrote.
  it("never lets a value break the record apart", () => {
    const payload = buildSpdPayload(spd({ message: "PAY*ME*NOW" }));
    expect(payload.split("*").length).toBe(6); // SPD, 1.0, ACC, AM, CC, MSG
    expect(payload).toContain("MSG:PAY ME NOW");
  });

  it("strips accents rather than emitting bytes a scanner may mangle", () => {
    expect(buildSpdPayload(spd({ message: "Přerov — oběd" }))).toContain(
      "MSG:PREROV OBED",
    );
  });

  it("caps the message and drops the field when nothing survives", () => {
    const long = buildSpdPayload(spd({ message: "A".repeat(200) }));
    expect(long.split("MSG:")[1].length).toBe(60);
    expect(buildSpdPayload(spd({ message: "" }))).not.toContain("MSG:");
    expect(buildSpdPayload(spd({ message: "€€€" }))).not.toContain("MSG:");
  });
});

describe("bankQr", () => {
  const params = {
    name: "Anna",
    iban: DE_IBAN,
    amountCents: 2350,
    reference: "Halvsies: Rome trip",
  };

  it("uses the SEPA code for euros", () => {
    const qr = bankQr({ ...params, currency: "EUR" });
    expect(qr.ok && qr.format).toBe("EPC");
    expect(qr.ok && qr.payload.startsWith("BCD")).toBe(true);
    expect(qr.ok && qr.hint).toBe("Scan with your banking app.");
  });

  it("uses QR Platba for korunas, and says whose standard it is", () => {
    const qr = bankQr({ ...params, iban: CZ_IBAN, currency: "CZK" });
    expect(qr.ok && qr.format).toBe("SPD");
    expect(qr.ok && qr.payload.startsWith("SPD*1.0*")).toBe(true);
    // An unlabelled Czech-only code is worse than none: the payer has to be
    // able to tell it apart from a generic one before they try to scan it.
    expect(qr.ok && qr.hint).toMatch(/Czech/);
  });

  it("offers nothing for a currency neither standard covers", () => {
    for (const currency of ["GBP", "USD", "SEK", "CHF"]) {
      const qr = bankQr({ ...params, currency });
      expect(qr.ok).toBe(false);
      // The EUR gate is the reason that applies to almost everyone here.
      expect(!qr.ok && qr.reason).toMatch(/EUR/);
    }
  });

  it("offers nothing without a usable IBAN, in any currency", () => {
    expect(bankQr({ ...params, iban: "", currency: "EUR" }).ok).toBe(false);
    expect(bankQr({ ...params, iban: "nonsense", currency: "CZK" }).ok).toBe(
      false,
    );
  });
});
