// The members sub-screen: who is in this split, add someone who doesn't use
// the app, rename anyone, and remove a member the ledger doesn't reference.
//
// Removal is deliberately conservative — see removalBlockedBy() in state/doc:
// dropping a member who still appears in an expense would leave the balances
// not summing to zero against any peer that still has them.
import { useState } from "preact/hooks";
import {
  addVirtualMember,
  listExpenses,
  listMembers,
  listSettlements,
  now,
  removalBlockedBy,
  removeMember,
  renameMember,
} from "../state/doc";
import type { MemberId } from "../state/model";
import { useDocValue, useSelfId } from "./useDoc";
import { Sheet } from "./components/Sheet";
import { Avatar } from "./components/Avatar";

export interface MembersSheetProps {
  open: boolean;
  onClose: () => void;
}

/** Tap-safe button — taps ride pointerup in this WebView (see Row.tsx). */
function TapButton({
  onActivate,
  className,
  disabled,
  title,
  children,
}: {
  onActivate: () => void;
  className: string;
  disabled?: boolean;
  title?: string;
  children: preact.ComponentChildren;
}) {
  return (
    <button
      type="button"
      className={className}
      disabled={disabled}
      title={title}
      onPointerUp={() => {
        if (!disabled) onActivate();
      }}
      onClick={(e) => {
        if (e.detail === 0 && !disabled) onActivate();
      }}
    >
      {children}
    </button>
  );
}

export function MembersSheet({ open, onClose }: MembersSheetProps) {
  const members = useDocValue(listMembers);
  const expenses = useDocValue(listExpenses);
  const settlements = useDocValue(listSettlements);
  const selfId = useSelfId();
  const [newName, setNewName] = useState("");
  // Two-tap delete rather than window.confirm(): several webxdc hosts ship a
  // WebView with no JS-dialog handler, where confirm() returns false instantly.
  const [confirming, setConfirming] = useState<MemberId | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);

  function add(): void {
    if (!newName.trim()) return;
    addVirtualMember(newName, now());
    setNewName("");
  }

  function remove(id: MemberId): void {
    if (confirming !== id) {
      setConfirming(id);
      return;
    }
    // removeMember re-checks and returns a reason: a peer may have added an
    // expense naming this member since the button rendered.
    setError(removeMember(id) ?? undefined);
    setConfirming(null);
  }

  return (
    <Sheet open={open} onClose={onClose} title="Members">
      <ul className="method-list">
        {members.map((m) => {
          const blocked = removalBlockedBy(m.id, expenses, settlements);
          return (
            <li key={m.id} className="method-row">
              <span className="method-main">
                <span className="field-row">
                  <Avatar member={m} size={24} />
                  <input
                    type="text"
                    aria-label={`Name of ${m.name}`}
                    defaultValue={m.name}
                    onBlur={(e) =>
                      renameMember(
                        m.id,
                        (e.currentTarget as HTMLInputElement).value,
                      )
                    }
                  />
                </span>
                <span className="field-suffix">
                  {m.id === selfId
                    ? "You"
                    : m.isVirtual
                      ? "Doesn't use this app"
                      : "In this chat"}
                  {blocked ? ` · ${blocked}` : ""}
                </span>
              </span>
              <TapButton
                className={
                  confirming === m.id ? "btn btn-danger" : "btn btn-secondary"
                }
                disabled={blocked !== null}
                title={blocked ?? undefined}
                onActivate={() => remove(m.id)}
              >
                {confirming === m.id ? "Really remove?" : "Remove"}
              </TapButton>
            </li>
          );
        })}
      </ul>

      {error && (
        <p role="alert" className="money-negative">
          Not removed — {error}.
        </p>
      )}

      <p className="field-suffix">
        A member can only be removed while no expense or payment mentions them.
        Someone who is in this chat comes back on their own the next time they
        open Halvsies.
      </p>

      <label className="field">
        <span className="field-label">
          Add someone who doesn't use this app
        </span>
        <span className="field-row">
          <input
            type="text"
            placeholder="Grandma"
            value={newName}
            onInput={(e) =>
              setNewName((e.currentTarget as HTMLInputElement).value)
            }
          />
          <TapButton className="btn btn-secondary" onActivate={add}>
            Add
          </TapButton>
        </span>
      </label>
      <p className="field-suffix">
        They can be a payer and take a share like anyone else — you just settle
        up with them in person.
      </p>
    </Sheet>
  );
}
