// The one shared document: a Y.Doc synced to chat peers by y-webxdc, plus every
// typed reader/writer the UI is allowed to use (Plan.md §4, §7). Components never
// touch Yjs directly.
//
// Values in the five Y.Maps are PLAIN JSON objects, not nested Y.Maps: this app
// never needs character-level merging inside an expense field, so last-write-wins
// per entry is the correct (and much simpler) semantic — it also keeps the
// accessors and the JSON snapshot trivial. Never mutate a value read out of a
// map; writers always `set` a fresh object.

import * as Y from "yjs";
import { WebxdcProvider } from "y-webxdc";
import { MAX_AMOUNT_CENTS, netBalances, validateSplit } from "./balances";
import { simplifyDebts } from "./simplify";
import {
  formatMoney,
  isCurrencyCode,
  newId,
  type Expense,
  type ExpenseId,
  type Member,
  type MemberId,
  type PaymentProfile,
  type Settings,
  type Settlement,
  type SettlementId,
} from "./model";

/** Fallback until someone picks a currency in settings. */
const DEFAULT_CURRENCY = "EUR";

const byId = (a: { id: string }, b: { id: string }): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** Empty any of the Y.Maps regardless of value type (structural, so no casts). */
function clear(m: {
  keys(): IterableIterator<string>;
  delete(key: string): void;
}): void {
  for (const key of [...m.keys()]) m.delete(key);
}

// --- chat info lines ----------------------------------------------------------

export type ChangeKind =
  "add" | "edit" | "delete" | "settle" | "import" | "join";

export interface ChangePayload {
  /** display name of whoever made the change */
  actorName: string;
  currency: string;
  /** expense title, for add/edit/delete */
  title?: string;
  amountCents?: number;
  /** payee, for settlements */
  toName?: string;
  /** open (unsettled) debts, for the chat summary line */
  openDebts: number;
  openTotalCents: number;
}

/**
 * Pure formatter for the webxdc chat info line + summary, e.g.
 * `Simon added *Pizza* — €30.00` / `3 open debts · €57.20`.
 */
export function describeChange(
  kind: ChangeKind,
  p: ChangePayload,
): { text: string; summary: string } {
  const who = p.actorName || "Someone";
  const what = p.title ? `*${p.title}*` : "an expense";
  const money =
    p.amountCents === undefined ? "" : formatMoney(p.amountCents, p.currency);
  const text = {
    add: `${who} added ${what} — ${money}`,
    edit: `${who} edited ${what} — ${money}`,
    delete: `${who} deleted ${what}`,
    settle: `${who} paid ${p.toName || "someone"} ${money}`,
    import: `${who} imported a Halvsies snapshot`,
    join: `${who} joined the split`,
  }[kind];
  const summary =
    p.openDebts <= 0
      ? "All settled up"
      : `${p.openDebts} open debt${p.openDebts === 1 ? "" : "s"} · ${formatMoney(
          p.openTotalCents,
          p.currency,
        )}`;
  return { text, summary };
}

// --- snapshot validation (trust boundary: file content from a chat) -----------

export interface Snapshot {
  settings: Settings;
  members: Record<MemberId, Member>;
  profiles: Record<MemberId, PaymentProfile>;
  expenses: Record<ExpenseId, Expense>;
  settlements: Record<SettlementId, Settlement>;
}

