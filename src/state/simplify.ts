import type { MemberId, Transfer } from "./model";

interface Entry {
  id: MemberId;
  amount: number;
}

/** amount DESC, then id ASC — so ties never depend on key insertion order. */
function byAmountThenId(a: Entry, b: Entry): number {
  return b.amount - a.amount || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * Greedy min-cash-flow: match the biggest debtor against the biggest creditor
 * until everything is zero. Pure and deterministic — identical output on every
 * peer for the same logical balances.
 *
 * @param balances net balance per member in integer cents (negative = owes).
 *   Must sum to 0 (netBalances() guarantees this).
 */
export function simplifyDebts(balances: Record<MemberId, number>): Transfer[] {
  const debtors: Entry[] = [];
  const creditors: Entry[] = [];
  let sum = 0;
  for (const id of Object.keys(balances)) {
    const amount = balances[id];
    sum += amount;
    if (amount < 0) debtors.push({ id, amount: -amount });
    else if (amount > 0) creditors.push({ id, amount });
  }
  if (sum !== 0) {
    throw new Error(`simplifyDebts: balances must sum to 0, got ${sum}`);
  }

  // ponytail: greedy, not optimal min-transfer (that's NP-hard); n-1 upper
  // bound is plenty for a chat-sized group. Re-sort per iteration is O(n² log n)
  // on a handful of members — fine.
  const transfers: Transfer[] = [];
  while (debtors.length > 0 && creditors.length > 0) {
    debtors.sort(byAmountThenId);
    creditors.sort(byAmountThenId);
    const debtor = debtors[0];
    const creditor = creditors[0];
    const amountCents = Math.min(debtor.amount, creditor.amount);
    transfers.push({ fromId: debtor.id, toId: creditor.id, amountCents });
    debtor.amount -= amountCents;
    creditor.amount -= amountCents;
    if (debtor.amount === 0) debtors.shift();
    if (creditor.amount === 0) creditors.shift();
  }
  return transfers;
}
