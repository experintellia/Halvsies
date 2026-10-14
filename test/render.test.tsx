// Render smoke tests. These exist because the first build of this app shipped
// screens that typechecked, passed every unit test, and rendered literally
// nothing but placeholder text — no test touched a component, so nothing
// caught it. These mount the real screens against the real doc module and
// assert something meaningful is on the page.
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { render } from "preact";
import { App } from "../src/ui/App";
import { ExpenseList, dayHeading } from "../src/ui/ExpenseList";
import { ProfileForm } from "../src/ui/ProfileForm";
import { addExpense, deleteExpense } from "../src/state/doc";
import { PayUpSheet } from "../src/ui/PayUpSheet";
import { Balances } from "../src/ui/Balances";
import { MembersSheet } from "../src/ui/MembersSheet";
import { ClaimPrompt } from "../src/ui/ClaimPrompt";
import { initials } from "../src/ui/components/Avatar";
import {
  addVirtualMember,
  getSettings,
  importSnapshot,
  removeMember,
  setProfile,
  setSettings,
} from "../src/state/doc";
import type { Transfer } from "../src/state/model";
import { installWebxdc, uninstallWebxdc } from "./webxdc-mock";

let host: HTMLDivElement;

/** Preact batches state updates — let the scheduled re-render land. */
const flush = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Taps ride pointerup in this app (see Row.tsx), so tests must too — and Row
 * only counts a pointerup it armed on pointerdown (so a scroll that ends over
 * a row isn't a tap), hence both events.
 */
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
  render(null, host); // unmount so effects/subscriptions don't leak between tests
  host.remove();
  // Components read window.webxdc?.selfAddr on every render — never leave one
  // installed, or the next test silently becomes a different person.
  uninstallWebxdc();
});

describe("App shell", () => {
  // App now shows the first-run setup screen until the group is configured,
  // and nothing behind it mounts — so these tests have to start from a
  // configured group, the same as every real second open.
  beforeEach(() => setSettings({ groupCurrency: "EUR", title: "Test group" }));

  it("mounts the real screens, not placeholders", () => {
    render(<App />, host);
    const text = host.textContent ?? "";
    expect(text).not.toContain("goes here");
    // The three tabs are present...
    for (const tab of ["Expenses", "Balances", "Me"]) {
      expect(text).toContain(tab);
    }
    // ...and the default tab rendered actual expense-screen content.
    expect(host.querySelector(".tab-bar")).not.toBeNull();
  });

  it("switches to the Me tab and renders the profile screen", async () => {
    render(<App />, host);
    tap(
      Array.from(host.querySelectorAll("button")).find((b) =>
        (b.textContent ?? "").includes("Me"),
      ),
    );
    await flush();
    expect(host.textContent).toContain("Add payment method");
  });
});

describe("ExpenseList", () => {
  const EXPENSE = {
    id: "e-test-1",
    title: "Dinner",
    amountCents: 4400,
    payerId: "a@example.org",
    split: {
      mode: "even" as const,
      entries: { "a@example.org": 0, "b@example.org": 0 },
    },
    date: "2026-08-01",
    createdBy: "a@example.org",
    editedAt: 0,
  };

  beforeEach(() => addExpense(EXPENSE));
  afterEach(() => deleteExpense(EXPENSE.id)); // shared singleton doc

  const buttonWith = (text: string): HTMLButtonElement | undefined =>
    Array.from(host.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes(text),
    ) as HTMLButtonElement | undefined;

  it("opens a read-only summary, not the edit form, when a row is tapped", async () => {
    render(<ExpenseList />, host);
    tap(host.querySelector(".row"));
    await flush();

    const text = host.textContent ?? "";
    expect(host.querySelector(".sheet")).not.toBeNull();
    expect(text).toContain("Split evenly");
    expect(text).toContain("€44.00");
    // The whole point: nothing here can change the ledger by accident.
    expect(buttonWith("Save")).toBeUndefined();
    expect(buttonWith("Delete")).toBeUndefined();
    expect(host.querySelectorAll("input")).toHaveLength(0);
    expect(buttonWith("Edit")).not.toBeUndefined();
  });

  it("reaches the edit form from the summary's Edit button", async () => {
    render(<ExpenseList />, host);
    tap(host.querySelector(".row"));
    await flush();
    tap(buttonWith("Edit"));
    await flush();

    expect(host.textContent).toContain("Edit expense");
    expect(buttonWith("Save")).not.toBeUndefined();
  });

  it("names the weekday, and never shifts the date by a timezone", () => {
    // Parsing "2026-05-06" with Date.parse gives UTC midnight, which prints as
    // Tuesday the 5th for everyone west of Greenwich.
    expect(dayHeading("2026-05-06")).toContain("Wednesday");
    expect(dayHeading("2026-05-06")).toMatch(/\b6\b/);
    expect(dayHeading("2026-01-01")).toContain("Thursday");
    // A ledger imported from elsewhere can carry anything; better the raw
    // string than a header reading "Invalid Date".
    expect(dayHeading("whenever")).toBe("whenever");
  });

  it("groups by day, newest first, with one header per day", () => {
    // Deliberately out of order, and the *last* added belongs to the oldest
    // day: grouping runs of creation order would print 07-30 twice.
    const extra = [
      { ...EXPENSE, id: "e-test-2", title: "Beer", date: "2026-07-30" },
      { ...EXPENSE, id: "e-test-3", title: "Cab", date: "2026-08-01" },
      { ...EXPENSE, id: "e-test-4", title: "Museum", date: "2026-07-30" },
    ];
    extra.forEach(addExpense);
    try {
      render(<ExpenseList />, host);

      const headings = Array.from(
        host.querySelectorAll(".day-heading > span:first-child"),
      ).map((h) => (h.textContent ?? "").trim());
      expect(headings).toEqual([
        dayHeading("2026-08-01"),
        dayHeading("2026-07-30"),
      ]);
      // Each day header carries that day's total.
      expect(host.querySelector(".day-heading")?.textContent).toContain(
        "€88.00",
      );

      // Newest day first, newest-added first inside it.
      const titles = Array.from(host.querySelectorAll(".expense-title")).map(
        (t) => t.textContent,
      );
      expect(titles).toEqual(["Cab", "Dinner", "Museum", "Beer"]);

      // The date is the header's job now, not the card's.
      expect(host.querySelector(".row")?.textContent).not.toContain("2026-");
    } finally {
      extra.forEach((e) => deleteExpense(e.id));
    }
  });
});

