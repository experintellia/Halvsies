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
  type CustomPaymentMethod,
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
 * `Bob added *Pizza* — €30.00` / `3 open debts · €57.20`.
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

/**
 * Why `id` cannot be removed from the roster, or null if they can be. Pure —
 * takes the ledger as arguments so the members screen and the writer below
 * apply exactly the same rule.
 *
 * Removing someone the ledger still references would silently rewrite history:
 * their share stops being attributed to anyone and the remaining balances no
 * longer sum to zero on peers that still have the member.
 */
/**
 * Why a real (non-virtual) member is off limits. They are the people actually
 * in the chat: their name is the messenger's to report and theirs to change,
 * and they belong to the split for as long as they are in the group.
 */
const NOT_VIRTUAL_RENAME =
  "their name comes from Delta Chat; only someone you added by hand can be renamed here";
const NOT_VIRTUAL_REMOVE =
  "they are in this chat; only someone you added by hand can be removed here";

export function removalBlockedBy(
  id: MemberId,
  expenses: Expense[],
  settlements: Settlement[],
): string | null {
  const paid = expenses.filter((e) => e.payerId === id).length;
  const shared = expenses.filter((e) => id in e.split.entries).length;
  const settled = settlements.filter(
    (s) => s.fromId === id || s.toId === id,
  ).length;
  const parts: string[] = [];
  if (paid) parts.push(`paid for ${paid} expense${paid === 1 ? "" : "s"}`);
  if (shared) parts.push(`is in ${shared} split${shared === 1 ? "" : "s"}`);
  if (settled) {
    parts.push(`has ${settled} recorded payment${settled === 1 ? "" : "s"}`);
  }
  return parts.length === 0 ? null : parts.join(", ");
}

/**
 * Validate one profile entry. Shared by the full snapshot and the
 * payment-details-only file — both are file content arriving from a chat, so
 * neither path gets a weaker check. `label` names the offender in errors
 * (`profile "a@x.de"` / `the payment details file`).
 */
function parseProfileValue(v: unknown, label: string): PaymentProfile {
  if (!isObj(v)) fail(`${label} is not an object`);
  const p: PaymentProfile = {
    paypalMe: str(v.paypalMe),
    iban: str(v.iban),
    accountHolder: str(v.accountHolder),
    bic: str(v.bic),
    revolutTag: str(v.revolutTag),
    wiseTag: str(v.wiseTag),
    venmo: str(v.venmo),
    monzoMe: str(v.monzoMe),
    bunqMe: str(v.bunqMe),
    cashtag: str(v.cashtag),
    upiVpa: str(v.upiVpa),
    note: str(v.note),
  };

  // Crypto is an object, so it needs its own shape check. The address is
  // rendered as a URI and shown for copying, so an unknown network must fall
  // back to "other" (address-only, no scheme) rather than be trusted to name
  // a URI scheme of the file's choosing.
  if (v.crypto !== undefined && v.crypto !== null) {
    if (!isObj(v.crypto)) fail(`${label} has an invalid crypto method`);
    const address = str(v.crypto.address);
    const cryptoLabel = str(v.crypto.label);
    if (!address || !cryptoLabel) {
      fail(`${label}: a crypto method needs a label and an address`);
    }
    const network = str(v.crypto.network);
    p.crypto = {
      label: cryptoLabel,
      address,
      network:
        network === "bitcoin" || network === "ethereum" || network === "monero"
          ? network
          : "other",
    };
  }
  // A profile may carry any number of custom link templates. `custom` (a
  // single object) is the pre-0.2 shape — still accepted on import so an
  // older backup restores, folded into the array.
  const rawCustoms: unknown[] = Array.isArray(v.customs)
    ? v.customs
    : v.custom !== undefined && v.custom !== null
      ? [v.custom]
      : [];
  const customs: CustomPaymentMethod[] = [];
  const seen = new Set<string>();
  for (const c of rawCustoms) {
    if (!isObj(c)) fail(`${label} has an invalid custom method`);
    const cLabel = str(c.label);
    const urlTemplate = c.urlTemplate;
    if (!cLabel || typeof urlTemplate !== "string") {
      fail(`${label} has an invalid custom payment method`);
    }
    // Rendered as a link later: only ever accept http(s) (no javascript:).
    if (!/^https?:\/\//i.test(urlTemplate)) {
      fail(`${label}: custom payment URL must start with http(s)://`);
    }
    // Ids must exist and be unique, or list edits would hit the wrong row
    // and React keys would collide. Synthesize one for the legacy shape.
    let id = str(c.id) ?? `legacy-${customs.length}`;
    while (seen.has(id)) id = `${id}-`;
    seen.add(id);
    customs.push({ id, label: cLabel, urlTemplate });
  }
  if (customs.length > 0) p.customs = customs;
  return p;
}

/**
 * Parse + validate a payment-details-only export (`exportOwnProfile`). The
 * top-level `profile` key is what tells this file apart from a full snapshot.
 */
