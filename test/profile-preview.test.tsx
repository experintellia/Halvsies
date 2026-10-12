// The Me tab has to be honest about what a payer will actually be offered.
//
// The bug this pins: currency gates drop a saved method from the payer's sheet
// silently, so a creditor who had just added a bunq handle to a SEK group saw
// the method listed under "Your payment details" and, directly below it,
// "Nothing yet — fill in at least one method above." Nothing about that screen
// told them the two statements were about the same thing.
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { render } from "preact";
import { ProfileForm } from "../src/ui/ProfileForm";
import { getProfile, setProfile, setSettings } from "../src/state/doc";
import { notOfferedReason } from "../src/pay/providers";
import { installWebxdc, uninstallWebxdc } from "./webxdc-mock";

const ME = "me@example.org";
let host: HTMLDivElement;

const flush = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

const show = (): string => host.textContent ?? "";

/** Taps ride pointerup in this app (see Row.tsx), so tests must too. */
function tap(el: Element | undefined | null): void {
  if (!el) throw new Error("tap() got no element");
  el.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  el.dispatchEvent(new Event("pointerup", { bubbles: true }));
}

const buttonWith = (text: string): HTMLButtonElement | undefined =>
  Array.from(host.querySelectorAll("button")).find((b) =>
    (b.textContent ?? "").includes(text),
  ) as HTMLButtonElement | undefined;

/** Each saved method's row: its name line, its detail line and its tag. */
const rows = (): { name: string; detail: string; tag: string }[] =>
  Array.from(host.querySelectorAll(".list .row:not(.add-row)")).map((r) => ({
    name: (r.querySelector(".method-name")?.textContent ?? "").trim(),
    detail: (r.querySelector(".method-detail")?.textContent ?? "").trim(),
    tag: (r.querySelector(".tag")?.textContent ?? "").trim(),
  }));
const row = (name: string) => rows().find((r) => r.name.startsWith(name));

function mount(currency: string, profile: Parameters<typeof setProfile>[1]) {
  setSettings({ groupCurrency: currency, title: "Trip" });
  setProfile(ME, profile);
  render(<ProfileForm />, host);
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  installWebxdc({ selfAddr: ME, selfName: "Me" });
});

afterEach(async () => {
  render(null, host);
  host.remove();
  setProfile(ME, {});
  setSettings({ groupCurrency: "EUR" });
  uninstallWebxdc();
  await flush();
});

describe("notOfferedReason", () => {
  it("names the currencies a method is limited to", () => {
    expect(notOfferedReason({ kind: "bunq" }, "SEK")).toBe(
      "EUR only — not offered for SEK debts",
    );
    expect(notOfferedReason({ kind: "cashapp" }, "EUR")).toBe(
      "USD or GBP only — not offered for EUR debts",
    );
  });

  it("says nothing when the method is fine", () => {
    expect(notOfferedReason({ kind: "bunq" }, "EUR")).toBeNull();
    expect(notOfferedReason({ kind: "bunq" }, "  eur ")).toBeNull();
    // No currency limit at all.
    expect(notOfferedReason({ kind: "paypal" }, "SEK")).toBeNull();
    expect(notOfferedReason({ kind: "revolut" }, "INR")).toBeNull();
  });
});