describe("ProfileForm", () => {
  it("starts collapsed: no method rows, an add button, and the note field", () => {
    render(<ProfileForm />, host);
    const text = host.textContent ?? "";

    // The whole point of the redesign: methods are not all splayed out.
    expect(host.querySelectorAll(".list .row:not(.add-row)")).toHaveLength(0);
    expect(text).toContain("Add payment method");
    expect(text).toContain("No payment methods yet");

    // The note is always visible, with or without any configured method.
    expect(host.querySelector("textarea")).not.toBeNull();
    expect(text).toContain("Note to payers");
  });

  /** Opens the wizard picker. */
  const openPicker = async (): Promise<void> => {
    render(<ProfileForm />, host);
    tap(
      Array.from(host.querySelectorAll("button")).find((b) =>
        (b.textContent ?? "").includes("Add payment method"),
      ),
    );
    await flush();
  };

  const option = (label: string): HTMLElement | undefined =>
    Array.from(host.querySelectorAll(".wizard-option")).find(
      (b) => (b.querySelector("strong")?.textContent ?? "").trim() === label,
    ) as HTMLElement | undefined;

  /** The wizard page only — the profile screen behind it has fields too. */
  const wizard = (): HTMLElement =>
    host.querySelector(".subpage") as HTMLElement;

  it("opens the wizard picker listing every provider", async () => {
    await openPicker();

    const text = host.textContent ?? "";
    for (const label of [
      "PayPal",
      "Revolut",
      "Wise",
      "Venmo",
      "Monzo",
      "bunq",
      "Cash App",
      "UPI",
      "Crypto",
      "Bank transfer",
      "Custom link",
    ]) {
      expect(text).toContain(label);
    }
    expect(
      host.querySelectorAll(".wizard-option").length,
    ).toBeGreaterThanOrEqual(11);
  });

  it("groups the picker under three headings, in order", async () => {
    await openPicker();

    expect(
      Array.from(host.querySelectorAll(".picker-section")).map((h) =>
        (h.textContent ?? "").trim(),
      ),
    ).toEqual(["Bank & national standards", "Payment apps", "Anything else"]);
    // Bank transfer leads the first section; Custom link closes the last.
    const options = Array.from(host.querySelectorAll(".wizard-option"));
    expect(options[0].textContent).toContain("Bank transfer");
    expect(options[options.length - 1].textContent).toContain("Custom link");
  });

  // MANUAL CA4 (EUR)
  it("pills the methods the group currency (EUR) can't use", async () => {
    await openPicker();

    // Warning, not a block: the entries stay tappable.
    expect(option("Monzo")?.querySelector(".pill-warn")?.textContent).toBe(
      "GBP only",
    );
    expect(option("Cash App")?.querySelector(".pill-warn")?.textContent).toBe(
      "USD or GBP only",
    );
    expect(option("UPI")?.querySelector(".pill-warn")?.textContent).toBe(
      "INR only",
    );
    // EUR-native or currency-agnostic methods carry no pill.
    expect(option("Bank transfer")?.querySelector(".pill-warn")).toBeNull();
    expect(option("bunq")?.querySelector(".pill-warn")).toBeNull();
    expect(option("PayPal")?.querySelector(".pill-warn")).toBeNull();
  });

  it("repeats the currency warning on the fill step, still letting you save", async () => {
    await openPicker();
    tap(option("Cash App"));
    await flush();

    const text = host.textContent ?? "";
    expect(text).toContain("USD or GBP only");
    expect(text).toContain("won't be offered for EUR debts");

    const input = wizard().querySelector("input") as HTMLInputElement;
    input.value = "anna";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    const save = Array.from(host.querySelectorAll("button")).find(
      (b) => (b.textContent ?? "").trim() === "Save",
    ) as HTMLButtonElement | undefined;
    expect(save?.disabled).toBe(false);
  });

  // MANUAL CA4 — CHF is nobody's native currency, so every gated method warns
  // at once, and none of them is blocked (the group currency may still change).
  it("CA4 — pills bunq, Cash App, UPI and Monzo in CHF, and still allows saving", async () => {
    const previous = getSettings().groupCurrency;
    setSettings({ groupCurrency: "CHF" });
    try {
      await openPicker();
      const pills: [string, string][] = [
        ["bunq", "EUR only"],
        ["Cash App", "USD or GBP only"],
        ["UPI", "INR only"],
        ["Monzo", "GBP only"],
      ];
      for (const [label, pill] of pills) {
        expect(option(label)?.querySelector(".pill-warn")?.textContent).toBe(
          pill,
        );
      }

      tap(option("bunq"));
      await flush();
      expect(host.textContent).toContain("won't be offered for CHF debts");

      const input = wizard().querySelector("input") as HTMLInputElement;
      input.value = "anna";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await flush();
      const save = Array.from(host.querySelectorAll("button")).find(
        (b) => (b.textContent ?? "").trim() === "Save",
      ) as HTMLButtonElement | undefined;
      expect(save?.disabled).toBe(false);
    } finally {
      setSettings({ groupCurrency: previous });
    }
  });

  it("renders the crypto step's name, address and network inputs", async () => {
    await openPicker();
    tap(option("Crypto"));
    await flush();

    const labels = Array.from(wizard().querySelectorAll(".field-label")).map(
      (l) => (l.textContent ?? "").trim(),
    );
    expect(labels).toEqual(["Name", "Wallet address", "Network"]);
    expect(wizard().querySelectorAll('input[type="text"]')).toHaveLength(2);

    const select = wizard().querySelector("select") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      "bitcoin",
      "ethereum",
      "monero",
      "other",
    ]);
    expect(host.textContent).toContain(
      "the payer's wallet converts the amount you're owed",
    );
  });

  it("walks to a provider step and shows where to find the handle", async () => {
    render(<ProfileForm />, host);
    tap(
      Array.from(host.querySelectorAll("button")).find((b) =>
        (b.textContent ?? "").includes("Add payment method"),
      ),
    );
    await flush();

    tap(
      Array.from(host.querySelectorAll(".wizard-option")).find((b) =>
        (b.textContent ?? "").includes("PayPal"),
      ),
    );
    await flush();

    const text = host.textContent ?? "";
    expect(text).toContain("paypal.me"); // the "where to find it" guidance
    expect(host.querySelector("input")).not.toBeNull();
    // Nothing typed yet, so Save must not save — no half-configured method.
    // It reads as disabled but stays focusable, to say what's missing.
    const save = Array.from(host.querySelectorAll("button")).find(
      (b) => (b.textContent ?? "").trim() === "Save",
    ) as HTMLButtonElement | undefined;
    expect(save?.disabled).toBe(false);
    expect(save?.getAttribute("aria-disabled")).toBe("true");
  });
});

