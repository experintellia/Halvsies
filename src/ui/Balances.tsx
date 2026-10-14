// Balances tab. It leads with your job: a hero with what you owe (or are
// owed) and the one button that settles it. Below it, everyone's net position
// as a diverging bar list (static on purpose, so it never reads as a button),
// then the transfers between other members. Tapping any transfer opens
// PayUpSheet — pay mode when the debt runs from you, request mode otherwise
// (see PayUpSheet.tsx for how that also covers a transfer between two others).
import { useState } from "preact/hooks";
import {
  getSettings,
  listExpenses,
  listMembers,
  listSettlements,
} from "../state/doc";
import { useDocValue } from "./useDoc";
import { netBalances } from "../state/balances";
import { simplifyDebts } from "../state/simplify";
import { formatMoney, type Member, type Transfer } from "../state/model";
import { Avatar } from "./components/Avatar";
import { Icon } from "./components/Icon";
import { Row } from "./components/Row";
import { SplitMark } from "./components/SplitMark";
import { TapButton } from "./components/TapButton";
import { PayUpSheet } from "./PayUpSheet";
import { ProfileForm } from "./ProfileForm";
import { SubPage } from "./components/SubPage";

function selfAddr(): string | undefined {
  return typeof window === "undefined" ? undefined : window.webxdc?.selfAddr;
}

interface Selection {
  transfer: Transfer;
  direction: "pay" | "request";
}

