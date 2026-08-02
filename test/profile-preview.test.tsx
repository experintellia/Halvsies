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
import { setProfile, setSettings } from "../src/state/doc";
import { notOfferedReason } from "../src/pay/providers";
import { installWebxdc, uninstallWebxdc } from "./webxdc-mock";

const ME = "me@example.org";
let host: HTMLDivElement;

const flush = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

const show = (): string => host.textContent ?? "";
const preview = (): string => show().split("What others see")[1] ?? "";
const pills = (): string[] =>
  Array.from(host.querySelectorAll(".pill-warn")).map((p) =>
    (p.textContent ?? "").trim(),
  );

function mount(currency: string, profile: Parameters<typeof setProfile>[1]) {
  setSettings({ groupCurrency: currency, title: "Trip" });
  setProfile(ME, profile);
  render(<ProfileForm onOpenGroupSettings={() => {}} />, host);
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

describe("what others see", () => {
  it("offers a bunq handle in a EUR group, with no warning", () => {
    mount("EUR", { bunqMe: "anna" });
    expect(show()).toContain("bunq");
    expect(pills()).toHaveLength(0);
    expect(preview()).toContain("https://bunq.me/anna/10.00");
    expect(preview()).not.toContain("Nothing yet");
  });

  // The reported bug, end to end.
  it("explains a bunq handle that the group's currency excludes", () => {
    mount("SEK", { bunqMe: "anna" });

    // Still listed as configured — it is saved, it is just not usable here.
    expect(show()).toContain("bunq");
    expect(pills()).toContain("EUR only — not offered for SEK debts");

    // ...and the preview must not claim they have added nothing.
    expect(preview()).not.toContain("Nothing yet");
    expect(preview()).toContain("None of your saved methods work for SEK");
  });

  it("still says 'nothing yet' when there really is nothing", () => {
    mount("SEK", {});
    expect(preview()).toContain("Nothing yet");
    expect(pills()).toHaveLength(0);
  });

  it("warns only about the methods the currency actually excludes", () => {
    mount("SEK", { bunqMe: "anna", paypalMe: "anna", cashtag: "anna" });

    // PayPal has no currency gate, so it is offered and unmarked.
    expect(preview()).toContain("https://paypal.me/anna/10.00SEK");
    expect(preview()).not.toContain("Nothing yet");
    expect(pills().sort()).toEqual([
      "EUR only — not offered for SEK debts",
      "USD or GBP only — not offered for SEK debts",
    ]);
  });
});