describe("PayUpSheet", () => {
  const CREDITOR = "b@example.org";
  const TRANSFER = {
    fromId: "a@example.org",
    toId: CREDITOR,
    amountCents: 2350,
  };
  const BTC = "bc1qexampleaddress0000000000000000000000000";

  let currency: string;
  beforeEach(() => {
    currency = getSettings().groupCurrency;
  });
  afterEach(() => {
    setProfile(CREDITOR, {}); // shared singleton doc
    setSettings({ groupCurrency: currency });
  });

  const sheet = () =>
    render(
      <PayUpSheet
        transfer={TRANSFER}
        direction="pay"
        open
        onClose={() => {}}
      />,
      host,
    );

  /** The same sheet for another debt, or seen from the other side. */
  const sheetFor = (
    transfer: Transfer,
    direction: "pay" | "request" = "pay",
  ): void =>
    render(
      <PayUpSheet
        transfer={transfer}
        direction={direction}
        open
        onClose={() => {}}
      />,
      host,
    );

  const linkTo = (prefix: string): HTMLAnchorElement | null =>
    host.querySelector<HTMLAnchorElement>(`a[href^="${prefix}"]`);

  /** By visible text, or by aria-label for the icon-only copy buttons. */
  const buttons = (text: string): HTMLButtonElement[] =>
    Array.from(host.querySelectorAll("button")).filter(
      (b) =>
        (b.textContent ?? "").includes(text) ||
        (b.getAttribute("aria-label") ?? "").includes(text),
    ) as HTMLButtonElement[];

  /** Switches the sheet to another method, as a tap on its tab would. */
  const pick = (label: string): void => {
    const tab = Array.from(host.querySelectorAll(".method-tab")).find(
      (t) => (t.textContent ?? "").trim() === label,
    );
    tap(tab);
    return undefined;
  };

  // MANUAL CA2 (the sheet half: the fiat figure is text beside the address)
  it("always shows a crypto address in full, with copy buttons for both the address and the URI", () => {
    setProfile(CREDITOR, {
      accountHolder: "Anna",
      crypto: { label: "Bitcoin", address: BTC, network: "bitcoin" },
    });
    sheet();

    const text = host.textContent ?? "";
    expect(fieldValues()).toContain(BTC); // the link may be a no-op; the address never is
    expect(buttons("Copy address")).toHaveLength(1);
    expect(buttons("Copy Bitcoin link")).toHaveLength(1);
    expect(host.querySelector("svg.qr-code")).not.toBeNull();
    // The fiat amount is shown; no crypto amount is ever embedded.
    expect(text).toContain("€23.50");
    expect(text).toContain("not embedded in the address");
    expect(
      host.querySelector<HTMLAnchorElement>('a[href^="bitcoin:"]')?.href,
    ).not.toContain("amount");
  });

  it("renders the Monero URI's reference and recipient name from the payee", () => {
    setProfile(CREDITOR, {
      accountHolder: "Anna",
      crypto: { label: "Monero", address: "4Aexample", network: "monero" },
    });
    sheet();

    const href =
      host.querySelector<HTMLAnchorElement>('a[href^="monero:"]')?.href ?? "";
    expect(href).toContain("recipient_name=Anna");
    expect(href).toContain("tx_description=");
    expect(href).not.toContain("tx_amount");
    expect(fieldValues().some((v) => v.startsWith("4Aexample"))).toBe(true);
  });

  it("shows an address-only block when the network has no URI scheme", () => {
    setProfile(CREDITOR, {
      crypto: {
        label: "USDC on Base",
        address: "0xExampleAddress",
        network: "other",
      },
    });
    sheet();

    const text = host.textContent ?? "";
    expect(text).toContain("USDC on Base");
    expect(fieldValues().some((v) => v.startsWith("0xExampleAddress"))).toBe(
      true,
    );
    expect(buttons("Copy address")).toHaveLength(1);
    expect(host.querySelector("svg.qr-code")).not.toBeNull();
    // No link exists for this network, and the "no details yet" placeholder
    // must not claim the creditor added nothing.
    expect(host.querySelector("a.btn-primary")).toBeNull();
    expect(text).not.toContain("hasn't added any payment details");
  });

  // MANUAL C5
  it("C5 — the PayPal link carries the amount, ready to pay", () => {
    setProfile(CREDITOR, { paypalMe: "anna" });
    sheet();

    expect(linkTo("https://paypal.me")?.getAttribute("href")).toBe(
      "https://paypal.me/anna/23.50EUR",
    );
    expect(host.textContent).not.toContain("amount not pre-filled");
  });

  // MANUAL C4 — the EPC standard is EUR-only, so the block has to disappear
  // with a reason rather than emit a QR no bank will accept.
  it("C4 — the bank transfer block is EUR-only and explains its absence", async () => {
    setProfile(CREDITOR, {
      paypalMe: "anna",
      iban: "DE89370400440532013000",
      accountHolder: "Anna",
    });

    setSettings({ groupCurrency: "USD" });
    sheetFor(TRANSFER);
    pick("Bank transfer");
    await flush();
    expect(host.textContent).toContain(
      "No scannable code for this debt: EPC QR only supports EUR",
    );
    expect(host.textContent).not.toContain("Scan with your banking app");

    setSettings({ groupCurrency: "EUR" });
    sheetFor(TRANSFER);
    pick("Bank transfer");
    await flush();
    expect(host.textContent).toContain("Scan with your banking app");
    expect(fieldValues()).toContain("DE89 3704 0044 0532 0130 00");
  });

  // MANUAL C6
  it("C6 — Monzo is offered for £23.50 only, with its limits stated", () => {
    setProfile(CREDITOR, { monzoMe: "anna" });
    setSettings({ groupCurrency: "GBP" });

    sheetFor({ ...TRANSFER, amountCents: 2350 });
    expect(linkTo("https://monzo.me")).not.toBeNull();
    expect(host.textContent).toContain("£1–£100 per payment");

    for (const amountCents of [50, 15000]) {
      sheetFor({ ...TRANSFER, amountCents });
      expect(linkTo("https://monzo.me")).toBeNull();
    }

    setSettings({ groupCurrency: "EUR" });
    sheetFor({ ...TRANSFER, amountCents: 2350 });
    expect(linkTo("https://monzo.me")).toBeNull();
  });

  // MANUAL C9
  it("C9 — a debt owed to you shows your own details and a nudge, not a bill", () => {
    installWebxdc({ selfAddr: CREDITOR, selfName: "Anna" });
    setProfile(CREDITOR, { paypalMe: "anna", note: "IBAN please" });

    sheetFor(TRANSFER, "request");

    const text = host.textContent ?? "";
    expect(host.querySelector(".sheet-title")?.textContent).toContain(
      "owes you",
    );
    expect(host.querySelector(".sheet-amount")?.textContent).toBe("€23.50");
    // Yours, not a bubble from "<someone>".
    expect(host.querySelector(".payee-note strong")?.textContent).toBe(
      "Your note",
    );
    expect(text).toContain("IBAN please");
    expect(linkTo("https://paypal.me")).not.toBeNull();
    expect(buttons("Mark as received")).toHaveLength(1);
  });

  // MANUAL C10 — money safety: recording a settlement is a claim every peer
  // sees, so a member who is neither party gets no way to make it — as long
  // as a party is someone who could record it themselves.
  it("C10 — a debt between two other members is read-only", () => {
    const bob = addVirtualMember("Bob", 1);
    installWebxdc({ selfAddr: "dana@example.org", selfName: "Dana" });
    try {
      // CREDITOR uses the app (not added by hand), so only they or Bob may.
      setProfile(CREDITOR, { paypalMe: "carol", note: "PayPal is fine" });
      // "request", as Balances opens any transfer that isn't yours to pay.
      sheetFor(
        { fromId: bob.id, toId: CREDITOR, amountCents: 2000 },
        "request",
      );

      const text = host.textContent ?? "";
      expect(host.querySelector(".sheet-title")?.textContent).toMatch(
        /^Bob owes /,
      );
      // Balances opens a stranger's debt in "request" mode; the note is still
      // the creditor's, not "yours".
      expect(text).not.toContain("Your note");
      expect(text).toContain("€20.00");
      expect(text).toMatch(/Only Bob or .+ can record this payment\./);
      expect(buttons("Mark as")).toHaveLength(0);
      // The methods themselves are still shown — it is read-only, not blank.
      expect(linkTo("https://paypal.me")).not.toBeNull();
    } finally {
      render(null, host);
      removeMember(bob.id);
    }
  });

  // Between two members added by hand, nobody could record it under C10:
  // neither can open the app. In a chat of friends and family, anyone may.
  it("C10 — between two members who don't use the app, anyone may record", async () => {
    const bob = addVirtualMember("Bob", 1);
    const carol = addVirtualMember("Carol", 2);
    installWebxdc({ selfAddr: "dana@example.org", selfName: "Dana" });
    try {
      sheetFor(
        { fromId: bob.id, toId: carol.id, amountCents: 2000 },
        "request",
      );
      expect(host.textContent).not.toContain("can record this payment");
      // Nobody to send a request to: neither is in the chat.
      expect(buttons("Copy request")).toHaveLength(0);
      expect(buttons("Ask for the money")).toHaveLength(0);
      const mark = buttons("Mark as paid");
      expect(mark).toHaveLength(1);
      tap(mark[0]);
      await new Promise((r) => setTimeout(r));
      expect(host.textContent).toContain(
        "Record that Bob paid Carol €20.00? Everyone in this chat will see it.",
      );
    } finally {
      render(null, host);
      removeMember(bob.id);
      removeMember(carol.id);
    }
  });

  it("shows the UPI QR without an extra tap, with the payee name in the link", () => {
    setSettings({ groupCurrency: "INR" });
    setProfile(CREDITOR, { accountHolder: "Anna", upiVpa: "anna@upi" });
    sheet();

    const href =
      host.querySelector<HTMLAnchorElement>('a[href^="upi:"]')?.href ?? "";
    expect(href).toContain("pa=anna@upi");
    expect(href).toContain("pn=Anna");
    // Scanning is the normal UPI flow: the code is there before any tap.
    expect(host.querySelector("svg.qr-code")).not.toBeNull();
  });

  // The bank block always rendered its code, while every link method hid one
  // behind "Show QR" — so bunq looked like it had no code at all, and a payer
  // reaching for a second device had to tap to find out one existed.
  it("gives every method a QR up front, with no show/hide tap anywhere", async () => {
    setProfile(CREDITOR, {
      accountHolder: "Anna Beispiel",
      bunqMe: "anna",
      paypalMe: "anna",
      iban: "DE89370400440532013000",
    });
    sheet();

    // One method on screen at a time, and each one's code comes with it.
    for (const [label, href] of [
      ["PayPal", "https://paypal.me"],
      ["bunq", "https://bunq.me"],
      ["Bank transfer", null],
    ] as const) {
      pick(label);
      await flush();
      expect(host.querySelectorAll("svg.qr-code")).toHaveLength(1);
      if (href) expect(linkTo(href)).not.toBeNull();
      else expect(fieldValues()).toContain("DE89 3704 0044 0532 0130 00");
    }
    expect(buttons("QR")).toHaveLength(0);
  });

  it("opens on the payee's preferred method, listed first", () => {
    setProfile(CREDITOR, {
      accountHolder: "Anna Beispiel",
      paypalMe: "anna",
      bunqMe: "anna",
      iban: "DE89370400440532013000",
      preferred: "bank",
    });
    sheet();

    const tabs = Array.from(host.querySelectorAll(".method-tab"));
    expect(tabs.map((t) => (t.textContent ?? "").trim())).toEqual([
      "Bank transfer",
      "PayPal",
      "bunq",
    ]);
    expect(tabs[0].getAttribute("aria-pressed")).toBe("true");
    expect(host.textContent).toContain("preferred way to be paid");
    expect(fieldValues()).toContain("DE89 3704 0044 0532 0130 00");
  });

  it("says when a custom link leaves the amount to the payer", () => {
    setProfile(CREDITOR, {
      customs: [
        { id: "t", label: "Twint", urlTemplate: "https://twint.example/anna" },
      ],
    });
    sheet();
    expect(host.textContent).toContain("Type in €23.50 yourself");
    expect(host.textContent).not.toContain("is filled in");
  });

  it("keeps one primary action: Open until the payer has opened it, then Mark as paid", async () => {
    installWebxdc({ selfAddr: TRANSFER.fromId, selfName: "Payer" });
    setProfile(CREDITOR, {
      paypalMe: "anna",
      iban: "DE89370400440532013000",
      accountHolder: "Anna",
    });
    sheet();
    const mark = () => buttons("Mark as paid")[0];
    const open = linkTo("https://paypal.me")!;
    expect(open.className).toContain("btn-primary");
    expect(mark().className).toContain("btn-secondary");

    open.dispatchEvent(new Event("pointerup", { bubbles: true }));
    await flush();
    expect(mark().className).toContain("btn-primary");

    // No link to open on the bank tab: recording is the only action.
    sheet();
    pick("Bank transfer");
    await flush();
    expect(mark().className).toContain("btn-primary");
  });

  it("never makes the creditor's link the primary action for anyone but the payer", () => {
    installWebxdc({ selfAddr: CREDITOR, selfName: "Anna" });
    setProfile(CREDITOR, { paypalMe: "anna" });
    sheetFor(TRANSFER, "request");
    expect(linkTo("https://paypal.me")!.className).toContain("btn-secondary");
    expect(buttons("Mark as received")[0].className).toContain("btn-primary");
  });

  it("ignores a preferred method the payee no longer has", () => {
    setProfile(CREDITOR, {
      paypalMe: "anna",
      bunqMe: "anna",
      preferred: "bank",
    });
    sheet();

    const tabs = Array.from(host.querySelectorAll(".method-tab"));
    expect(tabs[0].textContent).toBe("PayPal");
    expect(tabs[0].getAttribute("aria-pressed")).toBe("true");
    expect(host.textContent).not.toContain("preferred way to be paid");
  });
});

