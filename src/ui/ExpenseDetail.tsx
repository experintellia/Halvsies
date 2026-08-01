// Read-only view of one expense. Tapping a row in the list lands here, not in
// the edit form: in a shared ledger every edit is a money claim every peer
// sees, so the destructive screen needs a deliberate second tap ("Edit"),
// not an accidental first one.
import {
  getMember,
  getSettings,
  listMembers,
  listSettlements,
} from "../state/doc";
import { splitShares } from "../state/balances";
import { formatMoney, type Expense, type MemberId } from "../state/model";
import { useDocValue } from "./useDoc";
import { Sheet } from "./components/Sheet";
import { Avatar } from "./components/Avatar";

export interface ExpenseDetailProps {
  open: boolean;
  onClose: () => void;
  onEdit: () => void;
  expense: Expense | undefined;
  /** The local user's member id, so their own row can be marked. */
  selfId: MemberId | undefined;
}

const MODE_TEXT: Record<Expense["split"]["mode"], string> = {
  even: "Split evenly",
  weights: "Split by weights",
  exact: "Split by exact amounts",
};

export function ExpenseDetail({
  open,
  onClose,
  onEdit,
  expense,
  selfId,
}: ExpenseDetailProps) {
  // Subscribed so a remote rename/settlement while this sheet is open is
  // reflected rather than frozen at the moment it was tapped.
  const members = useDocValue(listMembers);
  const currency = useDocValue(getSettings).groupCurrency;
  useDocValue(listSettlements); // re-render trigger only

  if (!expense) return null;

  const memberIds = members.map((m) => m.id);
  const shares = splitShares(expense, memberIds);
  // Sorted by id, matching splitShares' own ordering, so every peer sees the
  // same list even when the roster differs.
  const shareIds = Object.keys(shares).sort();
  const payer = getMember(expense.payerId);
  const nameOf = (id: MemberId): string =>
    members.find((m) => m.id === id)?.name || "Someone";

  return (
    <Sheet open={open} onClose={onClose} title={expense.title || "Expense"}>
      <p className="detail-amount money">
        {formatMoney(expense.amountCents, currency)}
      </p>
      <p className="detail-sub">
        Paid by {nameOf(expense.payerId)} · {expense.date}
      </p>

      <h3 className="detail-heading">{MODE_TEXT[expense.split.mode]}</h3>
      <ul className="detail-shares">
        {shareIds.map((id) => (
          <li key={id} className="detail-share">
            <Avatar
              member={
                members.find((m) => m.id === id) ?? { id, name: nameOf(id) }
              }
            />
            <span className="detail-share-name">
              {id === selfId ? "You" : nameOf(id)}
              {id === expense.payerId && (
                <span className="field-suffix"> · paid</span>
              )}
            </span>
            <span className="money">{formatMoney(shares[id], currency)}</span>
          </li>
        ))}
      </ul>
      {payer === undefined && (
        <p className="field-suffix">
          The payer is no longer in this group's member list.
        </p>
      )}

      <button
        type="button"
        className="btn btn-primary"
        style={{ width: "100%", marginTop: 8 }}
        onPointerUp={onEdit}
        onClick={(e) => {
          if (e.detail === 0) onEdit();
        }}
      >
        Edit
      </button>
    </Sheet>
  );
}
