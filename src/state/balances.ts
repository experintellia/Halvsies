// Pure split math and net balances (Plan.md §5 M1). Integer cents only, no
// floats in any returned value, no Date.now()/Math.random() — every peer must
// compute byte-identical results from the same ledger.

import type { Expense, MemberId, Settlement } from "./model";

/**
 * Largest bookable amount, in cents (€999,999,999.99) — the EPC069-12 cap,
 * reused here so an amount can never be entered that the pay-up QR couldn't
 * carry, and so split arithmetic stays far inside Number.MAX_SAFE_INTEGER.
 */
export const MAX_AMOUNT_CENTS = 99999999999;

/**
 * Ascending id order. The default comparator is UTF-16 code-unit order:
 * locale-independent (unlike localeCompare) and therefore identical on every
 * peer, which is what makes remainder distribution reproducible.
 */
function sortedIds(entries: Record<MemberId, number>): MemberId[] {
  return Object.keys(entries).sort();
}

/** Even split: base cents each, the leftover cents to the lowest ids. */
function evenShares(
  amountCents: number,
  ids: MemberId[],
): Record<MemberId, number> {
  const out: Record<MemberId, number> = {};
  const n = ids.length;
  const base = Math.floor(amountCents / n);
  // remainder is in [0, n) even for negative amounts, so the sum stays exact.
  const remainder = amountCents - base * n;
  for (let i = 0; i < n; i++) out[ids[i]] = base + (i < remainder ? 1 : 0);
  return out;
}

/**
 * Each participant's owed share in integer cents. Sum equals
 * `expense.amountCents` exactly for "even" and "weights"; "exact" entries are
 * passed through unchanged (use {@link validateSplit} to reject bad ones).
 *
 * `_memberIds` is part of the shared call signature but unused here: the
 * participant set lives in `expense.split.entries`, and shares of members
 * missing from the roster must still be returned rather than dropped.
 */
export function splitShares(
  expense: Expense,
  _memberIds: MemberId[],
): Record<MemberId, number> {
  const { mode, entries } = expense.split;
  const ids = sortedIds(entries);
  if (ids.length === 0) return {};

  if (mode === "exact") {
    const out: Record<MemberId, number> = {};
    for (const id of ids) out[id] = entries[id];
    return out;
  }

  if (mode === "even") return evenShares(expense.amountCents, ids);

  // "weights": proportional, then the rounding drift is handed out ±1 cent at
  // a time in ascending id order until the sum matches exactly.
  let total = 0;
  for (const id of ids) total += entries[id];
  if (!(total > 0)) return evenShares(expense.amountCents, ids);

  const out: Record<MemberId, number> = {};
  let sum = 0;
  for (const id of ids) {
    const share = Math.round((expense.amountCents * entries[id]) / total);
    out[id] = share;
    sum += share;
  }
  // Math.round keeps this an integer (and finite) even if amountCents is not,
  // so the loop below always terminates.
  let residual = Math.round(expense.amountCents - sum);
  // Hand the drift only to members who actually carry weight: a weight-0
  // member was deliberately excluded, and giving them a ±1c share invents a
  // debt (or a credit) that shows up as a real transfer row to settle.
  const drift = ids.filter((id) => entries[id] > 0);
  const step = residual > 0 ? 1 : -1;
  for (let i = 0; residual !== 0; i++) {
    out[drift[i % drift.length]] += step;
    residual -= step;
  }
  return out;
}

/** null when the split is bookable, otherwise a short reason for the UI. */
export function validateSplit(expense: Expense): string | null {
  const { amountCents, split } = expense;
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return "Amount must be more than zero";
  }
  // Upper bound matters for correctness, not just sanity: past ~2^53 the split
  // arithmetic silently leaves exact-integer land, netBalances stops summing to
  // zero, and simplifyDebts then throws on every peer. MAX_AMOUNT_CENTS is the
  // EPC069-12 cap, comfortably inside the safe-integer range.
  if (amountCents > MAX_AMOUNT_CENTS) return "Amount is too large";
  const ids = Object.keys(split.entries);
  if (ids.length === 0) return "Pick at least one participant";

  if (split.mode === "exact") {
    let sum = 0;
    for (const id of ids) {
      const cents = split.entries[id];
      if (!Number.isInteger(cents) || cents < 0) {
        return "Exact amounts must be whole cents, zero or more";
      }
      sum += cents;
    }
    if (sum !== amountCents) return "Exact amounts must add up to the total";
  }

  if (split.mode === "weights") {
    let positive = false;
    for (const id of ids) {
      const w = split.entries[id];
      if (!Number.isFinite(w) || w < 0) return "Weights must be zero or more";
      if (w > 0) positive = true;
    }
    if (!positive) return "At least one weight must be more than zero";
  }

  return null;
}

/**
 * Net position per member in integer cents: positive = the group owes them,
 * negative = they owe the group. Every id in `memberIds` is present (0 if
 * untouched); payers/participants outside the roster are included too.
 *
 * The sum of all values is always exactly 0 — the payer is credited with what
 * the split actually distributed, so even a malformed "exact" split cannot
 * conjure money into the ledger.
 */
export function netBalances(
  expenses: Expense[],
  settlements: Settlement[],
  memberIds: MemberId[],
): Record<MemberId, number> {
  const out: Record<MemberId, number> = {};
  const bump = (id: MemberId, delta: number) => {
    out[id] = (out[id] ?? 0) + delta;
  };
  for (const id of memberIds) bump(id, 0);

  for (const expense of expenses) {
    const shares = splitShares(expense, memberIds);
    let distributed = 0;
    for (const id of Object.keys(shares)) {
      bump(id, -shares[id]);
      distributed += shares[id];
    }
    bump(expense.payerId, distributed);
  }

  for (const settlement of settlements) {
    bump(settlement.fromId, settlement.amountCents);
    bump(settlement.toId, -settlement.amountCents);
  }

  return out;
}