describe("the Me tab preview and the payer's sheet", () => {
  const ME = "me@example.org";
  // Nothing here depends on the payee's name, which is the one input the two
  // call sites pass differently (the sheet knows the member, the preview does
  // not) — see PayUpSheet.tsx on why the QR must never say "You".
  const PROFILE = {
    paypalMe: "anna",
    bunqMe: "anna",
    // A bank method on purpose: it is the one with no <a> element, so an
    // href-only comparison is blind to it — which is exactly how the two
    // screens drifted apart over whether a non-EUR IBAN counts at all.
    iban: "DE89370400440532013000",
    accountHolder: "Anna Beispiel",
    customs: [
      {
        id: "c1",
        label: "Twint",
        urlTemplate: "https://twint.example/{amount}",
      },
    ],
  };

  afterEach(() => setProfile(ME, {}));

  const tabLabels = (): string[] =>
    Array.from(host.querySelectorAll(".method-tab")).map((t) =>
      (t.textContent ?? "").trim(),
    );

  // MANUAL C2 — the preview used to be a second call site of
  // paymentMethodsFor() that drifted from the sheet's. Now it IS the sheet:
  // "See what payers see" opens PayUpSheet itself, for a sample debt.
  it("C2 — 'See what payers see' opens the payer's own sheet, nothing to record", async () => {
    installWebxdc({ selfAddr: ME, selfName: "Anna" });
    setProfile(ME, PROFILE);

    render(<ProfileForm />, host);
    // Every saved method is one row on the Me tab…
    expect(host.querySelectorAll(".list .row:not(.add-row)")).toHaveLength(4);
    tap(
      Array.from(host.querySelectorAll("button")).find((b) =>
        (b.textContent ?? "").includes("See what payers see"),
      ),
    );
    await flush();
    const previewTabs = tabLabels();
    render(null, host);

    // …and the preview offers exactly what a real payer's sheet does.
    render(
      <PayUpSheet
        transfer={{ fromId: "payer@example.org", toId: ME, amountCents: 1000 }}
        direction="pay"
        open
        onClose={() => {}}
      />,
      host,
    );
    expect(previewTabs).toEqual(["PayPal", "bunq", "Twint", "Bank transfer"]);
    expect(previewTabs).toEqual(tabLabels());
  });

  it("the preview can neither record nor send anything", async () => {
    installWebxdc({ selfAddr: ME, selfName: "Anna" });
    setProfile(ME, PROFILE);

    render(<ProfileForm />, host);
    tap(
      Array.from(host.querySelectorAll("button")).find((b) =>
        (b.textContent ?? "").includes("See what payers see"),
      ),
    );
    await flush();

    const sheet = host.querySelector(".sheet");
    expect(sheet?.querySelector(".sheet-title")?.textContent).toBe(
      "What payers see",
    );
    expect(sheet?.textContent).toContain("Nothing here is recorded or sent");
    const labels = Array.from(sheet?.querySelectorAll("button") ?? []).map(
      (b) => b.textContent ?? "",
    );
    expect(labels.some((l) => l.includes("Mark as"))).toBe(false);
    expect(labels.some((l) => l.includes("Tell the chat"))).toBe(false);
  });
});

