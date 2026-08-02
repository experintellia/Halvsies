// Bank transfer is not a euro-only method. An IBAN is ISO 13616 — used in ~85
// countries — so a GBP/CHF/SEK transfer to one is completely ordinary. What is
// EUR-only is the EPC069-12 QR code, which encodes a SEPA Credit Transfer.
// This app used to conflate the two and blank the whole block (IBAN, holder,
// BIC, reference) for any non-EUR group, costing those users a working payment
// method. These tests pin the two gates apart.
//
// Mounting pattern, flush() and tap() are lifted from render.test.tsx.
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { render } from "preact";
import { PayUpSheet } from "../src/ui/PayUpSheet";
import { getSettings, setProfile, setSettings } from "../src/state/doc";
import type { Transfer } from "../src/state/model";
import { uninstallWebxdc } from "./webxdc-mock";

let host: HTMLDivElement;

/** Preact batches state updates — let the scheduled re-render land. */
const flush = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

/** Taps ride pointerup in this app (see Row.tsx), so tests must too. */
function tap(el: Element | undefined | null): void {
  if (!el) throw new Error("tap() got no element");
  el.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  el.dispatchEvent(new Event("pointerup", { bubbles: true }));
}

/** Values live in readOnly inputs now, so textContent cannot see them. */
const fieldValues = (root: ParentNode = host): string[] =>
  Array.from(root.querySelectorAll<HTMLInputElement>("input.copy-input")).map(
    (i) => i.value,
  );

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  render(null, host);
  host.remove();
  uninstallWebxdc();
});

describe("PayUpSheet bank transfer", () => {
  const CREDITOR = "b@example.org";
  const TRANSFER: Transfer = {
    fromId: "a@example.org",
    toId: CREDITOR,
    amountCents: 2350,
  };
  const IBAN = "DE89370400440532013000";
  const IBAN_SHOWN = "DE89 3704 0044 0532 0130 00";

  let currency: string;
  beforeEach(() => {
    currency = getSettings().groupCurrency;
  });
  afterEach(() => {
    setProfile(CREDITOR, {}); // shared singleton doc
    setSettings({ groupCurrency: currency });
  });

  const sheetIn = (groupCurrency: string): void => {
    setSettings({ groupCurrency });
    render(
      <PayUpSheet
        transfer={TRANSFER}
        direction="pay"
        open
        onClose={() => {}}
      />,
      host,
    );
  };

  const buttons = (text: string): HTMLButtonElement[] =>
    Array.from(host.querySelectorAll("button")).filter((b) =>
      (b.textContent ?? "").includes(text),
    ) as HTMLButtonElement[];

  it("GBP: shows the IBAN, holder and reference, but no QR — and says why", () => {
    setProfile(CREDITOR, {
      iban: IBAN,
      accountHolder: "Anna",
      bic: "COBADEFF",
    });
    sheetIn("GBP");

    const text = host.textContent ?? "";
    expect(text).toContain("Bank transfer");
    // Each transcribable value is its own labelled, copyable field.
    const values = fieldValues();
    expect(values).toContain(IBAN_SHOWN);
    expect(values).toContain("Anna");
    expect(values).toContain("COBADEFF");
    expect(values.some((v) => v.includes("Halvsies"))).toBe(true); // reference
    expect(text).toContain("Account holder");
    expect(text).toContain("Reference");
    expect(text).toContain("£23.50");

    // The scannable code is the only casualty, and the copy says exactly that.
    expect(host.querySelector("svg.qr-code")).toBeNull();
    expect(text).not.toContain("Scan with your banking app");
    expect(text).toContain("EPC QR only supports EUR");
    expect(text).toContain("Only the scannable code is missing");
    expect(text).toContain("the details below work for a transfer in GBP");

    // Not a "they added nothing" screen — they added a perfectly usable IBAN.
    expect(text).not.toContain("hasn't added any payment details");
  });

  it("EUR: the same creditor gets the QR as well", () => {
    setProfile(CREDITOR, { iban: IBAN, accountHolder: "Anna" });
    sheetIn("EUR");

    const text = host.textContent ?? "";
    expect(host.querySelector("svg.qr-code")).not.toBeNull();
    expect(text).toContain("Scan with your banking app");
    expect(fieldValues()).toContain(IBAN_SHOWN);
    expect(text).not.toContain("QR unavailable");
  });

  it("a non-EUR currency does not suppress the copy buttons", async () => {
    setProfile(CREDITOR, { iban: IBAN, accountHolder: "Anna" });

    for (const groupCurrency of ["GBP", "CHF", "SEK", "EUR"]) {
      render(null, host); // drop the previous button's transient "Copied"
      sheetIn(groupCurrency);
      await flush();
      // One Copy per transcribable value: holder, IBAN, reference.
      expect(buttons("Copy").length).toBeGreaterThanOrEqual(3);
      expect(
        Array.from(host.querySelectorAll("button"))
          .map((b) => b.getAttribute("aria-label"))
          .filter(Boolean),
      ).toEqual(
        expect.arrayContaining([
          "Copy IBAN",
          "Copy payment reference",
          "Copy Account holder",
        ]),
      );
      // Tap-safe per Row.tsx: pointerup alone activates it, in any currency.
      const copy = Array.from(host.querySelectorAll("button")).find(
        (b) => b.getAttribute("aria-label") === "Copy IBAN",
      ) as HTMLButtonElement;
      tap(copy);
      await flush();
      expect(copy.textContent).toBe("Copied");
    }
  });

  it("no bank block at all when the IBAN is missing or fails mod-97", () => {
    for (const iban of [undefined, "", "DE89370400440532013001", "nonsense"]) {
      setProfile(CREDITOR, { iban, accountHolder: "Anna" });
      sheetIn("GBP");

      const text = host.textContent ?? "";
      expect(text).not.toContain("Bank transfer");
      expect(fieldValues()).toHaveLength(0);
      expect(host.querySelector("svg.qr-code")).toBeNull();
      // Nothing usable was configured, so the empty-profile nudge is correct.
      expect(text).toContain("hasn't added any payment details");
    }
  });
});
