// The paths that only exist when a webxdc host is present: self-registration
// across app reopens, the summary y-webxdc sends into the chat, and the two
// feature-detected host APIs (sendToChat / importFiles).
//
// `src/state/doc.ts` captures window.webxdc at module load and builds its
// singleton + provider from it, so each test boots a fresh module graph with a
// fresh mock host — that is also what makes "reopening the app" expressible.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { formatMoney, type Expense } from "../src/state/model";
import {
  installWebxdc,
  jsonFile,
  uninstallWebxdc,
  type MockOptions,
} from "./webxdc-mock";

const eur = (cents: number): string => formatMoney(cents, "EUR");

let dom: HTMLDivElement;
const booted: { provider?: { destroy(): void } }[] = [];
/**
 * boot()'s render, taken from the same preact instance the components got.
 *
 * KNOWN LIMITATION: useEffect still does not run in this file. vi.resetModules()
 * is what makes "reopen the app" expressible, and it also severs Preact's hook
 * plumbing badly enough that passive effects never fire — a forced re-render
 * paints the right tree, but no effect body ever executes. Everything here
 * therefore asserts first-render output and direct store calls only.
 *
 * Anything that depends on an effect — useDocValue's doc subscription,
 * useSelfId's registration, re-rendering in response to a remote update —
 * belongs in a test file that does NOT reset modules (test/render.test.tsx,
 * test/settings.test.tsx), where test/setup.ts's rAF shim makes effects run.
 */
let render: (vnode: unknown, parent: Element) => void = () => {
  throw new Error("render before boot()");
};

/** Preact batches, and importFiles() resolves through a promise chain. */
const tick = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

/** Taps ride pointerup in this WebView (see Row.tsx), so tests must too. */
function tap(el: Element | undefined | null): void {
  if (!el) throw new Error("tap() got no element");
  el.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  el.dispatchEvent(new Event("pointerup", { bubbles: true }));
}

const buttons = (text: string): HTMLButtonElement[] =>
  Array.from(dom.querySelectorAll("button")).filter((b) =>
    (b.textContent ?? "").includes(text),
  );

/**
 * Start the app against a fresh mock host: a new doc singleton, a real
 * WebxdcProvider wired to it, and the screens that read the host directly.
 */
async function boot(o: MockOptions = {}) {
  vi.resetModules();
  const webxdc = installWebxdc(o);
  const preact = await import("preact");
  render = preact.render as typeof render;
  const doc = await import("../src/state/doc");
  const { ProfileForm } = await import("../src/ui/ProfileForm");
  const { PayUpSheet } = await import("../src/ui/PayUpSheet");
  // Backup/restore moved off the Me tab into the group-settings sub-page.
  const { GroupSettings } = await import("../src/ui/GroupSettings");
  booted.push(doc);
  return { webxdc, doc, ProfileForm, PayUpSheet, GroupSettings };
}

function expense(over: Partial<Expense> = {}): Expense {
  return {
    id: "001",
    title: "Pizza",
    amountCents: 3000,
    payerId: "a@x.de",
    split: { mode: "even", entries: { "a@x.de": 1, "b@x.de": 1 } },
    date: "2026-07-30",
    createdBy: "a@x.de",
    editedAt: 1,
    ...over,
  };
}

beforeEach(() => {
  dom = document.createElement("div");
  document.body.appendChild(dom);
});

afterEach(() => {
  try {
    render(null, dom); // unmount so effects/subscriptions don't leak
  } catch {
    // a test that never called boot() has no renderer; nothing to unmount
  }
  dom.remove();
  // Each provider holds an autosave interval and window listeners.
  for (const m of booted.splice(0)) m.provider?.destroy();
  uninstallWebxdc();
});