describe("Balances", () => {
  it("is all square in words, not a 42px zero, while others still owe", async () => {
    const bob = addVirtualMember("Bob", 1);
    const carol = addVirtualMember("Carol", 2);
    installWebxdc({ selfAddr: "dana@example.org", selfName: "Dana" });
    const id = "square-test";
    addExpense({
      id,
      title: "Cab",
      amountCents: 2000,
      payerId: bob.id,
      split: { mode: "even", entries: { [bob.id]: 1, [carol.id]: 1 } },
      date: "2026-08-01",
      createdBy: bob.id,
      editedAt: 0,
    });
    try {
      render(<Balances />, host);
      expect(host.querySelector(".hero-title")?.textContent).toBe(
        "You're all square",
      );
      expect(host.querySelector(".hero-amount")).toBeNull();
      expect(host.textContent).toContain("Carol → Bob");
    } finally {
      render(null, host);
      deleteExpense(id);
      removeMember(bob.id);
      removeMember(carol.id);
    }
  });

  // A selection is a snapshot. If the debt goes away while its sheet (or a
  // details page opened from it) is up — someone else recorded it, or the
  // expense was deleted — reopening it would let it be recorded twice.
  it("closes a pay sheet whose debt no longer exists", async () => {
    const bob = addVirtualMember("Bob", 1);
    const carol = addVirtualMember("Carol", 2);
    installWebxdc({ selfAddr: "dana@example.org", selfName: "Dana" });
    const id = "stale-sheet-test";
    addExpense({
      id,
      title: "Cab",
      amountCents: 2000,
      payerId: bob.id,
      split: { mode: "even", entries: { [bob.id]: 1, [carol.id]: 1 } },
      date: "2026-08-01",
      createdBy: bob.id,
      editedAt: 0,
    });
    const tick = () => new Promise((r) => setTimeout(r));
    try {
      render(<Balances />, host);
      tap(
        Array.from(host.querySelectorAll("button")).find((b) =>
          b.textContent?.includes("Carol → Bob"),
        ),
      );
      await tick();
      expect(host.querySelector(".sheet-title")?.textContent).toBe(
        "Carol owes Bob",
      );
      deleteExpense(id); // the debt is gone, from under the open sheet
      await tick();
      expect(host.querySelector(".sheet")).toBeNull();
    } finally {
      render(null, host);
      deleteExpense(id);
      removeMember(bob.id);
      removeMember(carol.id);
    }
  });
});

