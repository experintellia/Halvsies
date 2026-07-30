// Balances tab: net position per member, then the simplified "who pays
// whom" transfer list. Tapping a transfer opens PayUpSheet — pay mode when
// the debt runs from you, request mode otherwise (see PayUpSheet.tsx for how
// that also covers the rare transfer between two other members).
import { useState } from "preact/hooks";
import {
  describeChange,
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
import { Row } from "./components/Row";
import { PayUpSheet } from "./PayUpSheet";

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

  const self = selfAddr();
  const currency = settings.groupCurrency;
  const memberIds = members.map((m) => m.id);
  const balances = netBalances(expenses, settlements, memberIds);
  const transfers = simplifyDebts(balances);
  const totalCents = transfers.reduce((sum, t) => sum + t.amountCents, 0);

  const memberOf = (id: string): Member =>
    members.find((m) => m.id === id) ?? { id, name: id, isVirtual: false };
  const nameOf = (id: string): string =>
    id === self ? "You" : memberOf(id).name;

  const summary = describeChange("join", {
    actorName: "",
    currency,
    openDebts: transfers.length,
    openTotalCents: totalCents,
  }).summary;

  return (
    <div>
      <p>
        <strong>{summary}</strong>
      </p>

      <h2>Net position</h2>
      {members.map((m) => {
        const cents = balances[m.id] ?? 0;
        const cls =
          cents === 0
            ? "money"
            : cents > 0
              ? "money money-positive"
              : "money money-negative";
        const sign = cents > 0 ? "+" : "";
        return (
          <div className="row" key={m.id} style={{ cursor: "default" }}>
            <Avatar member={m} />
            <span>{m.id === self ? "You" : m.name}</span>
            <span className={cls} style={{ marginLeft: "auto" }}>
              {sign}
              {formatMoney(cents, currency)}
            </span>
          </div>
        );
      })}

      <h2>Suggested transfers</h2>
      {transfers.length === 0 && (
        <p className="placeholder">Everyone is settled up.</p>
      )}
      {transfers.map((t) => {
        const direction: "pay" | "request" =
          t.fromId === self ? "pay" : "request";
        const label =
          t.fromId === self
            ? `You owe ${nameOf(t.toId)} ${formatMoney(t.amountCents, currency)}`
            : t.toId === self
              ? `${nameOf(t.fromId)} owes you ${formatMoney(t.amountCents, currency)}`
              : `${nameOf(t.fromId)} owes ${nameOf(t.toId)} ${formatMoney(t.amountCents, currency)}`;
        const otherId = t.fromId === self ? t.toId : t.fromId;
        return (
          <Row
            key={`${t.fromId}-${t.toId}`}
            onActivate={() => setSelected({ transfer: t, direction })}
          >
            <Avatar member={memberOf(otherId)} />
            <span>{label}</span>
          </Row>
        );
      })}

      <PayUpSheet
        transfer={
          selected?.transfer ?? { fromId: "", toId: "", amountCents: 0 }
        }
        direction={selected?.direction ?? "pay"}
        open={selected !== null}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}
