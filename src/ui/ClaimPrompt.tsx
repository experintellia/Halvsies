// Claiming a member as yourself: the "That's me" → confirm controls (shared
// with the members screen) and the one-time "Were you in this group before?"
// prompt shown after a ledger was imported from another app instance.
//
// Addresses are per app instance, so nobody from an imported ledger can be
// recognised automatically. The name only sorts the list — it never decides:
// names aren't unique, and a claim moves money.
import { useEffect, useState } from "preact/hooks";
import {
  claimMember,
  getProfile,
  keepClaimedProfile,
  listExpenses,
  listMembers,
  listSettlements,
  markClaimAsked,
  removalBlockedBy,
} from "../state/doc";
import {
  hasPaymentDetails,
  type Expense,
  type Member,
  type MemberId,
  type PaymentProfile,
  type Settlement,
} from "../state/model";
import { formatIban } from "../pay/iban";
import { configuredProviders } from "../pay/providers";
import { useDocValue, useSelfId } from "./useDoc";
import { Sheet } from "./components/Sheet";
import { Avatar } from "./components/Avatar";
import { TapButton } from "./components/TapButton";
import { announce } from "./announce";

/** Every payment detail in a profile, as label + value lines to show. */
function detailLines(p: PaymentProfile): Array<[string, string]> {
  const out: Array<[string, string]> = configuredProviders(p).map((s) => [
    s.label,
    p[s.field] ?? "",
  ]);
  if (p.iban) {
    const holder = p.accountHolder ? ` · ${p.accountHolder}` : "";
    out.push(["Bank transfer", formatIban(p.iban) + holder]);
  }
  if (p.crypto) out.push([p.crypto.label || "Crypto", p.crypto.address]);
  for (const c of p.customs ?? []) out.push([c.label, c.urlTemplate]);
  if (p.note) out.push(["Note", p.note]);
  return out;
}

/**
 * "Is this you?" and, if the member had payment details, "Are these your
 * payment details?". Its own Sheet, replacing the list it came from: the
 * irreversible part gets the whole sheet, and a separate Sheet remounts, so
 * focus moves into it (no window.confirm(): several webxdc WebViews have no
 * dialog handler). Takes a Member snapshot, not an id — after the merge the
 * member is gone from the roster but the second step still needs them.
 */
export function ClaimConfirm({
  member,
  onBack,
  onDone,
}: {
  member: Member;
  onBack: () => void;
  /** The flow's end: null when merged, else why not. */
  onDone: (reason: string | null) => void;
}) {
  const [merged, setMerged] = useState(false);
  const recorded = useDocValue(() =>
    removalBlockedBy(member.id, listExpenses(), listSettlements()),
  );
  const parked = useDocValue(() => getProfile(member.id));

  // `parked` can only vanish under us if another of your devices answered.
  const answeredElsewhere = merged && !parked;
  useEffect(() => {
    if (answeredElsewhere) onDone(null);
  }, [answeredElsewhere]);
  if (answeredElsewhere) return null;

  if (merged && parked) {
    // × or Escape counts as "no" (the safe answer); a stray swipe or backdrop
    // tap doesn't (`dirty`), since the details are likely yours.
    const answer = (keep: boolean): void => {
      keepClaimedProfile(member.id, keep);
      announce(keep ? "Payment details kept" : "Payment details discarded");
      onDone(null);
    };
    return (
      <Sheet
        open
        dirty
        onClose={() => answer(false)}
        title="Are these your payment details?"
      >
        <p>
          {member.name} had these saved. Keep them only if they are really yours
          — people will pay you there.
        </p>
        <ul className="method-list">
          {detailLines(parked).map(([label, value], i) => (
            <li key={i} className="method-row">
              <span className="method-main">
                <span className="method-name">{label}</span>
                <span className="method-detail">{value}</span>
              </span>
            </li>
          ))}
        </ul>
        <div className="sheet-actions">
          <TapButton
            className="btn btn-secondary"
            onActivate={() => answer(false)}
          >
            No, discard them
          </TapButton>
          <TapButton
            className="btn btn-primary"
            onActivate={() => answer(true)}
          >
            Yes, they're mine
          </TapButton>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet open onClose={onBack} title="Is this you?">
      <div className="claim-who">
        <Avatar member={member} size={56} />
        <strong>{member.name}</strong>
      </div>
      <p>
        {recorded
          ? `${member.name} ${recorded}. All of it becomes yours.`
          : `Nothing is recorded for ${member.name} yet.`}
      </p>
      <p className="claim-warning">
        {member.name} is merged into you and leaves the list. This can't be
        undone.
      </p>
      <div className="sheet-actions">
        <TapButton className="btn btn-secondary" onActivate={onBack}>
          Back
        </TapButton>
        <TapButton
          className="btn btn-danger"
          onActivate={() => {
            const reason = claimMember(member.id);
            if (!reason) announce(`${member.name} merged into you`);
            // Details stay parked only if you had none (see claimMember):
            // then there is one more question to ask.
            if (reason || !hasPaymentDetails(getProfile(member.id))) {
              onDone(reason);
            } else {
              setMerged(true);
            }
          }}
        >
          Yes, merge into me
        </TapButton>
      </div>
    </Sheet>
  );
}

const sameName = (a: string, b: string): boolean =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Who "Were you in this group before?" offers you — [] when it shouldn't ask
 * at all. Pure, so the rules are testable without a webxdc host. It asks only
 * while it can matter:
 *  - you haven't answered it before (Member.claimAsked, kept on your own
 *    entry: the one durable per-person place a webxdc app has);
 *  - you are new here: no expense or payment names you yet;
 *  - imported people nobody has merged are left. Hand-added members (no addr)
 *    never count — every new joiner would be asked about Grandma — but stay
 *    mergeable on the members screen.
 * Same-name matches come first, then the roster's id order; the name never
 * decides on its own.
 */
