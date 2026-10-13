// The add/edit expense page — amount-first, the highest-traffic screen.
// Every amount here is integer cents; the only float-adjacent code is
// Amount.tsx's own text parser, which this file never touches directly.
import type { ComponentChildren, JSX } from "preact";
import { useId, useLayoutEffect, useRef, useState } from "preact/hooks";
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
import { announce } from "./announce";
import { useDocValue, useSelfId } from "./useDoc";
import { SubPage } from "./components/SubPage";
import { Amount } from "./components/Amount";
import { Avatar } from "./components/Avatar";
import { Row } from "./components/Row";
import { Icon } from "./components/Icon";
import { TapButton } from "./components/TapButton";

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

/** A toggle chip implementing the WebView tap rule (blur-before-click). */
function ChipButton(props: {
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

/**
 * The label is "Shares"; the stored `SplitMode` is still "weights". That string
 * is durable CRDT state synced to peers — renaming it would orphan every
 * existing expense and break any peer on an older build. Label only.
 */
const MODE_LABEL: Record<SplitMode, string> = {
  even: "Even",
  weights: "Shares",
  exact: "Exact",
};

/**
 * Upper bound for the share stepper. Real values are 1–4 ("she's covering two
 * people"); 20 is a generous ceiling that still stops a stuck finger from
 * walking someone to 900 shares. Only the + button clamps — an expense that
 * already carries a bigger weight (typed into the old number input) keeps it.
 * ponytail: if nights-stayed style splits ever show up, raise it rather than
 * bringing back a numeric keyboard.
 */
const MAX_SHARES = 20;

/**
 * Display-only percentage of the bill a weight represents. The money itself is
 * splitShares()' business and is never re-derived from this — hence the two
 * guards: a member who pays *something* must never read "0%", and one who does
 * not take the whole bill must never read "100%".
 */
function sharePercent(weight: number, total: number): string {
  if (total <= 0) return "";
  const rounded = Math.round((weight * 100) / total);
  if (rounded === 0 && weight > 0) return "<1%";
  if (rounded === 100 && weight < total) return ">99%";
  return `${rounded}%`;
}

/** −/+ around a value. Buttons, so keyboard activation falls out for free. */
function Stepper(props: {
  value: number;
  onChange: (next: number) => void;
  /** Whose shares: names the group and both buttons. */
  name: string;
}) {
  const { value, onChange, name } = props;
  return (
    <span className="stepper" role="group" aria-label={`Shares for ${name}`}>
      <TapButton
        className="btn btn-secondary stepper-btn"
        ariaLabel={`Fewer shares for ${name}`}
        disabled={value <= 0}
        onActivate={() => onChange(value - 1)}
      >
        −
      </TapButton>
      <span className="stepper-value">{value}</span>
      <TapButton
        className="btn btn-secondary stepper-btn"
        ariaLabel={`More shares for ${name}`}
        disabled={value >= MAX_SHARES}
        onActivate={() => onChange(value + 1)}
      >
        +
      </TapButton>
    </span>
  );
}

export function ExpenseForm({ open, onClose, expense }: ExpenseFormProps) {
  const members = useDocValue(listMembers);
  const currency = useDocValue(getSettings).groupCurrency;
  const selfId = useSelfId();

  // listMembers() returns a fresh array every render; the init effect below
  // must not re-run just because the doc changed elsewhere while the page
  // is open (that would wipe in-progress edits), so it reads members through
  // a ref instead of depending on the array itself.
  const membersRef = useRef(members);
  membersRef.current = members;

  const [amountCents, setAmountCents] = useState(0);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [tried, setTried] = useState(false);
  const [title, setTitle] = useState("");
  const [payerId, setPayerId] = useState<MemberId>("");
  const [date, setDate] = useState("");
  const [participants, setParticipants] = useState<MemberId[]>([]);
  const [mode, setMode] = useState<SplitMode>("even");
  const [weights, setWeights] = useState<Record<MemberId, number>>({});
  const [exact, setExact] = useState<Record<MemberId, number>>({});
  const statusId = useId();
  const betweenId = useId();

  // A layout effect, not a passive one: it runs before the page paints. A
  // passive effect could land up to ~100ms later on a busy device, briefly
  // showing the previous expense's values on reopen and resetting anything
  // tapped or typed in that window (a split mode, an armed Delete, an amount).
  useLayoutEffect(() => {
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
    setTried(false);
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
  // What the status line says. A fresh form has no amount yet, and greeting
  // it (and a screen reader) with "Amount must be more than zero" before
  // anything was typed is noise — Save is simply not ready.
  // Until Save is pressed, that is: then it says what's missing.
  const shownError = amountCents > 0 || tried ? error : null;
  const memberIds = members.map((m) => m.id);
  const shares = splitShares(draft, memberIds);
  const exactAssigned = participants.reduce((s, id) => s + (exact[id] ?? 0), 0);
  const exactDiff = amountCents - exactAssigned;
  // The denominator behind every percentage below — same `?? 1` default that
  // buildSplit() writes, so what is shown is what gets saved.
  const totalShares = participants.reduce((s, id) => s + (weights[id] ?? 1), 0);

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
    if (error) {
      // Save is never truly disabled (see the button): pressing it while
      // the form can't be saved says why. A line that is already on screen
      // gets read out; one that isn't yet appears, and its status announces.
      if (shownError) announce(error);
      else setTried(true);
      return;
    }
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
    announce(expense ? "Expense saved" : "Expense added");
  }

  // Two-tap confirmation rather than window.confirm(): several webxdc hosts
  // ship a WebView with no JS-dialog handler, where confirm() returns false
  // instantly and Delete would silently do nothing.
  function handleDelete(): void {
    if (!expense) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      // The focused button renames itself, which screen readers don't re-read.
      announce("Really delete? Press again to delete.");
      return;
    }
    deleteExpense(expense.id);
    onClose();
    announce("Expense deleted");
  }

  return (
    <SubPage
      open={open}
      onBack={onClose}
      title={expense ? "Edit expense" : "Add expense"}
    >
      <Amount
        label="Amount"
        valueCents={amountCents}
        onChange={setAmountCents}
        currency={currency}
        autoFocus
        describedBy={shownError?.startsWith("Amount") ? statusId : undefined}
        invalid={shownError?.startsWith("Amount")}
      />

      <label className="field">
        <span className="field-label">Title</span>
        <input
          type="text"
          value={title}
          placeholder="e.g. Dinner"
          onInput={(e) => setTitle((e.currentTarget as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.isComposing) return;
            // See the wizard: an uncancelled Enter also clicks whatever focus
            // returns to once the form has closed.
            e.preventDefault();
            handleSave(); // no-op while invalid
          }}
        />
      </label>

      <div className="field">
        <span className="field-label">Paid by</span>
        <div className="field-row" role="group" aria-label="Paid by">
          {members.map((m) => (
            <ChipButton
              key={m.id}
              active={payerId === m.id}
              onActivate={() => setPayerId(m.id)}
              ariaLabel={`Paid by ${m.name}`}
            >
              <Avatar member={m} size={18} /> {m.name}
            </ChipButton>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field-label">Split</span>
        <div className="field-row" role="group" aria-label="Split">
          {(["even", "weights", "exact"] as SplitMode[]).map((m) => (
            <ChipButton
              key={m}
              active={mode === m}
              onActivate={() => switchMode(m)}
              style={{ flex: 1 }}
            >
              {MODE_LABEL[m]}
            </ChipButton>
          ))}
        </div>
        {mode === "weights" && (
          <p className="field-suffix">
            Give someone 2 shares if they're covering two people.
          </p>
        )}
      </div>

      <div className="field" role="group" aria-labelledby={betweenId}>
        <span className="field-label" id={betweenId}>
          Split between{" "}
          <span className="field-suffix">
            ({participants.length} of {members.length})
          </span>
        </span>
        {members.map((m) => {
          const selected = participants.includes(m.id);
          const share = shares[m.id] ?? 0;
          const weight = weights[m.id] ?? 1;
          // A selected member on 0 shares is still in the split but pays
          // nothing: it has to read differently from an included one, or the
          // row looks identical to someone who is actually chipping in.
          const zeroShare = selected && mode === "weights" && weight === 0;
          return (
            <div key={m.id} className="split-member">
              {/* In "even" mode every share is identical, so the amount alone
                  can't say who is in — hence an explicit checkbox and a
                  selected-row outline, not colour or emphasis alone. */}
              <Row
                role="checkbox"
                aria-checked={selected}
                className={
                  (selected ? "row-check selected" : "row-check") +
                  (zeroShare ? " row-zero" : "")
                }
                onActivate={() => toggleParticipant(m.id)}
              >
                <span className="check-box" aria-hidden="true">
                  {selected && <Icon name="check" size={14} strokeWidth={3} />}
                </span>
                <Avatar member={m} />
                <span className="row-text">{m.name}</span>
                <span className="money row-amount">
                  {selected ? formatMoney(share, currency) : "not included"}
                </span>
              </Row>
              {selected && mode === "weights" && (
                <div className="share-controls">
                  <Stepper
                    value={weight}
                    name={m.name}
                    onChange={(next) => {
                      setWeights({ ...weights, [m.id]: next });
                      // Only the one that changed, by name — making every
                      // member's line live read out two lines per tap.
                      announce(
                        `${m.name}: ${next} ${next === 1 ? "share" : "shares"}, ${sharePercent(next, totalShares - weight + next)}`,
                      );
                    }}
                  />
                  {/* Shares, then the percentage they add up to, then the
                      percentage. The money is deliberately NOT repeated here:
                      the row above already shows it, right-aligned with every
                      other member's, which is what makes the column scannable.
                      splitShares owns that figure; the percentage is only the
                      hint that makes the share count mean something. */}
                  <span className="field-suffix">
                    {weight === 0
                      ? totalShares > 0
                        ? "0 shares — pays nothing"
                        : "0 shares"
                      : `${weight} ${weight === 1 ? "share" : "shares"} · ${sharePercent(
                          weight,
                          totalShares,
                        )}`}
                  </span>
                </div>
              )}
              {selected && mode === "exact" && (
                <div style={{ marginLeft: 44, marginTop: 4 }}>
                  <Amount
                    label="Amount"
                    ariaLabel={`Amount for ${m.name}`}
                    valueCents={exact[m.id] ?? 0}
                    currency={currency}
                    onChange={(cents) => setExact({ ...exact, [m.id]: cents })}
                  />
                </div>
              )}
            </div>
          );
        })}
        {mode === "weights" && (
          <p className="field-suffix">
            {totalShares === 1
              ? "1 share in total"
              : `${totalShares} shares in total`}
          </p>
        )}
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

      <p id={statusId} role="status" className="money-negative form-status">
        {shownError}
      </p>

      <div className="field-row" style={{ marginTop: 8 }}>
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
          // aria-disabled, not disabled: a disabled button drops out of the
          // Tab order, and a keyboard or screen-reader user looking for Save
          // never learns it exists, let alone what it is waiting for.
          aria-disabled={error ? "true" : undefined}
          aria-describedby={shownError ? statusId : undefined}
          onPointerUp={handleSave}
          onClick={(e) => {
            if (e.detail === 0) handleSave();
          }}
        >
          Save
        </button>
      </div>
    </SubPage>
  );
}
