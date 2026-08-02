// The Expenses tab: a newest-first list grouped by day, plus the add/edit
// sheet.
import { Fragment } from "preact";
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

const WEEKDAY = new Intl.DateTimeFormat(undefined, { weekday: "long" });
const DATE = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "long",
  year: "numeric",
});

/** "Wednesday - 6 May 2026", the day header for an ISO `yyyy-mm-dd` date. */
export function dayHeading(iso: string): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!parts) return iso; // an imported ledger can carry anything
  // Built from the components, not Date.parse: an ISO date string parses as
  // UTC midnight, which formats as the *previous* day everywhere west of
  // Greenwich — the one place a date is allowed to move by a timezone.
  const d = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
  return `${WEEKDAY.format(d)} - ${DATE.format(d)}`;
}

/**
 * Newest day first, and newest-added first within a day.
 *
 * Not the id order the list used to run on: an id is chronological by
 * creation, but a date is whatever the user typed, so an expense added today
 * can belong to last Tuesday. Grouping runs of id-ordered rows would print
 * that Tuesday's header twice, with other days in between.
 */
const byDayThenNewest = (a: Expense, b: Expense): number =>
  a.date === b.date ? (a.id < b.id ? 1 : -1) : a.date < b.date ? 1 : -1;

function groupByDay(expenses: Expense[]): { date: string; items: Expense[] }[] {
  const days: { date: string; items: Expense[] }[] = [];
  for (const e of [...expenses].sort(byDayThenNewest)) {
    const open = days[days.length - 1];
    if (open && open.date === e.date) open.items.push(e);
    else days.push({ date: e.date, items: [e] });
  }
  return days;
}

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

  const days = groupByDay(expenses);
  const memberIds = members.map((m) => m.id);
  const nameOf = (id: MemberId): string =>
    members.find((m) => m.id === id)?.name || "Someone";

  const find = (id: ExpenseId | null): Expense | undefined =>
    id === null ? undefined : expenses.find((e) => e.id === id);
  const viewing = find(viewId);
  const editing = editId === "new" ? undefined : find(editId);

  const addBtn = () => setEditId("new");

  const card = (expense: Expense) => {
    const payer = members.find((m) => m.id === expense.payerId);
    const shares = splitShares(expense, memberIds);
    const myShare = selfId ? (shares[selfId] ?? 0) : undefined;
    return (
      <Row key={expense.id} onActivate={() => setViewId(expense.id)}>
        <Avatar member={payer ?? { id: expense.payerId, name: "?" }} />
        {/* The day header carries the date now, so the card's middle column
            is title over payer — both user-typed, both ellipsizing, neither
            able to push the amounts out of their column. */}
        <span className="expense-main">
          <span className="expense-title">{expense.title || "Untitled"}</span>
          <span className="expense-payer">{nameOf(expense.payerId)} paid</span>
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
  };

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

      {days.length === 0 ? (
        <p className="placeholder">
          No expenses yet — add the first one to start splitting.
        </p>
      ) : (
        days.map((day) => (
          <Fragment key={day.date}>
            <h2 className="day-heading">{dayHeading(day.date)}</h2>
            {day.items.map(card)}
          </Fragment>
        ))
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