describe("MembersSheet", () => {
  const EXPENSE_ID = "cm2-expense";

  // MANUAL CM2 — removing a referenced member would leave the balances not
  // summing to zero on peers that still have them (see removalBlockedBy).
  it("CM2 — Remove is disabled with a reason while an expense names the member, then works", async () => {
    const gran = addVirtualMember("Grandma", 3);
    addExpense({
      id: EXPENSE_ID,
      title: "Cake",
      amountCents: 900,
      payerId: gran.id,
      split: { mode: "even", entries: { [gran.id]: 1, "b@example.org": 1 } },
      date: "2026-08-01",
      createdBy: gran.id,
      editedAt: 0,
    });

    try {
      render(<MembersSheet open onClose={() => {}} />, host);
      // Preact defers useEffect to after paint, so useDocValue's subscription
      // is only live a frame later — a setTimeout(0) is too early.
      await new Promise((resolve) => setTimeout(resolve, 50));
      const removeButton = (): HTMLButtonElement =>
        host
          .querySelector('input[aria-label="Name of Grandma"]')!
          .closest(".method-row")!
          .querySelector("button") as HTMLButtonElement;

      expect(removeButton().disabled).toBe(true);
      expect(removeButton().title).toContain("paid for 1 expense");
      expect(host.textContent).toContain("paid for 1 expense");

      deleteExpense(EXPENSE_ID);
      await flush();

      expect(removeButton().disabled).toBe(false);
    } finally {
      render(null, host);
      deleteExpense(EXPENSE_ID);
      removeMember(gran.id);
    }
  });
});