export function promptCandidates(
  selfId: MemberId | undefined,
  members: Member[],
  expenses: Expense[],
  settlements: Settlement[],
): Member[] {
  const me = members.find((m) => m.id === selfId);
  if (!me || me.claimAsked) return [];
  if (removalBlockedBy(me.id, expenses, settlements) !== null) return [];
  const c = members.filter((m) => m.isVirtual && m.addr && m.id !== me.id);
  return [
    ...c.filter((m) => sameName(m.name, me.name)),
    ...c.filter((m) => !sameName(m.name, me.name)),
  ];
}

/** `selfId` is for tests only; the app reads it from the host. */
export function ClaimPrompt(props: { selfId?: MemberId }) {
  const hostSelf = useSelfId();
  const selfId = props.selfId ?? hostSelf;
  const members = useDocValue(listMembers);
  const expenses = useDocValue(listExpenses);
  const settlements = useDocValue(listSettlements);
  const [dismissed, setDismissed] = useState(false);
  const [armed, setArmed] = useState<Member | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);

  // Before the visibility check: merging answers the prompt, but the confirm
  // flow may still have a step to show.
  if (armed) {
    return (
      <ClaimConfirm
        member={armed}
        onBack={() => setArmed(null)}
        onDone={(reason) => {
          // Success needs nothing here: claimMember also marks you as asked.
          setArmed(null);
          setError(reason ? `Not merged — ${reason}.` : undefined);
        }}
      />
    );
  }

  const sorted = promptCandidates(selfId, members, expenses, settlements);
  if (dismissed || sorted.length === 0) return null;
  const me = members.find((m) => m.id === selfId)!;

  return (
    <Sheet
      open
      onClose={() => setDismissed(true)}
      title="Were you in this group before?"
    >
      <p>
        These people came from an imported ledger. If one of them is you, merge
        them into you to keep your expenses and balance.
      </p>
      <ul className="method-list">
        {sorted.map((m) => (
          <li key={m.id} className="method-row member-row">
            <Avatar member={m} size={36} />
            <span className="method-main">
              {sameName(m.name, me.name) ? (
                <strong className="member-name">{m.name}</strong>
              ) : (
                <span className="member-name">{m.name}</span>
              )}
              {sameName(m.name, me.name) && (
                <span className="field-suffix">Same name as you</span>
              )}
            </span>
            <TapButton
              className="btn btn-secondary"
              onActivate={() => setArmed(m)}
            >
              That's me
            </TapButton>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="money-negative">
          {error}
        </p>
      )}
      <TapButton className="btn btn-secondary" onActivate={markClaimAsked}>
        No, I'm new here
      </TapButton>
    </Sheet>
  );
}