export function Balances() {
  const settings = useDocValue(getSettings);
  const members = useDocValue(listMembers);
  const expenses = useDocValue(listExpenses);
  const settlements = useDocValue(listSettlements);
  const [selected, setSelected] = useState<Selection | null>(null);
  // Editing the payment details of a creditor who doesn't use the app, from
  // their pay sheet; Back returns to that same sheet, details now filled in.
  const [editing, setEditing] = useState<Selection | null>(null);

  const self = selfAddr();
  const currency = settings.groupCurrency;
  const money = (cents: number) => formatMoney(cents, currency);
  const memberIds = members.map((m) => m.id);
  const balances = netBalances(expenses, settlements, memberIds);
  const transfers = simplifyDebts(balances);
  const mine = transfers.filter((t) => t.fromId === self || t.toId === self);
  const others = transfers.filter((t) => t.fromId !== self && t.toId !== self);
  const myCents = self ? (balances[self] ?? 0) : 0;

  const memberOf = (id: string): Member =>
    members.find((m) => m.id === id) ?? { id, name: id, isVirtual: false };
  const nameOf = (id: string): string =>
    id === self ? "You" : memberOf(id).name;
  const otherOf = (t: Transfer): string =>
    t.fromId === self ? t.toId : t.fromId;
  const openTransfer = (t: Transfer) =>
    setSelected({
      transfer: t,
      direction: t.fromId === self ? "pay" : "request",
    });

  // A selection is a snapshot; the ledger moves under it. Someone else may
  // record the payment while this sheet — or Ben's details page — is open,
  // and reopening a settled debt would let it be recorded twice. So the sheet
  // shows the debt as it stands now, and closes once it no longer exists.
  const live =
    selected &&
    transfers.find(
      (t) =>
        t.fromId === selected.transfer.fromId &&
        t.toId === selected.transfer.toId,
    );
  // Their details page only while they're still someone added by hand: not
  // once they've claimed themselves (then they're not in the roster) or
  // joined, when the details are theirs to edit.
  const editingId = editing?.transfer.toId;
  const editingOpen =
    editingId !== undefined &&
    members.some((m) => m.id === editingId && m.isVirtual);

  const sheet = (
    <>
      <PayUpSheet
        transfer={live ?? { fromId: "", toId: "", amountCents: 0 }}
        direction={selected?.direction ?? "pay"}
        open={!!live}
        onClose={() => setSelected(null)}
        onEditPayee={() => {
          setEditing(selected);
          setSelected(null);
        }}
      />
      <SubPage
        open={editingOpen}
        title={`${editingId ? memberOf(editingId).name : ""}'s payment details`}
        onBack={() => {
          setSelected(editing);
          setEditing(null);
        }}
      >
        {editingOpen && <ProfileForm memberId={editingId} />}
      </SubPage>
    </>
  );

  if (transfers.length === 0) {
    return (
      <div className="empty">
        <SplitMark />
        <h2 className="empty-title">
          {expenses.length === 0 ? "Nothing to settle" : "All square"}
        </h2>
        <p className="empty-text">
          {expenses.length === 0
            ? "Add an expense and who owes whom shows up here."
            : "Nobody owes anybody."}
        </p>
        {sheet}
      </div>
    );
  }

  const owing = myCents < 0;
  const one = mine.length === 1 ? mine[0] : undefined;
  const heroLabel = one
    ? owing
      ? `You owe ${nameOf(one.toId)}`
      : `${nameOf(one.fromId)} owes you`
    : owing
      ? "You owe"
      : myCents > 0
        ? "You're owed"
        : "You're all square";
  const heroSub =
    mine.length === 0
      ? `The others still have ${others.length === 1 ? "1 payment" : `${others.length} payments`} to make.`
      : one
        ? owing
          ? "One payment settles you up"
          : "You're settled once they pay"
        : `${mine.length} payments settle you up`;

  // Bars share one scale: the biggest position in the group fills its half.
  const scale = Math.max(
    1,
    ...memberIds.map((id) => Math.abs(balances[id] ?? 0)),
  );
  // Creditors first, then by id, so every peer lists the group the same way.
  const byPosition = [...members].sort(
    (a, b) =>
      (balances[b.id] ?? 0) - (balances[a.id] ?? 0) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  return (
    <section aria-label="Balances">
      <section className="hero">
        {/* Square while others aren't: a 42px €0.00 would be the loudest
            thing on screen, so the words take the headline instead. */}
        {mine.length > 0 ? (
          <>
            {/* The heading is the sentence the screen is about. */}
            <h2 className="hero-label">{heroLabel}</h2>
            <p
              className={
                "hero-amount money" +
                (money(Math.abs(myCents)).length > 12 ? " long" : "")
              }
            >
              {money(Math.abs(myCents))}
            </p>
          </>
        ) : (
          <h2 className="hero-title">{heroLabel}</h2>
        )}
        <p className="hero-sub">{heroSub}</p>
        {one && (
          <TapButton
            className="btn btn-primary"
            onActivate={() => openTransfer(one)}
          >
            <span className="btn-label">
              {owing
                ? `Pay ${nameOf(one.toId)}`
                : `Ask ${nameOf(one.fromId)} to pay`}
            </span>
            <Icon name="arrow-right" size={18} />
          </TapButton>
        )}
        {mine.length > 1 && (
          <div className="list">
            {mine.map((t) => (
              <Row
                key={`${t.fromId}-${t.toId}`}
                onActivate={() => openTransfer(t)}
              >
                <Avatar member={memberOf(otherOf(t))} />
                <span className="row-text">
                  {t.fromId === self
                    ? `Pay ${nameOf(t.toId)}`
                    : `${nameOf(t.fromId)} owes you`}
                </span>
                <span className="money row-amount">{money(t.amountCents)}</span>
                <span className="chevron">
                  <Icon name="chevron-right" size={18} />
                </span>
              </Row>
            ))}
          </div>
        )}
      </section>

      <h2 className="section-label">Everyone</h2>
      <div className="list" role="list">
        {byPosition.map((m) => {
          const cents = balances[m.id] ?? 0;
          const width = `${(Math.abs(cents) / scale) * 50}%`;
          return (
            <div className="row row-static" role="listitem" key={m.id}>
              <Avatar member={m} />
              <span className="row-text position-name">
                {m.id === self ? "You" : m.name}
              </span>
              <span className="position-bar" aria-hidden="true">
                {cents !== 0 && (
                  <span
                    className={cents > 0 ? "credit" : "debt"}
                    style={{ width }}
                  />
                )}
              </span>
              <span
                className={
                  "money position-amount" +
                  (cents > 0
                    ? " money-positive"
                    : cents < 0
                      ? " money-negative"
                      : "")
                }
              >
                {cents > 0 ? "+" : ""}
                {money(cents)}
              </span>
            </div>
          );
        })}
      </div>

      {others.length > 0 && (
        <>
          <h2 className="section-label">Between others</h2>
          <div className="list">
            {others.map((t) => (
              <Row
                key={`${t.fromId}-${t.toId}`}
                onActivate={() => openTransfer(t)}
                aria-label={`${nameOf(t.fromId)} owes ${nameOf(t.toId)} ${money(t.amountCents)}`}
              >
                <Avatar member={memberOf(t.fromId)} />
                <span className="row-text">
                  {nameOf(t.fromId)} <span className="arrow">→</span>{" "}
                  {nameOf(t.toId)}
                </span>
                <span className="money row-amount">{money(t.amountCents)}</span>
                <span className="chevron">
                  <Icon name="chevron-right" size={18} />
                </span>
              </Row>
            ))}
          </div>
        </>
      )}

      <p className="fine">
        {transfers.length === 1
          ? "1 payment settles the whole group."
          : `${transfers.length} payments settle the whole group.`}
      </p>

      {sheet}
    </section>
  );
}
