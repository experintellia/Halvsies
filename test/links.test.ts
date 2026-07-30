import { describe, expect, it } from "vitest";
import {
  amountForUrl,
  customLink,
  monzoLink,
  monzoUnavailableReason,
  paymentMethodsFor,
  paypalLink,
  revolutLink,
  validateCustomTemplate,
  venmoLink,
  wiseLink,
} from "../src/pay/links";
import type { PaymentProfile } from "../src/state/model";

describe("amountForUrl", () => {
  it("formats cents as a 2-decimal string", () => {
    expect(amountForUrl(2350)).toBe("23.50");
    expect(amountForUrl(5)).toBe("0.05");
    expect(amountForUrl(0)).toBe("0.00");
  });
});

describe("paypalLink", () => {
  it("produces the exact expected URL", () => {
    const m = paypalLink("alice", 2350, "EUR");
    expect(m?.url).toBe("https://paypal.me/alice/23.50EUR");
    expect(m?.amountPrefilled).toBe(true);
    expect(m?.kind).toBe("paypal");
  });

  it("normalizes a pasted full paypal.me URL to the handle", () => {
    const m = paypalLink("https://paypal.me/alice", 1000, "USD");
    expect(m?.url).toBe("https://paypal.me/alice/10.00USD");
  });

  it("normalizes a pasted URL with a trailing amount segment", () => {
    const m = paypalLink("paypal.me/bob/5", 1000, "USD");
    expect(m?.url).toBe("https://paypal.me/bob/10.00USD");
  });

  it("rejects handles over 20 chars or with non-alphanumeric chars", () => {
    expect(paypalLink("a".repeat(21), 100, "EUR")).toBeNull();
    expect(paypalLink("bad-handle", 100, "EUR")).toBeNull();
  });
});

describe("revolutLink", () => {
  it("produces the exact expected URL with no amount", () => {
    const m = revolutLink("alicetag");
    expect(m?.url).toBe("https://revolut.me/alicetag");
    expect(m?.amountPrefilled).toBe(false);
  });

  it("rejects tags outside 3-16 alphanumeric chars", () => {
    expect(revolutLink("ab")).toBeNull();
    expect(revolutLink("a".repeat(17))).toBeNull();
  });
});

describe("wiseLink", () => {
  it("produces the exact expected URL with no amount", () => {
    const m = wiseLink("alice-w");
    expect(m?.url).toBe("https://wise.com/pay/me/alice-w");
    expect(m?.amountPrefilled).toBe(false);
  });
});

describe("venmoLink", () => {
  it("produces the exact expected URL, no amount, US caveat", () => {
    const m = venmoLink("alice_v");
    expect(m?.url).toBe("https://venmo.com/u/alice_v");
    expect(m?.amountPrefilled).toBe(false);
    expect(m?.caveat).toMatch(/US-only/);
  });
});

describe("monzo", () => {
  it("is absent for non-GBP currency", () => {
    expect(monzoLink("alice", 2350, "EUR", "dinner")).toBeNull();
    expect(monzoUnavailableReason(2350, "EUR")).toMatch(/GBP/);
  });

  it("is absent below the £1 minimum", () => {
    expect(monzoLink("alice", 50, "GBP", "dinner")).toBeNull();
    expect(monzoUnavailableReason(50, "GBP")).toMatch(/minimum/);
  });

  it("is absent above the £100 limit", () => {
    expect(monzoLink("alice", 15000, "GBP", "dinner")).toBeNull();
    expect(monzoUnavailableReason(15000, "GBP")).toMatch(/limit/);
  });

  it("is present for a valid GBP amount with the limits caveat", () => {
    const m = monzoLink("alice", 2350, "GBP", "dinner split");
    expect(m?.url).toBe("https://monzo.me/alice/23.50?d=dinner%20split");
    expect(m?.amountPrefilled).toBe(true);
    expect(m?.caveat).toBe(
      "£1–£100 per payment; recipient max £1,000 per 30 days.",
    );
    expect(monzoUnavailableReason(2350, "GBP")).toBeNull();
  });
});

