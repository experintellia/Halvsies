// The Expenses tab: newest-first list + the add/edit sheet.
//
// Ids are ULID-ish (model.newId): ascending id order is chronological, so
// "newest first" is just the reverse of state/doc's listExpenses().
import { useEffect, useState } from "preact/hooks";
import {
  ensureSelfRegistered,
  getSettings,
  listExpenses,
  listMembers,
} from "../state/doc";
import { splitShares } from "../state/balances";
import { formatMoney, type Expense, type MemberId } from "../state/model";
import { useDocValue } from "./useDoc";
import { Row } from "./components/Row";
import { Avatar } from "./components/Avatar";
import { ExpenseForm } from "./ExpenseForm";

/**
 * The local user's member id, once self-registration completes. Undefined
 * outside a webxdc host (vitest/SSR) or for the one render before the effect
 * below has run.
 */
export function useSelfId(): MemberId | undefined {
  const [id, setId] = useState<MemberId | undefined>(undefined);
  useEffect(() => {
    try {
      setId(ensureSelfRegistered().id);
    } catch {
      // no webxdc host — leave undefined (tests / SSR)
    }
  }, []);
  return id;
}

/** Which sheet is open: nothing, a fresh expense, or an existing one to edit. */
type Target = "new" | Expense | null;

export function ExpenseList() {
  const expenses = useDocValue(listExpenses);
  const members = useDocValue(listMembers);
  const currency = useDocValue(getSettings).groupCurrency;
  const selfId = useSelfId();
  const [target, setTarget] = useState<Target>(null);

  const newest = [...expenses].reverse();
  const memberIds = members.map((m) => m.id);
  const nameOf = (id: MemberId): string =>
    members.find((m) => m.id === id)?.name || "Someone";

  const addBtn = () => setTarget("new");

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
            <Row key={expense.id} onActivate={() => setTarget(expense)}>
              <Avatar member={payer ?? { id: expense.payerId, name: "?" }} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block" }}>
                  {expense.title || "Untitled"}
                </span>
                <span
                  style={{ display: "block", fontSize: "0.85rem" }}
                  className="field-suffix"
                >
                  {nameOf(expense.payerId)} paid · {expense.date}
                </span>
              </span>
              <span style={{ textAlign: "right", flexShrink: 0 }}>
                <span className="money" style={{ display: "block" }}>
                  {formatMoney(expense.amountCents, currency)}
                </span>
                {myShare !== undefined && (
                  <span
                    className="money field-suffix"
                    style={{ display: "block", fontSize: "0.78rem" }}
                  >
                    Your share {formatMoney(myShare, currency)}
                  </span>
                )}
              </span>
            </Row>
          );
        })
      )}

      <ExpenseForm
        open={target !== null}
        expense={target === "new" || target === null ? undefined : target}
        onClose={() => setTarget(null)}
      />
    </section>
  );
}
