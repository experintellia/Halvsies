import { describe, expect, it } from "vitest";
import {
  amountForUrl,
  bunqLink,
  cashAppLink,
  cryptoLink,
  currenciesFor,
  currencyAllowedFor,
  customLink,
  monzoLink,
  monzoUnavailableReason,
  paymentMethodsFor,
  paypalLink,
  revolutLink,
  upiLink,
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

describe("bunq", () => {
  it("produces the exact expected URL with an encoded description", () => {
    const m = bunqLink("anna", 2350, "EUR", "Rome trip");
    expect(m?.url).toBe("https://bunq.me/anna/23.50/Rome%20trip");
    expect(m?.amountPrefilled).toBe(true);
    expect(m?.caveat).toMatch(/no bunq account/i);
  });

  it("omits the description segment when there is no reference", () => {
    expect(bunqLink("anna", 2350, "EUR", "  ")?.url).toBe(
      "https://bunq.me/anna/23.50",
    );
  });

  it("adds the iDEAL cap hint only above €2,000", () => {
    expect(bunqLink("anna", 200_000, "EUR", "x")?.caveat).not.toMatch(/2,000/);
    expect(bunqLink("anna", 200_001, "EUR", "x")?.caveat).toMatch(/2,000/);
  });

  it("is EUR-only", () => {
    expect(bunqLink("anna", 2350, "GBP", "Rome trip")).toBeNull();
    expect(bunqLink("anna", 2350, "USD", "Rome trip")).toBeNull();
  });

  it("rejects handles with path or query characters", () => {
    for (const bad of ["a/b", "a?b", "a#b", ""]) {
      expect(bunqLink(bad, 2350, "EUR", "x")).toBeNull();
    }
  });
});

describe("cashAppLink", () => {
  it("produces the exact expected URL, amount in the path, no note param", () => {
    const m = cashAppLink("anna", 2350, "USD");
    expect(m?.url).toBe("https://cash.app/$anna/23.50");
    expect(m?.amountPrefilled).toBe(true);
    expect(m?.url).not.toMatch(/[?&]/);
  });

  it("normalizes a pasted $cashtag and a pasted cash.app URL", () => {
    expect(cashAppLink("$anna", 2350, "USD")?.url).toBe(
      "https://cash.app/$anna/23.50",
    );
    expect(cashAppLink("https://cash.app/$anna", 2350, "USD")?.url).toBe(
      "https://cash.app/$anna/23.50",
    );
    expect(cashAppLink("cash.app/anna/5", 2350, "USD")?.url).toBe(
      "https://cash.app/$anna/23.50",
    );
  });

  it("accepts USD and GBP only", () => {
    expect(cashAppLink("anna", 2350, "GBP")?.url).toBe(
      "https://cash.app/$anna/23.50",
    );
    expect(cashAppLink("anna", 2350, "EUR")).toBeNull();
    expect(cashAppLink("anna", 2350, "INR")).toBeNull();
  });

  it("rejects cashtags over 20 chars or with path/query characters", () => {
    expect(cashAppLink("a".repeat(21), 100, "USD")).toBeNull();
    for (const bad of ["a?b", "a/b", "a#b"]) {
      expect(cashAppLink(bad, 100, "USD")).toBeNull();
    }
  });
});

describe("upiLink", () => {
  it("produces the exact expected deep link", () => {
    const m = upiLink("anna@upi", "Anna Müller", 2350, "INR", "Rome trip");
    expect(m?.url).toBe(
      "upi://pay?pa=anna@upi&pn=Anna%20M%C3%BCller&am=23.50&cu=INR&tn=Rome%20trip",
    );
    expect(m?.amountPrefilled).toBe(true);
  });

  it("is INR-only", () => {
    expect(upiLink("anna@upi", "Anna", 2350, "EUR", "x")).toBeNull();
    expect(upiLink("anna@upi", "Anna", 2350, "USD", "x")).toBeNull();
  });

  it("rejects anything that is not a local@handle VPA", () => {
    for (const bad of ["anna", "anna@", "@upi", "anna@upi&am=1", "a b@upi"]) {
      expect(upiLink(bad, "Anna", 2350, "INR", "x")).toBeNull();
    }
  });
});

describe("cryptoLink", () => {
  it("produces bare scheme:address URIs for bitcoin and ethereum", () => {
    expect(
      cryptoLink(
        { label: "Bitcoin", address: "bc1qexampleaddr", network: "bitcoin" },
        "Rome trip",
        "Anna",
      )?.url,
    ).toBe("bitcoin:bc1qexampleaddr");
    expect(
      cryptoLink(
        { label: "USDC on Base", address: "0xAbC123", network: "ethereum" },
        "Rome trip",
        "Anna",
      )?.url,
    ).toBe("ethereum:0xAbC123");
  });

  it("carries RFC-3986-encoded tx_description and recipient_name on Monero", () => {
    const m = cryptoLink(
      { label: "Monero", address: "4AddrExample", network: "monero" },
      "Rome trip (Anna's)",
      "Anna Müller",
    );
    expect(m?.url).toBe(
      "monero:4AddrExample?tx_description=Rome%20trip%20%28Anna%27s%29&recipient_name=Anna%20M%C3%BCller",
    );
  });

  it("never embeds an amount, in any network", () => {
    for (const network of ["bitcoin", "ethereum", "monero"] as const) {
      const m = cryptoLink(
        { label: network, address: "addr1", network },
        "Rome trip",
        "Anna",
      );
      expect(m?.amountPrefilled).toBe(false);
      expect(m?.url).not.toMatch(/amount/i);
      expect(m?.url).not.toMatch(/tx_amount/);
      expect(m?.url).not.toMatch(/23\.50/);
    }
  });

  it("exposes the raw address alongside the URI", () => {
    const m = cryptoLink(
      { label: "Bitcoin", address: "  bc1qexampleaddr  ", network: "bitcoin" },
      "",
      "",
    );
    expect(m?.rawAddress).toBe("bc1qexampleaddr");
    expect(m?.url).toBe("bitcoin:bc1qexampleaddr");
  });

  it("returns null when there is no URI scheme or no address", () => {
    expect(
      cryptoLink({ label: "L", address: "a", network: "other" }, "", ""),
    ).toBeNull();
    expect(cryptoLink({ label: "L", address: "a" }, "", "")).toBeNull();
    expect(
      cryptoLink({ label: "L", address: "   ", network: "bitcoin" }, "", ""),
    ).toBeNull();
  });
});

describe("currency gates", () => {
  it("currenciesFor is the single source of truth (null = any currency)", () => {
    expect(currenciesFor("bunq")).toEqual(["EUR"]);
    expect(currenciesFor("cashapp")).toEqual(["USD", "GBP"]);
    expect(currenciesFor("upi")).toEqual(["INR"]);
    expect(currenciesFor("monzo")).toEqual(["GBP"]);
    expect(currenciesFor("crypto")).toBeNull();
    expect(currenciesFor("paypal")).toBeNull();
    expect(currencyAllowedFor("bunq", "eur")).toBe(true);
    expect(currencyAllowedFor("bunq", "GBP")).toBe(false);
  });

  const everything: PaymentProfile = {
    paypalMe: "anna",
    revolutTag: "annatag",
    wiseTag: "anna-w",
    venmo: "anna_v",
    monzoMe: "anna",
    bunqMe: "anna",
    cashtag: "anna",
    upiVpa: "anna@upi",
    crypto: { label: "Bitcoin", address: "bc1qaddr", network: "bitcoin" },
  };

  const kindsFor = (currency: string) =>
    paymentMethodsFor(everything, 2350, currency, "Rome trip", "Anna").map(
      (m) => m.kind,
    );

  it("EUR offers bunq and hides Monzo/CashApp/UPI", () => {
    const kinds = kindsFor("EUR");
    expect(kinds).toContain("bunq");
    expect(kinds).toContain("crypto");
    expect(kinds).not.toContain("monzo");
    expect(kinds).not.toContain("cashapp");
    expect(kinds).not.toContain("upi");
  });

  it("GBP offers Monzo and Cash App, hides bunq/UPI", () => {
    const kinds = kindsFor("GBP");
    expect(kinds).toContain("monzo");
    expect(kinds).toContain("cashapp");
    expect(kinds).not.toContain("bunq");
    expect(kinds).not.toContain("upi");
  });

  it("USD offers Cash App only of the gated methods", () => {
    const kinds = kindsFor("USD");
    expect(kinds).toContain("cashapp");
    expect(kinds).not.toContain("monzo");
    expect(kinds).not.toContain("bunq");
    expect(kinds).not.toContain("upi");
  });

  it("INR offers UPI only of the gated methods", () => {
    const kinds = kindsFor("INR");
    expect(kinds).toContain("upi");
    expect(kinds).not.toContain("bunq");
    expect(kinds).not.toContain("cashapp");
    expect(kinds).not.toContain("monzo");
  });

  it("crypto is offered in every currency", () => {
    for (const c of ["EUR", "GBP", "USD", "INR", "JPY"]) {
      expect(kindsFor(c)).toContain("crypto");
    }
  });
});

describe("custom template", () => {
  it("substitutes amount, currency and ref, with ref URL-encoded", () => {
    const m = customLink(
      {
        id: "c1",
        label: "Twint",
        urlTemplate: "https://pay.example/{amount}/{currency}/{ref}",
      },
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
      customLink(
        { id: "c1", label: "Evil", urlTemplate: "javascript:alert(1)" },
        100,
        "EUR",
        "x",
      ),
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
    expect(
      customLink(
        { id: "c1", label: "x", urlTemplate: "javascript:alert(1)" },
        100,
        "EUR",
        "x",
      ),
    ).toBeNull();
  });

  it("every emitted URL's origin matches the intended host", () => {
    const profile: PaymentProfile = {
      paypalMe: "alice",
      revolutTag: "alicetag",
      wiseTag: "alice-w",
      venmo: "alice_v",
      monzoMe: "alice",
      customs: [
        {
          id: "c1",
          label: "Twint",
          urlTemplate: "https://pay.example/{amount}/{currency}/{ref}",
        },
      ],
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
      customs: [
        { id: "c1", label: "C", urlTemplate: "https://x.example/{amount}" },
      ],
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

  it("keeps ids unique with every field populated at once", () => {
    const profile: PaymentProfile = {
      paypalMe: "anna",
      revolutTag: "annatag",
      wiseTag: "anna-w",
      venmo: "anna_v",
      monzoMe: "anna",
      bunqMe: "anna",
      cashtag: "anna",
      upiVpa: "anna@upi",
      crypto: { label: "Bitcoin", address: "bc1qaddr", network: "bitcoin" },
      accountHolder: "Anna",
      customs: [
        { id: "c1", label: "A", urlTemplate: "https://a.example/{amount}" },
        { id: "c2", label: "B", urlTemplate: "https://b.example/{amount}" },
      ],
    };
    for (const currency of ["EUR", "GBP", "USD", "INR"]) {
      const ids = paymentMethodsFor(profile, 2350, currency, "Rome trip").map(
        (m) => m.id,
      );
      expect(new Set(ids).size).toBe(ids.length);
    }
    // GBP hits the most methods at once (Monzo + Cash App).
    expect(
      paymentMethodsFor(profile, 2350, "GBP", "Rome trip").map((m) => m.kind),
    ).toEqual([
      "paypal",
      "revolut",
      "wise",
      "venmo",
      "monzo",
      "cashapp",
      "crypto",
      "custom",
      "custom",
    ]);
  });

  it("falls back to the profile's account holder as the UPI payee name", () => {
    const [upi] = paymentMethodsFor(
      { upiVpa: "anna@upi", accountHolder: "Anna Müller" },
      2350,
      "INR",
      "Rome trip",
    );
    expect(upi.url).toContain("pn=Anna%20M%C3%BCller");
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