describe("self-registration against a real host", () => {
  // MANUAL A2
  it("A2 — registers the local user exactly once, however often the app is reopened", async () => {
    const first = await boot({ selfAddr: "a@x.de", selfName: "Anna" });
    first.doc.ensureSelfRegistered();
    first.doc.ensureSelfRegistered();
    expect(first.doc.listMembers().map((m) => m.name)).toEqual(["Anna"]);

    // Reopen: a new module graph, restored from the document the peers hold.
    const state = Y.encodeStateAsUpdateV2(first.doc.doc);
    const second = await boot({ selfAddr: "a@x.de", selfName: "Anna" });
    Y.applyUpdateV2(second.doc.doc, state);
    second.doc.ensureSelfRegistered();
    second.doc.ensureSelfRegistered();

    expect(second.doc.listMembers().map((m) => m.id)).toEqual(["a@x.de"]);
  });

  // MANUAL CM4 — this test used to assert that a removed real member
  // re-registered on their next open. That premise is void: a real member
  // cannot be removed at all any more (their name and membership belong to
  // the Delta Chat group, not to this app), so there is nothing to come back
  // from. What is worth pinning is the refusal itself, through the real host.
  it("CM4 — a member who is in the chat cannot be removed from the split", async () => {
    const { doc } = await boot({ selfAddr: "a@x.de", selfName: "Anna" });
    doc.ensureSelfRegistered();

    expect(doc.removeMember("a@x.de")).toMatch(/in this chat/);
    expect(doc.listMembers().map((m) => m.id)).toEqual(["a@x.de"]);
  });

  // The other half of the same rule: the name follows the messenger.
  it("CM4 — a nickname changed in Delta Chat is picked up on the next open", async () => {
    const { doc } = await boot({ selfAddr: "a@x.de", selfName: "Anna" });
    doc.ensureSelfRegistered();
    expect(doc.getMember("a@x.de")?.name).toBe("Anna");

    // Same peer, same address, new display name in the messenger.
    const renamed = await boot({ selfAddr: "a@x.de", selfName: "Anna B." });
    renamed.doc.ensureSelfRegistered();
    expect(renamed.doc.getMember("a@x.de")?.name).toBe("Anna B.");
  });
});

describe("what the chat sees", () => {
  // MANUAL B2 — the regression this pins: the summary used to come from a
  // counter only the Balances screen set, so it stayed "All settled up" until
  // someone opened that tab. Nothing here ever renders Balances.
  it("B2 — the summary the host receives is current, without opening Balances", async () => {
    const { webxdc, doc } = await boot({
      selfAddr: "simon@x.de",
      selfName: "Simon",
    });
    doc.ensureSelfRegistered();
    const anna = doc.addVirtualMember("Anna", 1);

    expect(webxdc.sent[webxdc.sent.length - 1].summary).toBe("All settled up");

    doc.addExpense(
      expense({
        title: "Pizza",
        payerId: "simon@x.de",
        createdBy: "simon@x.de",
        split: { mode: "even", entries: { "simon@x.de": 1, [anna.id]: 1 } },
      }),
    );

    const last = webxdc.sent[webxdc.sent.length - 1];
    expect(last.summary).toBe(`1 open debt · ${eur(1500)}`);
    // B1's info line rides the same send (y-webxdc only attaches info once
    // per session, so the first one is the join).
    expect(webxdc.sent[0].info).toBe("Simon joined the split");
    expect(last.document).toBe("Halvsies");
  });
});