describe("custom template", () => {
  it("substitutes amount, currency and ref, with ref URL-encoded", () => {
    const m = customLink(
      "Twint",
      "https://pay.example/{amount}/{currency}/{ref}",
      2350,
      "CHF",
      "rent & bills",
    );
    expect(m?.url).toBe("https://pay.example/23.50/CHF/rent%20%26%20bills");
    expect(m?.label).toBe("Twint");
  });

  it("validateCustomTemplate rejects non-https and over-length templates", () => {
    expect(validateCustomTemplate("javascript:alert(1)")).not.toBeNull();
    expect(
      validateCustomTemplate("http://example.com/{amount}"),
    ).not.toBeNull();
    expect(validateCustomTemplate("data:text/html,x")).not.toBeNull();
    expect(validateCustomTemplate("https://ok.example/{amount}")).toBeNull();
    expect(
      validateCustomTemplate("https://ok.example/" + "a".repeat(2000)),
    ).not.toBeNull();
  });

  it("rejects an unsafe custom template entirely (no method emitted)", () => {
    expect(
      customLink("Evil", "javascript:alert(1)", 100, "EUR", "x"),
    ).toBeNull();
  });
});

describe("security: malicious profile fields never escape the intended host", () => {
  it("paypalMe with an embedded host is rejected, not partially trusted", () => {
    expect(paypalLink("evil.com/x", 100, "EUR")).toBeNull();
  });

  it("a handle containing ?, / or # is rejected by every alphanumeric-tag generator", () => {
    for (const bad of ["a?b", "a/b", "a#b"]) {
      expect(paypalLink(bad, 100, "EUR")).toBeNull();
      expect(revolutLink(bad.padEnd(3, "x"))).toBeNull();
      expect(wiseLink(bad)).toBeNull();
      expect(venmoLink(bad)).toBeNull();
      expect(monzoLink(bad, 2350, "GBP", "x")).toBeNull();
    }
  });

  it("a javascript: custom template never produces a method", () => {
    expect(customLink("x", "javascript:alert(1)", 100, "EUR", "x")).toBeNull();
  });

  it("every emitted URL's origin matches the intended host", () => {
    const profile: PaymentProfile = {
      paypalMe: "alice",
      revolutTag: "alicetag",
      wiseTag: "alice-w",
      venmo: "alice_v",
      monzoMe: "alice",
      custom: {
        label: "Twint",
        urlTemplate: "https://pay.example/{amount}/{currency}/{ref}",
      },
    };
    const expectedOrigins: Record<string, string> = {
      paypal: "https://paypal.me",
      revolut: "https://revolut.me",
      wise: "https://wise.com",
      venmo: "https://venmo.com",
      monzo: "https://monzo.me",
      custom: "https://pay.example",
    };
    const methods = paymentMethodsFor(profile, 2350, "GBP", "ref");
    for (const m of methods) {
      const origin = new URL(m.url).origin;
      expect(origin).toBe(expectedOrigins[m.kind]);
    }
  });
});

describe("paymentMethodsFor", () => {
  it("returns [] for an empty profile", () => {
    expect(paymentMethodsFor({}, 2350, "EUR", "ref")).toEqual([]);
  });

  it("returns methods in the fixed order regardless of profile key order", () => {
    const profileA: PaymentProfile = {
      custom: { label: "C", urlTemplate: "https://x.example/{amount}" },
      monzoMe: "alice",
      venmo: "alice_v",
      wiseTag: "alice-w",
      revolutTag: "alicetag",
      paypalMe: "alice",
    };
    const methods = paymentMethodsFor(profileA, 2350, "GBP", "ref");
    expect(methods.map((m) => m.kind)).toEqual([
      "paypal",
      "revolut",
      "wise",
      "venmo",
      "monzo",
      "custom",
    ]);
  });

  it("skips a method entirely when its field is absent", () => {
    const methods = paymentMethodsFor(
      { paypalMe: "alice" },
      2350,
      "EUR",
      "ref",
    );
    expect(methods.map((m) => m.kind)).toEqual(["paypal"]);
  });
});