function fail(msg: string): never {
  throw new Error(`Import failed: ${msg}`);
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function records(v: unknown, what: string): Record<string, unknown> {
  if (v === undefined || v === null) return {};
  if (!isObj(v)) fail(`"${what}" must be an object keyed by id`);
  return v;
}

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v ? v : undefined;

/** Parse + validate an exported snapshot. Throws a human-readable Error. */
export function parseSnapshot(json: string): Snapshot {
  let raw: unknown = undefined;
  try {
    raw = JSON.parse(json);
  } catch {
    fail("the file is not valid JSON");
  }
  if (!isObj(raw)) fail("the file must contain a JSON object");

  const rawSettings = records(raw.settings, "settings");
  const currency = rawSettings.groupCurrency;
  if (currency !== undefined && !/^[A-Za-z]{3}$/.test(String(currency))) {
    fail(`"${String(currency)}" is not a 3-letter ISO currency code`);
  }
  const settings: Settings = {
    groupCurrency: currency ? String(currency).toUpperCase() : DEFAULT_CURRENCY,
    title: str(rawSettings.title),
  };

  const members: Record<MemberId, Member> = {};
  for (const [key, v] of Object.entries(records(raw.members, "members"))) {
    if (!isObj(v)) fail(`member "${key}" is not an object`);
    if (typeof v.id !== "string" || !v.id) fail(`member "${key}" has no id`);
    members[v.id] = {
      id: v.id,
      name: str(v.name) || v.id,
      isVirtual: Boolean(v.isVirtual),
      addr: str(v.addr),
    };
  }

  const profiles: Record<MemberId, PaymentProfile> = {};
  for (const [key, v] of Object.entries(records(raw.profiles, "profiles"))) {
    if (!isObj(v)) fail(`profile "${key}" is not an object`);
    const p: PaymentProfile = {
      paypalMe: str(v.paypalMe),
      iban: str(v.iban),
      accountHolder: str(v.accountHolder),
      bic: str(v.bic),
      revolutTag: str(v.revolutTag),
      wiseTag: str(v.wiseTag),
      venmo: str(v.venmo),
      monzoMe: str(v.monzoMe),
      note: str(v.note),
    };
    const c = v.custom;
    if (c !== undefined && c !== null) {
      if (!isObj(c)) fail(`profile "${key}" has an invalid custom method`);
      const label = str(c.label);
      const urlTemplate = c.urlTemplate;
      if (!label || typeof urlTemplate !== "string") {
        fail(`profile "${key}" has an invalid custom payment method`);
      }
      // Rendered as a link later: only ever accept http(s) (no javascript:).
      if (!/^https?:\/\//i.test(urlTemplate)) {
        fail(`profile "${key}": custom payment URL must start with http(s)://`);
      }
      p.custom = { label, urlTemplate };
    }
    profiles[key] = p;
  }

  const expenses: Record<ExpenseId, Expense> = {};
  for (const [key, v] of Object.entries(records(raw.expenses, "expenses"))) {
    if (!isObj(v)) fail(`expense "${key}" is not an object`);
    if (typeof v.id !== "string" || !v.id) fail(`expense "${key}" has no id`);
    if (!Number.isInteger(v.amountCents)) {
      fail(`expense "${v.id}": amountCents must be an integer number of cents`);
    }
    if (typeof v.payerId !== "string" || !v.payerId) {
      fail(`expense "${v.id}" has no payerId`);
    }
    const split: unknown = v.split;
    if (!isObj(split)) fail(`expense "${v.id}" has an invalid split`);
    const mode = split.mode;
    const rawEntries = split.entries;
    if (
      (mode !== "even" && mode !== "weights" && mode !== "exact") ||
      !isObj(rawEntries)
    ) {
      fail(`expense "${v.id}" has an invalid split`);
    }
    const entries: Record<MemberId, number> = {};
    for (const [m, n] of Object.entries(rawEntries)) {
      if (typeof n !== "number" || !isFinite(n)) {
        fail(`expense "${v.id}" has a non-numeric split share for "${m}"`);
      }
      entries[m] = n;
    }
    const expense: Expense = {
      id: v.id,
      title: typeof v.title === "string" ? v.title : "",
      amountCents: v.amountCents as number,
      payerId: v.payerId,
      split: { mode, entries },
      date: str(v.date) || "",
      category: str(v.category),
      createdBy: str(v.createdBy) || v.payerId,
      editedAt: typeof v.editedAt === "number" ? v.editedAt : 0,
    };
    // The shape checks above don't catch a *bookable* expense: a negative
    // amount invents a reversed debt, a fractional "exact" entry makes balances
    // sum to a float epsilon (which simplifyDebts throws on). Reuse the exact
    // validator the expense form gates Save on, so an imported ledger can never
    // be one the app itself would refuse to create.
    const reason = validateSplit(expense);
    if (reason) fail(`expense "${v.id}": ${reason}`);
    expenses[v.id] = expense;
  }

  const settlements: Record<SettlementId, Settlement> = {};
  for (const [key, v] of Object.entries(
    records(raw.settlements, "settlements"),
  )) {
    if (!isObj(v)) fail(`settlement "${key}" is not an object`);
    if (typeof v.id !== "string" || !v.id)
      fail(`settlement "${key}" has no id`);
    // Must be strictly positive: a negative settlement flips the sign and
    // doubles the debt it claims to clear.
    if (
      !Number.isInteger(v.amountCents) ||
      (v.amountCents as number) <= 0 ||
      (v.amountCents as number) > MAX_AMOUNT_CENTS
    ) {
      fail(
        `settlement "${v.id}": amountCents must be a positive whole number of cents`,
      );
    }
    const from = str(v.fromId);
    const to = str(v.toId);
    if (!from || !to) fail(`settlement "${v.id}" is missing fromId/toId`);
    settlements[v.id] = {
      id: v.id,
      fromId: from,
      toId: to,
      amountCents: v.amountCents as number,
      method: str(v.method),
      date: str(v.date) || "",
      createdBy: str(v.createdBy) || from,
    };
  }

  return { settings, members, profiles, expenses, settlements };
}

// --- the document ------------------------------------------------------------

/**
 * Build a document with its accessors. The app uses the module singleton below;
 * tests use this factory to run several independent "peers" in one process.
 */
export function createDoc() {
  const doc = new Y.Doc();
  // "settings" holds one key per field (per-field last-write-wins).
  const ySettings = doc.getMap<string>("settings");
  const yMembers = doc.getMap<Member>("members");
  const yProfiles = doc.getMap<PaymentProfile>("profiles");
  const yExpenses = doc.getMap<Expense>("expenses");
  const ySettlements = doc.getMap<Settlement>("settlements");

  /** Last local change, for the chat info line at the next flush. */
  let last: {
    kind: ChangeKind;
    actorId?: MemberId;
    title?: string;
    amountCents?: number;
    toId?: MemberId;
  } = { kind: "join" };
  let selfId: MemberId | undefined;

  function getSettings(): Settings {
    return {
      groupCurrency: ySettings.get("groupCurrency") || DEFAULT_CURRENCY,
      title: ySettings.get("title"),
    };
  }

  const listMembers = (): Member[] => [...yMembers.values()].sort(byId);
  const getMember = (id: MemberId): Member | undefined => yMembers.get(id);
  const getProfile = (id: MemberId): PaymentProfile | undefined =>
    yProfiles.get(id);
  /** Sorted by id, which is chronological given ULID-ish ids (model.newId). */
  const listExpenses = (): Expense[] => [...yExpenses.values()].sort(byId);
  const listSettlements = (): Settlement[] =>
    [...ySettlements.values()].sort(byId);

  const nameOf = (id: MemberId | undefined): string =>
    (id && yMembers.get(id)?.name) || "";

  /** What y-webxdc shows in the chat on the next flush. */
  function editInfo(): {
    document: string;
    summary: string;
    startinfo: string;
  } {
    const settings = getSettings();
    // Computed here, from the document, rather than read from a counter a
    // mounted screen pushes in: editInfo() runs synchronously inside the flush
    // that the writer itself triggers, so any cached value is one edit stale —
    // and stays at "All settled up" forever if the user never opens Balances.
    const open = simplifyDebts(
      netBalances(
        listExpenses(),
        listSettlements(),
        listMembers().map((m) => m.id),
      ),
    );
    const { text, summary } = describeChange(last.kind, {
      // The flush only ever carries local edits, so the actor is this peer.
      actorName: nameOf(selfId ?? last.actorId),
      currency: settings.groupCurrency,
      title: last.title,
      amountCents: last.amountCents,
      toName: nameOf(last.toId),
      openDebts: open.length,
      openTotalCents: open.reduce((s, t) => s + t.amountCents, 0),
    });
    return {
      document: settings.title || "Halvsies",
      summary,
      startinfo: text,
    };
  }

  // --- writers (each one transaction, then flush to peers) -------------------

  function addExpense(e: Expense): void {
    doc.transact(() => yExpenses.set(e.id, e));
    last = {
      kind: "add",
      actorId: e.createdBy,
      title: e.title,
      amountCents: e.amountCents,
    };
    flush();
  }

  /** Merges `patch` over the stored expense; `now` becomes its editedAt. */
  function updateExpense(
    id: ExpenseId,
    patch: Partial<Omit<Expense, "id">>,
    now: number,
  ): void {
    const prev = yExpenses.get(id);
    if (!prev) return;
    const next: Expense = { ...prev, ...patch, id, editedAt: now };
    doc.transact(() => yExpenses.set(id, next));
    last = {
      kind: "edit",
      actorId: next.createdBy,
      title: next.title,
      amountCents: next.amountCents,
    };
    flush();
  }

  function deleteExpense(id: ExpenseId): void {
    const prev = yExpenses.get(id);
    if (!prev) return;
    doc.transact(() => yExpenses.delete(id));
    last = { kind: "delete", actorId: prev.createdBy, title: prev.title };
    flush();
  }

  function addSettlement(s: Settlement): void {
    doc.transact(() => ySettlements.set(s.id, s));
    last = {
      kind: "settle",
      actorId: s.fromId,
      toId: s.toId,
      amountCents: s.amountCents,
    };
    flush();
  }

  /** Payment coordinates are self-edited only; pass your own member id. */
  function setProfile(id: MemberId, profile: PaymentProfile): void {
    doc.transact(() => yProfiles.set(id, profile));
    flush();
  }

  function renameMember(id: MemberId, name: string): void {
    const prev = yMembers.get(id);
    const trimmed = name.trim();
    if (!prev || !trimmed) return;
    doc.transact(() => yMembers.set(id, { ...prev, name: trimmed }));
    flush();
  }

  function addVirtualMember(name: string, now: number): Member {
    const member: Member = {
      id: newId(now),
      name: name.trim() || "Someone",
      isVirtual: true,
    };
    doc.transact(() => yMembers.set(member.id, member));
    flush();
    return member;
  }

  function setSettings(patch: Partial<Settings>): void {
    doc.transact(() => {
      // Same rule parseSnapshot enforces on the import path: an invalid code
      // is silently dropped rather than persisted (the form flags it).
      if (isCurrencyCode(patch.groupCurrency)) {
        ySettings.set("groupCurrency", patch.groupCurrency.toUpperCase());
      }
      if (patch.title !== undefined) ySettings.set("title", patch.title);
    });
    flush();
  }

  /**
   * Register the local user. The webxdc address IS the member id: it is stable
   * and unique per peer, so two peers registering concurrently produce two
   * distinct keys, and the same peer registering again writes the same key.
   * Conflict-free by construction — no dedupe pass needed.
   * An existing entry is left alone (a peer may have renamed it).
   */
  function registerSelf(addr: string, name: string): Member {
    selfId = addr;
    const existing = yMembers.get(addr);
    if (existing) return existing;
    const member: Member = {
      id: addr,
      name: name || addr,
      isVirtual: false,
      addr,
    };
    doc.transact(() => yMembers.set(addr, member));
    last = { kind: "join", actorId: addr };
    flush();
    return member;
  }

  /** Re-render hook: fires once per transaction, local or remote. */
  function subscribe(fn: () => void): () => void {
    const handler = (): void => fn();
    doc.on("update", handler);
    return () => doc.off("update", handler);
  }

  function exportSnapshot(): string {
    return JSON.stringify(
      {
        settings: getSettings(),
        members: yMembers.toJSON(),
        profiles: yProfiles.toJSON(),
        expenses: yExpenses.toJSON(),
        settlements: ySettlements.toJSON(),
      },
      null,
      2,
    );
  }

  /** Replaces the whole document, or merges entry-by-entry with `merge: true`. */
  function importSnapshot(json: string, opts?: { merge?: boolean }): void {
    const snap = parseSnapshot(json);
    doc.transact(() => {
      if (!opts?.merge) {
        clear(ySettings);
        clear(yMembers);
        clear(yProfiles);
        clear(yExpenses);
        clear(ySettlements);
      }
      ySettings.set("groupCurrency", snap.settings.groupCurrency);
      if (snap.settings.title) ySettings.set("title", snap.settings.title);
      for (const m of Object.values(snap.members)) yMembers.set(m.id, m);
      for (const [id, p] of Object.entries(snap.profiles)) {
        yProfiles.set(id, p);
      }
      for (const e of Object.values(snap.expenses)) yExpenses.set(e.id, e);
      for (const s of Object.values(snap.settlements)) {
        ySettlements.set(s.id, s);
      }
    });
    last = { kind: "import" };
    flush();
  }

  return {
    doc,
    getSettings,
    listMembers,
    getMember,
    getProfile,
    listExpenses,
    listSettlements,
    editInfo,
    addExpense,
    updateExpense,
    deleteExpense,
    addSettlement,
    setProfile,
    renameMember,
    addVirtualMember,
    setSettings,
    registerSelf,
    subscribe,
    exportSnapshot,
    importSnapshot,
  };
}

export type Store = ReturnType<typeof createDoc>;

// --- the singleton (a webxdc app has exactly one document) -------------------

const store = createDoc();

/** Outside a webxdc host (vitest/SSR) there is no provider; the doc still works. */
const host = typeof window === "undefined" ? undefined : window.webxdc;

export const provider = host
  ? new WebxdcProvider({
      webxdc: host,
      ydoc: store.doc,
      getEditInfo: store.editInfo,
      // matches the webxdc default sendUpdateInterval
      autosaveInterval: 10_000,
    })
  : undefined;

/**
 * Push queued updates to peers now (autosave is the safety net). Every writer
 * calls this; docs from createDoc() in tests have no provider, so it is a no-op.
 */
export function flush(): void {
  provider?.syncToChatPeers();
}

/** Timestamps stay out of pure functions — the UI reads the clock here. */
export function now(): number {
  return Date.now();
}

export const doc = store.doc;

export const {
  getSettings,
  listMembers,
  getMember,
  getProfile,
  listExpenses,
  listSettlements,
  addExpense,
  updateExpense,
  deleteExpense,
  addSettlement,
  setProfile,
  renameMember,
  addVirtualMember,
  setSettings,
  subscribe,
  exportSnapshot,
  importSnapshot,
} = store;

/** Register the local user as a member; idempotent, safe on every open. */
export function ensureSelfRegistered(): Member {
  if (!host) throw new Error("no webxdc host: cannot register self");
  return store.registerSelf(host.selfAddr, host.selfName || host.selfAddr);
}

/** Send the full ledger to a chat as an attachable/restorable JSON file. */
/**
 * `sendToChat` is a newer webxdc API level: on older hosts (Ubuntu Touch is
 * the known floor, Plan.md §M4) the host object exists but the method does
 * not, so calling it throws. Callers must gate on this and steer the user to
 * copy/QR instead — send-to-chat is a first-class pay-up path, not a fallback.
 */
export const canSendToChat = typeof host?.sendToChat === "function";

export function sendSnapshotToChat(): void {
  if (!canSendToChat || !host) return;
  flush(); // sendToChat may close the app
  host
    .sendToChat({
      file: { name: "halvsies.json", plainText: exportSnapshot() },
      text: "Halvsies backup — open Halvsies and use Import to restore it.",
    })
    .catch(() => {
      /* user cancelled or the app is closing */
    });
}