describe("send to chat", () => {
  const transfer = { fromId: "self@x.de", toId: "b@x.de", amountCents: 2350 };

  // MANUAL C8
  it("C8 — posts the payment link to the chat when the host supports it", async () => {
    const { webxdc, doc, PayUpSheet } = await boot();
    doc.setProfile("b@x.de", { paypalMe: "anna" });
    render(
      <PayUpSheet
        transfer={transfer}
        direction="pay"
        open
        onClose={() => {}}
      />,
      dom,
    );

    tap(buttons("I'm paying now")[0]);
    expect(webxdc.chat).toHaveLength(1);
    expect(webxdc.chat[0].text).toContain("https://paypal.me/anna/23.50EUR");
  });

  // MANUAL C8 — the button must be absent, not inert.
  it("C8 — offers no Send-to-chat button on a host without sendToChat", async () => {
    const { doc, PayUpSheet } = await boot({ sendToChat: false });
    doc.setProfile("b@x.de", { paypalMe: "anna" });
    render(
      <PayUpSheet
        transfer={transfer}
        direction="pay"
        open
        onClose={() => {}}
      />,
      dom,
    );

    expect(buttons("I'm paying now")).toHaveLength(0);
    expect(buttons("Copy link")).toHaveLength(1); // the alternative is there
  });

  // Announcing a payment is method-specific; asking for one is not. The debtor
  // should be able to pick, so the ask is one action carrying every method
  // rather than a button per card that posts a single link.
  it("asks for money once, listing every way to pay", async () => {
    const { webxdc, doc, PayUpSheet } = await boot({ selfAddr: "b@x.de" });
    doc.setProfile("b@x.de", {
      paypalMe: "anna",
      bunqMe: "anna",
      accountHolder: "Anna Beispiel",
      iban: "DE89370400440532013000",
    });
    render(
      <PayUpSheet
        transfer={transfer}
        direction="request"
        open
        onClose={() => {}}
      />,
      dom,
    );

    // One ask, and no per-card send button competing with it.
    expect(buttons("I'm paying now")).toHaveLength(0);
    const ask = buttons("Ask for the money");
    expect(ask).toHaveLength(1);

    tap(ask[0]);
    const text = webxdc.chat[0]?.text ?? "";
    expect(text).toContain("https://paypal.me/anna/23.50EUR");
    expect(text).toContain("https://bunq.me/anna/23.50");
    expect(text).toContain("DE89 3704 0044 0532 0130 00");
    expect(text).toContain("€23.50");
  });

  // Nothing on file is no reason to swallow the nudge.
  it("still asks when the creditor has no payment details", async () => {
    const { webxdc, PayUpSheet } = await boot({ selfAddr: "b@x.de" });
    render(
      <PayUpSheet
        transfer={transfer}
        direction="request"
        open
        onClose={() => {}}
      />,
      dom,
    );

    tap(buttons("Ask for the money")[0]);
    expect(webxdc.chat[0]?.text).toContain("€23.50");
  });
});

describe("restore from file", () => {
  const profileFile = { profile: { paypalMe: "anna" } };
  const snapshotFile = {
    settings: { groupCurrency: "EUR", title: "Rome trip" },
    expenses: {
      "002": {
        id: "002",
        title: "Beer",
        amountCents: 1250,
        payerId: "a@x.de",
        split: { mode: "even", entries: { "a@x.de": 1, "b@x.de": 1 } },
        date: "2026-07-30",
        createdBy: "a@x.de",
        editedAt: 1,
      },
    },
  };

  /** Boots, seeds one expense, and opens the Me tab with `files` staged. */
  async function withFiles(files: File[]) {
    const booted = await boot({
      selfAddr: "a@x.de",
      selfName: "Anna",
      files,
    });
    booted.doc.ensureSelfRegistered();
    booted.doc.addExpense(expense({ title: "Pizza" }));
    render(<booted.GroupSettings open onClose={() => {}} />, dom);
    tap(buttons("Restore from file")[0]);
    await tick();
    return booted;
  }

  // MANUAL E5
  it("E5 — routes a payment-details file by its shape, whatever it is named", async () => {
    const { doc } = await withFiles([
      jsonFile("holiday-notes.txt", profileFile),
    ]);

    expect(doc.getProfile("a@x.de")?.paypalMe).toBe("anna");
    // Not a full restore: the ledger is untouched.
    expect(doc.listExpenses().map((e) => e.title)).toEqual(["Pizza"]);
  });

  // MANUAL E5
  it("E5 — routes a full snapshot by its shape, even named like a profile file", async () => {
    const { doc } = await withFiles([
      jsonFile("halvsies-payment-details.json", snapshotFile),
    ]);

    expect(doc.listExpenses().map((e) => e.title)).toEqual(["Beer"]);
    expect(doc.getSettings().title).toBe("Rome trip");
  });

  // MANUAL E2 — through the real picker, not just the parser.
  it("E2 — refuses a negative amount and leaves the ledger untouched", async () => {
    const { doc } = await withFiles([
      jsonFile("backup.json", {
        expenses: {
          "002": { ...snapshotFile.expenses["002"], amountCents: -5000 },
        },
      }),
    ]);

    expect(dom.querySelector('[role="alert"]')?.textContent).toMatch(
      /more than zero/i,
    );
    expect(doc.listExpenses().map((e) => e.title)).toEqual(["Pizza"]);
  });

  // MANUAL E3
  it("E3 — hides Restore and says so on a host without importFiles", async () => {
    const { doc, GroupSettings } = await boot({ importFiles: false });
    doc.ensureSelfRegistered();
    render(<GroupSettings open onClose={() => {}} />, dom);

    expect(buttons("Restore from file")).toHaveLength(0);
    expect(dom.textContent).toContain("cannot open files from inside the app");
  });
});