describe("Avatar initials", () => {
  it("keeps emoji whole instead of splitting surrogate pairs", () => {
    expect(initials("🌻 Sunny")).toBe("🌻S");
    expect(initials("ada 👨‍👩‍👧")).toBe("A👨‍👩‍👧");
    expect(initials("🇩🇪")).toBe("🇩🇪");
    expect(initials("👍🏽 Fan")).toBe("👍🏽F");
    expect(initials("❤️ love")).toBe("❤️L");
    expect(initials("1️⃣ one")).toBe("1️⃣O");
    expect(initials("🐱 🐶")).toBe("🐱🐶");
    expect(initials("👩🏽‍💻 dev")).toBe("👩🏽‍💻D");
    expect(initials("🏳️‍🌈 pride")).toBe("🏳️‍🌈P");
    expect(initials("👩‍❤️‍💋‍👨")).toBe("👩‍❤️‍💋‍👨");
    expect(initials("🧑🏿‍🤝‍🧑🏻 pals")).toBe("🧑🏿‍🤝‍🧑🏻P");
    expect(initials("🏴󠁧󠁢󠁳󠁣󠁴󠁿 Scotland")).toBe("🏴󠁧󠁢󠁳󠁣󠁴󠁿S");
    expect(initials("e\u0301mile durand")).toBe("E\u0301D");
    expect(initials("山田 太郎")).toBe("山太");
    expect(initials("Ada King Lovelace")).toBe("AL");
    expect(initials("ada")).toBe("A");
    expect(initials("  ")).toBe("?");
  });
});

