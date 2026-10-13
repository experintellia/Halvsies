// The Expenses tab: what the group spent and your share of it, then a
// newest-first list grouped by day, plus the add/edit sheet.
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
import { Icon } from "./components/Icon";
import { SplitMark } from "./components/SplitMark";
import { ExpenseForm } from "./ExpenseForm";
import { ExpenseDetail } from "./ExpenseDetail";

const WEEKDAY = new Intl.DateTimeFormat(undefined, { weekday: "long" });
const DATE = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "long",
  year: "numeric",
});

/** "Wednesday, 6 May 2026", the day header for an ISO `yyyy-mm-dd` date. */
export function dayHeading(iso: string): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!parts) return iso; // an imported ledger can carry anything
  // Built from the components, not Date.parse: an ISO date string parses as
  // UTC midnight, which formats as the *previous* day everywhere west of
  // Greenwich — the one place a date is allowed to move by a timezone.
  const d = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
  return `${WEEKDAY.format(d)}, ${DATE.format(d)}`;
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

  const myShareOf = (expense: Expense): number | undefined =>
    selfId ? (splitShares(expense, memberIds)[selfId] ?? 0) : undefined;
  const totalCents = expenses.reduce((sum, e) => sum + e.amountCents, 0);
  const myTotalCents = selfId
    ? expenses.reduce((sum, e) => sum + (myShareOf(e) ?? 0), 0)
    : undefined;
  // Each row's bar is scaled to the biggest expense, so size reads at a glance.
  const largest = Math.max(1, ...expenses.map((e) => e.amountCents));

  const card = (expense: Expense) => {
    const payer = members.find((m) => m.id === expense.payerId);
    const myShare = myShareOf(expense);
    const barWidth = `${Math.max(3, (expense.amountCents / largest) * 100)}%`;
    return (
      <Row
        key={expense.id}
        className="expense-row"
        onActivate={() => setViewId(expense.id)}
      >
        <Avatar
          member={payer ?? { id: expense.payerId, name: "?" }}
          size={36}
        />
        {/* The day header carries the date now, so the card's middle column
            is title over payer — both user-typed, both ellipsizing, neither
            able to push the amounts out of their column. */}
        <span className="expense-main">
          <span className="expense-title">{expense.title || "Untitled"}</span>
          <span className="expense-payer">
            {expense.payerId === selfId ? "You" : nameOf(expense.payerId)} paid
          </span>
          <span
            className="amount-bar"
            style={{ width: barWidth }}
            aria-hidden="true"
          />
        </span>
        <span className="expense-amounts">
          <span className="money expense-amount">
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
    <section aria-label="Expenses" className="has-fab">
      {/* First in the DOM so keyboard and screen-reader users reach it before
          every row; it floats (position: fixed), so it still looks last. */}
      <button
        type="button"
        className="fab"
        onPointerUp={addBtn}
        onClick={(e) => {
          if (e.detail === 0) addBtn();
        }}
      >
        <Icon name="plus" size={20} />
        Add expense
      </button>
      {days.length === 0 ? (
        <div className="empty">
          <SplitMark />
          <h2 className="empty-title">No expenses yet</h2>
          <p className="empty-text">
            Add the first one and Halvsies keeps a running balance for everyone
            in this chat.
          </p>
        </div>
      ) : (
        <>
          <div className="summary">
            <div>
              <span className="summary-label">Group spend</span>
              <span className="money summary-value">
                {formatMoney(totalCents, currency)}
              </span>
            </div>
            {myTotalCents !== undefined && (
              <div>
                <span className="summary-label">Your share</span>
                <span className="money summary-value">
                  {formatMoney(myTotalCents, currency)}
                </span>
              </div>
            )}
          </div>
          {days.map((day) => (
            <Fragment key={day.date}>
              <h2 className="section-label day-heading">
                <span>{dayHeading(day.date)}</span>
                <span className="money">
                  {formatMoney(
                    day.items.reduce((sum, e) => sum + e.amountCents, 0),
                    currency,
                  )}
                </span>
              </h2>
              <div className="list">{day.items.map(card)}</div>
            </Fragment>
          ))}
        </>
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
