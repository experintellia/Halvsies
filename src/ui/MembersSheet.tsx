// The members sub-screen: who is in this split, add someone who doesn't use
// the app, and rename/remove those manually-added members.
//
// Only virtual members are editable here. Someone who is really in the chat
// gets their name from Delta Chat and stays in the split — the writers in
// state/doc refuse either edit for them, this screen just doesn't offer it.
//
// Removal is deliberately conservative on top of that — see removalBlockedBy()
// in state/doc: dropping a member who still appears in an expense would leave
// the balances not summing to zero against any peer that still has them.
import { useId, useState } from "preact/hooks";
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
import { TapButton } from "./components/TapButton";
import { announce } from "./announce";

export interface MembersSheetProps {
  open: boolean;
  onClose: () => void;
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
  const addId = useId();

  function add(): void {
    if (!newName.trim()) return;
    addVirtualMember(newName, now());
    announce(`${newName.trim()} added`);
    setNewName("");
  }

  function remove(id: MemberId, name: string): void {
    if (confirming !== id) {
      setConfirming(id);
      announce(`Really remove ${name}? Press again to remove.`);
      return;
    }
    // removeMember re-checks and returns a reason: a peer may have added an
    // expense naming this member since the button rendered.
    const reason = removeMember(id);
    if (!reason) announce(`${name} removed`);
    setError(reason ? `Not removed — ${reason}.` : undefined);
    setConfirming(null);
  }

  /** Same deal: the writer has the last word, so report what it says. */
  function rename(id: MemberId, input: HTMLInputElement, was: string): void {
    const reason = renameMember(id, input.value);
    if (reason) input.value = was; // don't leave a rejected value on screen
    setError(reason ? `Not renamed — ${reason}.` : undefined);
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Members"
      dirty={newName.trim() !== ""}
    >
      <ul className="method-list">
        {members.map((m) => {
          const blocked = m.isVirtual
            ? removalBlockedBy(m.id, expenses, settlements)
            : null;
          return (
            <li key={m.id} className="method-row">
              <span className="method-main">
                <span className="field-row">
                  <Avatar member={m} size={24} />
                  {m.isVirtual ? (
                    <input
                      type="text"
                      aria-label={`Name of ${m.name}`}
                      defaultValue={m.name}
                      onBlur={(e) =>
                        rename(
                          m.id,
                          e.currentTarget as HTMLInputElement,
                          m.name,
                        )
                      }
                    />
                  ) : (
                    <span>{m.name}</span>
                  )}
                </span>
                <span className="field-suffix">
                  {m.id === selfId
                    ? "You"
                    : m.isVirtual
                      ? "Doesn't use this app"
                      : "In this chat"}
                  {blocked ? ` · ${blocked}` : ""}
                </span>
                {!m.isVirtual && (
                  <span className="field-suffix">
                    Name comes from Delta Chat
                  </span>
                )}
              </span>
              {m.isVirtual && (
                <TapButton
                  className={
                    confirming === m.id ? "btn btn-danger" : "btn btn-secondary"
                  }
                  disabled={blocked !== null}
                  title={blocked ?? undefined}
                  ariaLabel={`${confirming === m.id ? "Really remove" : "Remove"} ${m.name}`}
                  onActivate={() => remove(m.id, m.name)}
                >
                  {confirming === m.id ? "Really remove?" : "Remove"}
                </TapButton>
              )}
            </li>
          );
        })}
      </ul>

      {error && (
        <p role="alert" className="money-negative">
          {error}
        </p>
      )}

      <p className="field-suffix">
        Everyone who is in this chat is in the split, under the name Delta Chat
        knows them by — they change that in Delta Chat, not here. Someone you
        added by hand can be renamed, and removed while no expense or payment
        mentions them.
      </p>

      {/* A div, not a <label>: a label around the Add button made the field's
          name "Add someone who doesn't use this app Add". Enter adds too. */}
      <div className="field">
        <span className="field-label" id={addId}>
          Add someone who doesn't use this app
        </span>
        <span className="field-row">
          <input
            type="text"
            aria-labelledby={addId}
            autoCapitalize="words"
            placeholder="Grandma"
            value={newName}
            onInput={(e) =>
              setNewName((e.currentTarget as HTMLInputElement).value)
            }
            onKeyDown={(e) => {
              if (e.key === "Enter") add();
            }}
          />
          <TapButton className="btn btn-secondary" onActivate={add}>
            Add
          </TapButton>
        </span>
      </div>
      <p className="field-suffix">
        They can be a payer and take a share like anyone else — you just settle
        up with them in person.
      </p>
    </Sheet>
  );
}
