// The Expenses tab: newest-first list + the add/edit sheet.
//
// Ids are ULID-ish (model.newId): ascending id order is chronological, so
// "newest first" is just the reverse of state/doc's listExpenses().
import { useState } from "preact/hooks";
import { getSettings, listExpenses, listMembers } from "../state/doc";
import { splitShares } from "../state/balances";
import {
  formatMoney,
  type Expense,
  type ExpenseId,
  type MemberId,
} from "../state/model";
import { useDocValue, useSelfId } from "./useDoc";
import { Row } from "./components/Row";
import { Avatar } from "./components/Avatar";
import { ExpenseForm } from "./ExpenseForm";
import { ExpenseDetail } from "./ExpenseDetail";

export function ExpenseList() {
  const expenses = useDocValue(listExpenses);
  const members = useDocValue(listMembers);
  const currency = useDocValue(getSettings).groupCurrency;
  const selfId = useSelfId();
  // Ids, not the expense objects: a peer editing (or deleting) the expense
  // you have open should update (or empty) the sheet, not leave you looking
  // at a snapshot from the moment you tapped.
  const [viewId, setViewId] = useState<ExpenseId | null>(null);
  const [editId, setEditId] = useState<ExpenseId | "new" | null>(null);

  const newest = [...expenses].reverse();
  const memberIds = members.map((m) => m.id);
  const nameOf = (id: MemberId): string =>
    members.find((m) => m.id === id)?.name || "Someone";

  const find = (id: ExpenseId | null): Expense | undefined =>
    id === null ? undefined : expenses.find((e) => e.id === id);
  const viewing = find(viewId);
  const editing = editId === "new" ? undefined : find(editId);

  const addBtn = () => setEditId("new");

  return (
    <section aria-label="Expenses">
      <button
        type="button"
        className="btn btn-primary"
        style={{ width: "100%", marginBottom: 12 }}
        onPointerUp={addBtn}
        onClick={(e) => {
          if (e.detail === 0) addBtn();
        }}
      >
        + Add expense
      </button>

      {newest.length === 0 ? (
        <p className="placeholder">
          No expenses yet — add the first one to start splitting.
        </p>
      ) : (
        newest.map((expense) => {
          const payer = members.find((m) => m.id === expense.payerId);
          const shares = splitShares(expense, memberIds);
          const myShare = selfId ? (shares[selfId] ?? 0) : undefined;
          return (
            <Row key={expense.id} onActivate={() => setViewId(expense.id)}>
              <Avatar member={payer ?? { id: expense.payerId, name: "?" }} />
              {/* Two lines, each with its own overflow rule: a long title or
                  payer name ellipsizes, while the date and the amounts never
                  shrink — sharing one nowrap line let a long name push the
                  date straight over the amount column. */}
              <span className="expense-main">
                <span className="expense-title">
                  {expense.title || "Untitled"}
                </span>
                <span className="expense-meta">
                  <span className="expense-payer">
                    {nameOf(expense.payerId)} paid
                  </span>
                  <span className="expense-date">{expense.date}</span>
                </span>
              </span>
              <span className="expense-amounts">
                <span className="money">
                  {formatMoney(expense.amountCents, currency)}
                </span>
                {myShare !== undefined && (
                  <span className="money expense-share">
                    Your share {formatMoney(myShare, currency)}
                  </span>
                )}
              </span>
            </Row>
          );
        })
      )}

      <ExpenseDetail
        open={viewId !== null}
        expense={viewing}
        selfId={selfId}
        onClose={() => setViewId(null)}
        onEdit={() => {
          setEditId(viewId);
          setViewId(null);
        }}
      />

      <ExpenseForm
        open={editId === "new" || editing !== undefined}
        expense={editing}
        onClose={() => setEditId(null)}
      />
    </section>
  );
}
