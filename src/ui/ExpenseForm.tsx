// The add/edit expense sheet — amount-first, the highest-traffic screen.
// Every amount here is integer cents; the only float-adjacent code is
// Amount.tsx's own text parser, which this file never touches directly.
import type { ComponentChildren, JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import {
  addExpense,
  deleteExpense,
  getSettings,
  listMembers,
  now,
  updateExpense,
} from "../state/doc";
import { splitShares, validateSplit } from "../state/balances";
import {
  formatMoney,
  newId,
  type Expense,
  type MemberId,
  type Split,
  type SplitMode,
} from "../state/model";
import { useDocValue, useSelfId } from "./useDoc";
import { Sheet } from "./components/Sheet";
import { Amount } from "./components/Amount";
import { Avatar } from "./components/Avatar";
import { Row } from "./components/Row";

export interface ExpenseFormProps {
  open: boolean;
  onClose: () => void;
  /** undefined = creating a new expense. */
  expense?: Expense;
}

/** Local date (not UTC) as "YYYY-MM-DD", from a ms timestamp passed in. */
function todayISO(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** A toggle button implementing the WebView tap rule (blur-before-click). */
function TapButton(props: {
  active: boolean;
  onActivate: () => void;
  children: ComponentChildren;
  style?: JSX.CSSProperties;
  ariaLabel?: string;
}) {
  const { active, onActivate, children, style, ariaLabel } = props;
  return (
    <button
      type="button"
      className={"btn " + (active ? "btn-primary" : "btn-secondary")}
      aria-pressed={active}
      aria-label={ariaLabel}
      style={style}
      onPointerUp={onActivate}
      onClick={(e) => {
        if (e.detail === 0) onActivate();
      }}
    >
      {children}
    </button>
  );
}

const MODE_LABEL: Record<SplitMode, string> = {
  even: "Even",
  weights: "Weights",
  exact: "Exact",
};

export function ExpenseForm({ open, onClose, expense }: ExpenseFormProps) {
  const members = useDocValue(listMembers);
  const currency = useDocValue(getSettings).groupCurrency;
  const selfId = useSelfId();

  // listMembers() returns a fresh array every render; the init effect below
  // must not re-run just because the doc changed elsewhere while the sheet
  // is open (that would wipe in-progress edits), so it reads members through
  // a ref instead of depending on the array itself.
  const membersRef = useRef(members);
  membersRef.current = members;

  const [amountCents, setAmountCents] = useState(0);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [title, setTitle] = useState("");
  const [payerId, setPayerId] = useState<MemberId>("");
  const [date, setDate] = useState("");
  const [participants, setParticipants] = useState<MemberId[]>([]);
  const [mode, setMode] = useState<SplitMode>("even");
  const [weights, setWeights] = useState<Record<MemberId, number>>({});
  const [exact, setExact] = useState<Record<MemberId, number>>({});

  useEffect(() => {
    if (!open) return;
    const allIds = membersRef.current.map((m) => m.id);
    setAmountCents(expense?.amountCents ?? 0);
    setTitle(expense?.title ?? "");
    setPayerId(expense?.payerId ?? selfId ?? allIds[0] ?? "");
    setDate(expense?.date ?? todayISO(now()));
    setParticipants(expense ? Object.keys(expense.split.entries) : allIds);
    setMode(expense?.split.mode ?? "even");
    setWeights(expense?.split.mode === "weights" ? expense.split.entries : {});
    setExact(expense?.split.mode === "exact" ? expense.split.entries : {});
    setConfirmingDelete(false); // never reopen already armed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, expense?.id, selfId]);

  function buildSplit(): Split {
    const entries: Record<MemberId, number> = {};
    for (const id of participants) {
      entries[id] =
        mode === "weights"
          ? (weights[id] ?? 1)
          : mode === "exact"
            ? (exact[id] ?? 0)
            : 0;
    }
    return { mode, entries };
  }

  const draft: Expense = {
    id: expense?.id ?? "",
    title,
    amountCents,
    payerId,
    split: buildSplit(),
    date,
    category: expense?.category,
    createdBy: expense?.createdBy ?? selfId ?? payerId,
    editedAt: expense?.editedAt ?? 0,
  };
  const error = validateSplit(draft);
  const memberIds = members.map((m) => m.id);
  const shares = splitShares(draft, memberIds);
  const exactAssigned = participants.reduce((s, id) => s + (exact[id] ?? 0), 0);
  const exactDiff = amountCents - exactAssigned;

  function toggleParticipant(id: MemberId): void {
    setParticipants((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function switchMode(next: SplitMode): void {
    if (
      next === "exact" &&
      Object.keys(exact).length === 0 &&
      participants.length > 0
    ) {
      const evenDraft: Expense = {
        ...draft,
        split: {
          mode: "even",
          entries: Object.fromEntries(participants.map((id) => [id, 0])),
        },
      };
      setExact(splitShares(evenDraft, participants));
    }
    if (
      next === "weights" &&
      Object.keys(weights).length === 0 &&
      participants.length > 0
    ) {
      setWeights(Object.fromEntries(participants.map((id) => [id, 1])));
    }
    setMode(next);
  }

  function handleSave(): void {
    if (error) return;
    const ts = now();
    const split = buildSplit();
    if (expense) {
      updateExpense(
        expense.id,
        { title: title.trim(), amountCents, payerId, split, date },
        ts,
      );
    } else {
      addExpense({
        id: newId(ts),
        title: title.trim(),
        amountCents,
        payerId,
        split,
        date,
        createdBy: selfId ?? payerId,
        editedAt: ts,
      });
    }
    onClose();
  }

  // Two-tap confirmation rather than window.confirm(): several webxdc hosts
  // ship a WebView with no JS-dialog handler, where confirm() returns false
  // instantly and Delete would silently do nothing.
  function handleDelete(): void {
    if (!expense) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    deleteExpense(expense.id);
    onClose();
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={expense ? "Edit expense" : "Add expense"}
    >
      <Amount
        label="Amount"
        valueCents={amountCents}
        onChange={setAmountCents}
        currency={currency}
        autoFocus
      />

      <label className="field">
        <span className="field-label">Title</span>
        <input
          type="text"
          value={title}
          placeholder="e.g. Dinner"
          onInput={(e) => setTitle((e.currentTarget as HTMLInputElement).value)}
        />
      </label>

      <div className="field">
        <span className="field-label">Paid by</span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {members.map((m) => (
            <TapButton
              key={m.id}
              active={payerId === m.id}
              onActivate={() => setPayerId(m.id)}
              ariaLabel={`Paid by ${m.name}`}
            >
              <Avatar member={m} size={18} /> {m.name}
            </TapButton>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field-label">Split</span>
        <div style={{ display: "flex", gap: 8 }}>
          {(["even", "weights", "exact"] as SplitMode[]).map((m) => (
            <TapButton
              key={m}
              active={mode === m}
              onActivate={() => switchMode(m)}
              style={{ flex: 1 }}
            >
              {MODE_LABEL[m]}
            </TapButton>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field-label">
          Split between{" "}
          <span className="field-suffix">
            ({participants.length} of {members.length})
          </span>
        </span>
        {members.map((m) => {
          const selected = participants.includes(m.id);
          const share = shares[m.id] ?? 0;
          return (
            <div key={m.id} style={{ marginBottom: 8 }}>
              {/* In "even" mode every share is identical, so the amount alone
                  can't say who is in — hence an explicit checkbox and a
                  selected-row outline, not colour or emphasis alone. */}
              <Row
                role="checkbox"
                aria-checked={selected}
                className={selected ? "row-check selected" : "row-check"}
                onActivate={() => toggleParticipant(m.id)}
              >
                <span className="check-box" aria-hidden="true">
                  {selected ? "✓" : ""}
                </span>
                <Avatar member={m} />
                <span style={{ flex: 1 }}>{m.name}</span>
                <span className="money">
                  {selected ? formatMoney(share, currency) : "not included"}
                </span>
              </Row>
              {selected && mode === "weights" && (
                <div style={{ marginLeft: 44, marginTop: 4 }}>
                  <label className="field" style={{ marginBottom: 0 }}>
                    <span className="field-label">Weight</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      inputMode="numeric"
                      value={weights[m.id] ?? 1}
                      onInput={(e) =>
                        setWeights({
                          ...weights,
                          [m.id]:
                            Number(
                              (e.currentTarget as HTMLInputElement).value,
                            ) || 0,
                        })
                      }
                    />
                  </label>
                </div>
              )}
              {selected && mode === "exact" && (
                <div style={{ marginLeft: 44, marginTop: 4 }}>
                  <Amount
                    label="Amount"
                    valueCents={exact[m.id] ?? 0}
                    currency={currency}
                    onChange={(cents) => setExact({ ...exact, [m.id]: cents })}
                  />
                </div>
              )}
            </div>
          );
        })}
        {mode === "exact" && (
          <p className="field-suffix">
            {exactDiff > 0
              ? `${formatMoney(exactDiff, currency)} left to assign`
              : exactDiff < 0
                ? `${formatMoney(-exactDiff, currency)} over`
                : "All assigned"}
          </p>
        )}
      </div>

      <label className="field">
        <span className="field-label">Date</span>
        <input
          type="date"
          value={date}
          onInput={(e) => setDate((e.currentTarget as HTMLInputElement).value)}
        />
      </label>

      {error && (
        <p role="alert" className="money-negative">
          {error}
        </p>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        {expense && (
          <button
            type="button"
            className="btn btn-danger"
            onPointerUp={handleDelete}
            onClick={(e) => {
              if (e.detail === 0) handleDelete();
            }}
          >
            {confirmingDelete ? "Really delete?" : "Delete"}
          </button>
        )}
        <button
          type="button"
          className="btn btn-primary"
          style={{ flex: 1 }}
          disabled={!!error}
          onPointerUp={handleSave}
          onClick={(e) => {
            if (e.detail === 0) handleSave();
          }}
        >
          Save
        </button>
      </div>
    </Sheet>
  );
}
