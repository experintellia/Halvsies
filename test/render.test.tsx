// Render smoke tests. These exist because the first build of this app shipped
// screens that typechecked, passed every unit test, and rendered literally
// nothing but placeholder text — no test touched a component, so nothing
// caught it. These mount the real screens against the real doc module and
// assert something meaningful is on the page.
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { render } from "preact";
import { App } from "../src/ui/App";
import { ExpenseList } from "../src/ui/ExpenseList";
import { ProfileForm } from "../src/ui/ProfileForm";
import { addExpense, deleteExpense } from "../src/state/doc";
import { PayUpSheet } from "../src/ui/PayUpSheet";
import { MembersSheet } from "../src/ui/MembersSheet";
import {
  addVirtualMember,
  getSettings,
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
});

describe("ProfileForm", () => {
  it("starts collapsed: no method rows, an add button, and the note field", () => {
    render(<ProfileForm />, host);
    const text = host.textContent ?? "";

    // The whole point of the redesign: methods are not all splayed out.
    expect(host.querySelectorAll(".method-row")).toHaveLength(0);
    expect(text).toContain("Add payment method");

    // The note is always visible, with or without any configured method.
    expect(host.querySelector("textarea")).not.toBeNull();
    expect(text).toContain("paying you");

    // Privacy notice stays up top.
    expect(text).toContain("can see your payment profile");
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

  /** The wizard sheet only — the profile screen behind it has fields too. */
  const sheet = (): HTMLElement => host.querySelector(".sheet") as HTMLElement;

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

    const input = sheet().querySelector("input") as HTMLInputElement;
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

      const input = sheet().querySelector("input") as HTMLInputElement;
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

    const labels = Array.from(sheet().querySelectorAll(".field-label")).map(
      (l) => (l.textContent ?? "").trim(),
    );
    expect(labels).toEqual(["Name", "Wallet address", "Network"]);
    expect(sheet().querySelectorAll("input")).toHaveLength(2);

    const select = sheet().querySelector("select") as HTMLSelectElement;
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
    // Nothing typed yet, so Save must be disabled — no half-configured method.
    const save = Array.from(host.querySelectorAll("button")).find(
      (b) => (b.textContent ?? "").trim() === "Save",
    ) as HTMLButtonElement | undefined;
    expect(save?.disabled).toBe(true);
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

  const buttons = (text: string): HTMLButtonElement[] =>
    Array.from(host.querySelectorAll("button")).filter((b) =>
      (b.textContent ?? "").includes(text),
    ) as HTMLButtonElement[];

  // MANUAL CA2 (the sheet half: the fiat figure is text beside the address)
  it("always shows a crypto address in full, with copy buttons for both the address and the URI", () => {
    setProfile(CREDITOR, {
      accountHolder: "Anna",
      crypto: { label: "Bitcoin", address: BTC, network: "bitcoin" },
    });
    sheet();

    const text = host.textContent ?? "";
    expect(text).toContain(BTC); // the link may be a no-op; the address never is
    expect(buttons("Copy address")).toHaveLength(1);
    expect(buttons("Copy link")).toHaveLength(1);
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
    expect(host.textContent).toContain("4Aexample");
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
    expect(text).toContain("0xExampleAddress");
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
  it("C4 — the bank transfer block is EUR-only and explains its absence", () => {
    setProfile(CREDITOR, {
      paypalMe: "anna",
      iban: "DE89370400440532013000",
      accountHolder: "Anna",
    });

    setSettings({ groupCurrency: "USD" });
    sheetFor(TRANSFER);
    expect(host.textContent).toContain(
      "Bank transfer QR unavailable: EPC QR only supports EUR",
    );
    expect(host.textContent).not.toContain("Scan with your banking app");

    setSettings({ groupCurrency: "EUR" });
    sheetFor(TRANSFER);
    expect(host.textContent).toContain("Scan with your banking app");
    expect(host.textContent).toContain("DE89 3704 0044 0532 0130 00");
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
    expect(text).toContain("owes you €23.50");
    expect(text).toContain("Share your payment details with");
    expect(text).toContain("Your note:"); // yours, not "<someone> says:"
    expect(linkTo("https://paypal.me")).not.toBeNull();
    expect(buttons("Mark as received")).toHaveLength(1);
  });

  // MANUAL C10 — money safety: recording a settlement is a claim every peer
  // sees, so a member who is neither party gets no way to make it.
  it("C10 — a debt between two other members is read-only", () => {
    const bob = addVirtualMember("Bob", 1);
    const carol = addVirtualMember("Carol", 2);
    installWebxdc({ selfAddr: "dana@example.org", selfName: "Dana" });
    try {
      setProfile(carol.id, { paypalMe: "carol" });
      sheetFor({ fromId: bob.id, toId: carol.id, amountCents: 2000 });

      const text = host.textContent ?? "";
      expect(text).toContain("Bob owes Carol €20.00");
      expect(text).toContain("Only Bob or Carol can record this payment.");
      expect(buttons("Mark as")).toHaveLength(0);
      // The methods themselves are still shown — it is read-only, not blank.
      expect(linkTo("https://paypal.me")).not.toBeNull();
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
    expect(buttons("Show QR")).toHaveLength(0);
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
    customs: [
      {
        id: "c1",
        label: "Twint",
        urlTemplate: "https://twint.example/{amount}",
      },
    ],
  };

  afterEach(() => setProfile(ME, {}));

  // MANUAL C2 — the preview is a second call site of paymentMethodsFor(); if
  // it ever drifts from the sheet's, the Me tab is lying about what people get.
  it("C2 — the 'what others see' preview lists exactly what PayUpSheet offers", () => {
    installWebxdc({ selfAddr: ME, selfName: "Anna" });
    setProfile(ME, PROFILE);

    render(<ProfileForm />, host);
    const previewed = Array.from(host.querySelectorAll(".field-row p"))
      .map((p) => (p.textContent ?? "").match(/https:\/\/\S+/)?.[0])
      .filter((url): url is string => !!url);
    render(null, host);

    // The preview's sample debt is 10.00 of the group currency.
    render(
      <PayUpSheet
        transfer={{ fromId: "payer@example.org", toId: ME, amountCents: 1000 }}
        direction="pay"
        open
        onClose={() => {}}
      />,
      host,
    );
    const offered = Array.from(
      host.querySelectorAll<HTMLAnchorElement>("a.btn-primary"),
    ).map((a) => a.getAttribute("href"));

    expect(previewed).toHaveLength(3);
    expect(previewed).toEqual(offered);
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