export function parseProfileFile(json: string): PaymentProfile {
  let raw: unknown = undefined;
  try {
    raw = JSON.parse(json);
  } catch {
    fail("the file is not valid JSON");
  }
  if (!isObj(raw) || raw.profile === undefined) {
    fail("this file does not contain payment details");
  }
  return parseProfileValue(raw.profile, "the payment details file");
}

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
    profiles[key] = parseProfileValue(v, `profile "${key}"`);
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

  /**
   * Last local change, for the chat info line at the next flush — cleared by
   * editInfo() the moment it reads it. undefined means "nothing chat-worthy
   * happened since the last flush": setProfile, setSettings, renameMember,
   * removeMember and addVirtualMember all flush without setting this, and
   * must not have that silent write mistaken for whatever change (a join, an
   * old edit) last happened to leave this variable holding.
   */
  let last:
    | {
        kind: ChangeKind;
        title?: string;
        amountCents?: number;
        /** settlement parties: "X paid Y" names the debtor, not the recorder. */
        fromId?: MemberId;
        toId?: MemberId;
      }
    | undefined;
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
    startinfo?: string;
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
    const change = last;
    last = undefined; // consumed: the next flush starts from "nothing to report"
    // "join" is a throwaway kind when there is no change to describe — only
    // .summary is used below in that case, which (like every kind) never
    // depends on it (see the same trick in Balances.tsx).
    const { text, summary } = describeChange(change?.kind ?? "join", {
      // Every flush carries this peer's own edits, so the actor is self —
      // except "settle", whose sentence names the debtor. A creditor can mark
      // a payment received on behalf of whoever owed them (often a virtual
      // member who never opens the app); reading self there posted the
      // nonsense "Anna paid Anna".
      actorName: nameOf(change?.kind === "settle" ? change.fromId : selfId),
      currency: settings.groupCurrency,
      title: change?.title,
      amountCents: change?.amountCents,
      toName: nameOf(change?.toId),
      openDebts: open.length,
      openTotalCents: open.reduce((s, t) => s + t.amountCents, 0),
    });
    return {
      document: settings.title || "Halvsies",
      summary,
      // No text at all — not "Someone joined the split" — for a write that
      // never described itself (setProfile, setSettings, ...): silence is
      // more informative than a fabricated or stale announcement.
      startinfo: change ? text : undefined,
    };
  }

  // --- writers (each one transaction, then flush to peers) -------------------

  function addExpense(e: Expense): void {
    doc.transact(() => yExpenses.set(e.id, e));
    last = {
      kind: "add",
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
      title: next.title,
      amountCents: next.amountCents,
    };
    flush();
  }

  function deleteExpense(id: ExpenseId): void {
    const prev = yExpenses.get(id);
    if (!prev) return;
    doc.transact(() => yExpenses.delete(id));
    last = { kind: "delete", title: prev.title };
    flush();
  }

  function addSettlement(s: Settlement): void {
    doc.transact(() => ySettlements.set(s.id, s));
    last = {
      kind: "settle",
      fromId: s.fromId,
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

  /**
   * Rename a member, or return why not. Only manually-added members can be
   * renamed: a real member's name is the one Delta Chat reports for them
   * (registerSelf keeps it in sync), so letting a third party rewrite it here
   * would put a name on the roster that its owner never chose and cannot
   * correct from the messenger. The guard lives here, not only in the members
   * screen, because this is a synced document — an older build or a stale open
   * screen must not be able to write it either.
   */
  function renameMember(id: MemberId, name: string): string | null {
    const prev = yMembers.get(id);
    if (!prev) return null;
    if (!prev.isVirtual) return NOT_VIRTUAL_RENAME;
    const trimmed = name.trim();
    if (!trimmed) return "a name cannot be empty";
    if (trimmed === prev.name) return null;
    doc.transact(() => yMembers.set(id, { ...prev, name: trimmed }));
    flush();
    return null;
  }

  /**
   * Remove a member, or return why not. Two gates, and the one that no edit
   * can clear is reported first:
   *  - real members are never removable — they are in the chat, so removing
   *    them just makes this peer disagree with every other one (and they
   *    re-register on their next open anyway);
   *  - a virtual member is refused while the ledger still references them (the
   *    UI disables the button with the same reason; this is the backstop that
   *    keeps a stale screen, or a concurrent peer's new expense, from tearing
   *    a hole in the balances).
   * Their payment profile goes with them.
   */
  function removeMember(id: MemberId): string | null {
    const prev = yMembers.get(id);
    if (!prev) return null;
    if (!prev.isVirtual) return NOT_VIRTUAL_REMOVE;
    const blocked = removalBlockedBy(id, listExpenses(), listSettlements());
    if (blocked) return blocked;
    doc.transact(() => {
      yMembers.delete(id);
      yProfiles.delete(id);
    });
    flush();
    return null;
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
   *
   * The host owns a real member's name (renameMember refuses for them), so an
   * existing entry is re-synced from it rather than left alone. Three guards:
   *  - only ever `addr`'s own entry, and registerSelf is only ever called with
   *    host.selfAddr — nobody else's name is touched;
   *  - only when it actually differs, so merely opening the app does not emit
   *    a CRDT update and a chat flush every single time;
   *  - never when the host has nothing to offer. Callers pass
   *    `host.selfName || host.selfAddr`, so a host with no display name hands
   *    us the address — which must not overwrite a good stored name.
   */
  function registerSelf(addr: string, name: string): Member {
    selfId = addr;
    const existing = yMembers.get(addr);
    if (existing) {
      if (!name || name === addr || name === existing.name) return existing;
      const renamed: Member = { ...existing, name };
      doc.transact(() => yMembers.set(addr, renamed));
      flush();
      return renamed;
    }
    const member: Member = {
      id: addr,
      name: name || addr,
      isVirtual: false,
      addr,
    };
    doc.transact(() => yMembers.set(addr, member));
    last = { kind: "join" };
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

  /**
   * The local user's member id. It is set by registerSelf, which is only ever
   * called with `host.selfAddr` (ensureSelfRegistered) — so the profile import
   * below can never land on someone else's id.
   */
  function ownId(): MemberId {
    if (!selfId) throw new Error("You are not registered in this group yet.");
    return selfId;
  }

  /** Just your own payment coordinates, portable to another Halvsies group. */
  function exportOwnProfile(): string {
    return JSON.stringify({ profile: yProfiles.get(ownId()) ?? {} }, null, 2);
  }

  /** Non-destructive: writes only the local user's profile entry. */
  function importOwnProfile(json: string): void {
    setProfile(ownId(), parseProfileFile(json));
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
    removeMember,
    setSettings,
    registerSelf,
    subscribe,
    exportSnapshot,
    importSnapshot,
    exportOwnProfile,
    importOwnProfile,
  };
}

export type Store = ReturnType<typeof createDoc>;

// --- the singleton (a webxdc app has exactly one document) -------------------

const store = createDoc();

/** Outside a webxdc host (vitest/SSR) there is no provider; the doc still works. */
const host = typeof window === "undefined" ? undefined : window.webxdc;

/**
 * True once webxdc has replayed every status update that existed when the app
 * opened (see `setUpdateListener` in @webxdc/types) — i.e. once this peer's
 * doc reflects everything a previous session already wrote to the chat, not
 * just whatever happened to arrive before first paint. That replay is a real
 * round trip to the host, so on a real device it is briefly false on every
 * open; App.tsx must wait for it before deciding "needs setup", or the setup
 * screen flashes past every single time while history is still catching up.
 * Already true with no host (tests/SSR) — there is nothing to wait for.
 */
export let hydrated = !host;
let notifyHydrated: () => void = () => {};
/** Single promise, not one per call: every caller shares the same settlement. */
const hydratedPromise: Promise<void> = host
  ? new Promise((resolve) => {
      notifyHydrated = resolve;
    })
  : Promise.resolve();

/** Resolves once `hydrated` flips true; already-resolved if it already has. */
export function whenHydrated(): Promise<void> {
  return hydratedPromise;
}

// y-webxdc's WebxdcProvider calls webxdc.setUpdateListener() itself and
// discards the promise it returns — the promise is the only signal the host
// gives for "caught up", so it is tapped here rather than registering a
// second listener (the spec only allows one). Built narrow — exactly the
// three members WebxdcTransport picks — rather than `{ ...host, ... }`: a
// spread copies `host.sendUpdate` etc. as plain properties, so WebxdcProvider
// would later call them with `this` bound to the copy, not the host. Harmless
// for every host implementation on hand (closures, not `this`-using methods),
// but the host is injected by the messenger, not this codebase, so it isn't
// this file's call to make.
const transport = host && {
  sendUpdate: (
    update: Parameters<typeof host.sendUpdate>[0],
    description: "",
  ) => host.sendUpdate(update, description),
  sendUpdateInterval: host.sendUpdateInterval,
  setUpdateListener(
    cb: Parameters<typeof host.setUpdateListener>[0],
    serial?: number,
  ) {
    // `setUpdateListener`'s Promise return is a newer addition to the webxdc
    // spec than most of this file already assumes elsewhere (canSendToChat,
    // importFiles below) — Promise.resolve() tolerates a host that predates
    // it and still returns nothing thenable. The .catch treats a rejection
    // the same as "caught up": a stale flash once beats never rendering the
    // app again over one bad promise.
    const settle = (): void => {
      hydrated = true;
      notifyHydrated();
    };
    return Promise.resolve(host.setUpdateListener(cb, serial))
      .then(settle)
      .catch(settle);
  },
};

export const provider = transport
  ? new WebxdcProvider({
      webxdc: transport,
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
  removeMember,
  setSettings,
  subscribe,
  exportSnapshot,
  importSnapshot,
  exportOwnProfile,
  importOwnProfile,
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

/** Send only your own payment details, to re-import in another group's chat. */
export function sendOwnProfileToChat(): void {
  if (!canSendToChat || !host) return;
  flush(); // sendToChat may close the app
  host
    .sendToChat({
      file: {
        name: "halvsies-payment-details.json",
        plainText: exportOwnProfile(),
      },
      text: "My Halvsies payment details — open Halvsies in another group and use Restore from file to add them there.",
    })
    .catch(() => {
      /* user cancelled or the app is closing */
    });
}