// The preview used to be a second list under the methods; now each method's
// row says what a payer gets, and these pin that it says so truthfully.
describe("the method rows", () => {
  it("offers a bunq handle in a EUR group, with no warning", () => {
    mount("EUR", { bunqMe: "anna" });
    expect(row("bunq")).toEqual({
      name: "bunq",
      detail: "anna",
      tag: "Fills in amount",
    });
    expect(show()).not.toContain("None of your saved methods");
  });

  // The reported bug, end to end.
  it("explains a bunq handle that the group's currency excludes", () => {
    mount("SEK", { bunqMe: "anna" });

    // Still listed as configured — it is saved, it is just not usable here —
    // and its row says why instead of promising what it does.
    expect(row("bunq")?.detail).toBe("EUR only — not offered for SEK debts");
    expect(row("bunq")?.tag).toBe("");

    // ...and the screen must not claim everything is fine.
    expect(show()).toContain("None of your saved methods work for SEK");
    expect(show()).not.toContain("No payment methods yet");
  });

  it("still says 'no payment methods yet' when there really is nothing", () => {
    mount("SEK", {});
    expect(show()).toContain("No payment methods yet");
    expect(rows()).toHaveLength(0);
  });

  it("warns only about the methods the currency actually excludes", () => {
    mount("SEK", { bunqMe: "anna", paypalMe: "anna", cashtag: "anna" });

    // PayPal has no currency gate, so it is offered and says what it does.
    expect(row("PayPal")?.tag).toBe("Fills in amount");
    expect(row("bunq")?.detail).toBe("EUR only — not offered for SEK debts");
    expect(row("Cash App")?.detail).toBe(
      "USD or GBP only — not offered for SEK debts",
    );
    expect(show()).not.toContain("None of your saved methods");
  });

  it("counts an address-only crypto method as offered", () => {
    mount("EUR", {
      crypto: { label: "USDC on Base", address: "0xabc", network: "other" },
    });
    expect(row("USDC on Base")?.tag).toBe("Address only");
    expect(show()).not.toContain("None of your saved methods");
  });

  it("says when the payer has to type the amount, and marks the preferred one", () => {
    mount("EUR", {
      revolutTag: "anna",
      iban: "DE89370400440532013000",
      accountHolder: "Anna",
      preferred: "bank",
    });
    expect(row("Revolut")?.tag).toBe("Payer types amount");
    expect(row("Bank transfer")).toEqual({
      name: "Bank transferPreferred",
      detail: "DE89 3704 0044 0532 0130 00",
      tag: "Fills in amount",
    });
    // No destructive buttons on the tab itself: Remove lives in the edit view.
    expect(show()).not.toContain("Remove");
  });
});

// Remove used to be a red button on every row of the Me tab. It now lives in
// the method's own edit view, next to the "preferred" switch.
describe("a method's edit view", () => {
  const openRow = async (name: string): Promise<void> => {
    tap(
      Array.from(host.querySelectorAll(".list .row")).find((r) =>
        (r.textContent ?? "").includes(name),
      ),
    );
    await flush();
  };

  it("removes the method from inside its edit view", async () => {
    mount("EUR", { paypalMe: "anna", revolutTag: "anna" });
    await openRow("PayPal");

    tap(buttonWith("Remove PayPal"));
    await flush();

    expect(getProfile(ME)?.paypalMe).toBeUndefined();
    expect(getProfile(ME)?.revolutTag).toBe("anna");
    expect(host.querySelector(".sheet")).toBeNull();
  });

  it("marks a method preferred, and moving the mark clears the old one", async () => {
    mount("EUR", {
      paypalMe: "anna",
      iban: "DE89370400440532013000",
      accountHolder: "Anna",
    });
    await openRow("PayPal");
    const box = host.querySelector<HTMLInputElement>(
      '.sheet input[type="checkbox"]',
    )!;
    expect(box.checked).toBe(false);
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    tap(buttonWith("Save"));
    await flush();
    expect(getProfile(ME)?.preferred).toBe("paypal");

    await openRow("Bank transfer");
    const bankBox = host.querySelector<HTMLInputElement>(
      '.sheet input[type="checkbox"]',
    )!;
    bankBox.checked = true;
    bankBox.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    tap(buttonWith("Save"));
    await flush();
    expect(getProfile(ME)?.preferred).toBe("bank");
  });

  it("re-adding the preferred method through the picker keeps the mark", async () => {
    mount("EUR", { paypalMe: "anna", bunqMe: "anna", preferred: "paypal" });
    tap(buttonWith("Add payment method"));
    await flush();
    tap(
      Array.from(host.querySelectorAll(".wizard-option")).find(
        (o) => o.querySelector("strong")?.textContent === "PayPal",
      ),
    );
    await flush();
    const box = host.querySelector<HTMLInputElement>(
      '.sheet input[type="checkbox"]',
    )!;
    expect(box.checked).toBe(true);
  });

  it("removing the preferred method clears the mark", async () => {
    mount("EUR", { paypalMe: "anna", bunqMe: "anna", preferred: "paypal" });
    await openRow("PayPal");
    tap(buttonWith("Remove PayPal"));
    await flush();
    expect(getProfile(ME)?.preferred).toBeUndefined();
  });
});