describe("ClaimPrompt", () => {
  const before = getSettings();
  beforeEach(() =>
    importSnapshot(
      JSON.stringify({
        members: {
          "me@x": { id: "me@x", name: "Anna", addr: "me@x" },
          "old-anna": { id: "old-anna", name: "Anna", addr: "old-anna" },
          "old-bob": { id: "old-bob", name: "Bob", addr: "old-bob" },
        },
      }),
    ),
  );
  afterEach(() => {
    importSnapshot("{}");
    setSettings(before);
  });

  const button = (text: string): HTMLButtonElement | undefined =>
    Array.from(host.querySelectorAll("button")).find((b) =>
      (b.textContent ?? "").includes(text),
    );

  it("lists the imported people, your name first and bold", async () => {
    render(<ClaimPrompt selfId="me@x" />, host);
    await flush();
    expect(host.textContent).toContain("Were you in this group before?");
    const rows = host.querySelectorAll(".member-row");
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector("strong")?.textContent).toBe("Anna");
    expect(rows[1].textContent).toContain("Bob");
  });

  it("× hides it", async () => {
    render(<ClaimPrompt selfId="me@x" />, host);
    await flush();
    tap(host.querySelector('.sheet button[aria-label="Close"]'));
    await flush();
    expect(host.querySelector(".sheet")).toBeNull();
  });

  it("That's me → confirm → Back returns to the list", async () => {
    render(<ClaimPrompt selfId="me@x" />, host);
    await flush();
    tap(button("That's me"));
    await flush();
    expect(host.textContent).toContain("Is this you?");
    expect(host.textContent).toContain("can't be undone");
    tap(button("Back"));
    await flush();
    expect(host.textContent).toContain("Were you in this group before?");
  });

  it("shows why a merge failed instead of closing", async () => {
    // The singleton has no host here, so nobody is registered: the writer
    // refuses, and the reason must reach the screen.
    render(<ClaimPrompt selfId="me@x" />, host);
    await flush();
    tap(button("That's me"));
    await flush();
    tap(button("Yes, merge into me"));
    await flush();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "Not merged",
    );
  });
});