// The transport wrapper doc.ts builds around window.webxdc for hydration
// tracking (see `hydrated`/`whenHydrated()`) — no React involved, so
// vi.resetModules() + a fresh window.webxdc per test is enough; none of
// boot()'s "effects don't run" limitation applies here.
describe("the hydration transport wrapper", () => {
  /** Just enough for `new WebxdcProvider(...)` to construct without throwing. */
  function bareHost(
    overrides: Partial<Record<string, unknown>> = {},
  ): Record<string, unknown> {
    return {
      selfAddr: "self@x.de",
      selfName: "Self",
      sendUpdateInterval: 1000,
      sendUpdate: () => {},
      setUpdateListener: () => Promise.resolve(),
      ...overrides,
    };
  }

  async function bootWith(host: unknown) {
    vi.resetModules();
    (window as unknown as { webxdc?: unknown }).webxdc = host;
    const doc = await import("../src/state/doc");
    booted.push(doc);
    return doc;
  }

  it("hydrates even against a host old enough that setUpdateListener returns nothing", async () => {
    const doc = await bootWith(
      bareHost({ setUpdateListener: () => undefined }),
    );

    // A synchronous mock settles almost immediately either way — what this
    // pins is that a non-thenable return doesn't throw out of module load
    // (which a bare `.then()` would) and whenHydrated() still resolves.
    await doc.whenHydrated();
    expect(doc.hydrated).toBe(true);
  });

  it("hydrates instead of hanging forever when the replay promise rejects", async () => {
    const doc = await bootWith(
      bareHost({ setUpdateListener: () => Promise.reject(new Error("nope")) }),
    );

    await doc.whenHydrated();
    expect(doc.hydrated).toBe(true);
  });

  it("resolves every whenHydrated() caller, not just the most recent one", async () => {
    let resolveReplay: () => void = () => {};
    const doc = await bootWith(
      bareHost({
        setUpdateListener: () =>
          new Promise<void>((resolve) => {
            resolveReplay = resolve;
          }),
      }),
    );

    const first = doc.whenHydrated();
    const second = doc.whenHydrated();
    resolveReplay();

    await Promise.all([first, second]);
    expect(doc.hydrated).toBe(true);
  });

  // What a naive `{ ...host }` transport breaks: a host whose methods rely on
  // `this` (a class instance, not a closure) — a real host is injected by the
  // messenger, so this codebase does not get to assume it is closure-based.
  it("calls host methods with the host itself as `this`, not a copy of it", async () => {
    class ClassHost {
      sent: unknown[] = [];
      selfAddr = "self@x.de";
      selfName = "Self";
      sendUpdateInterval = 1000;
      setUpdateListener(): Promise<void> {
        return Promise.resolve();
      }
      sendUpdate(update: { payload: unknown }): void {
        this.sent.push(update.payload);
      }
    }
    const host = new ClassHost();
    const doc = await bootWith(host);

    doc.setSettings({ groupCurrency: "EUR", title: "Trip" });

    expect(host.sent).toHaveLength(1);
  });
});
