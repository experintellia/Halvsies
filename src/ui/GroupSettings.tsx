// Everything about the *group* rather than about you: the currency all money
// is denominated in, the group's name, who is in the split, and backup/restore.
// It used to sit on top of the Me tab, mixed in with your own payment details —
// which is the one thing on that screen nobody else can edit.
//
// Two screens over the same two settings live here: the sub-page you reach from
// the Me tab, and the first-run screen that asks for them before the app is
// usable at all.
import { useState } from "preact/hooks";
import {
  canSendToChat,
  getProfile,
  getSettings,
  importOwnProfile,
  importSnapshot,
  listMembers,
  sendOwnProfileToChat,
  sendSnapshotToChat,
  setSettings,
} from "../state/doc";
import { isCurrencyCode, type Settings } from "../state/model";
import { epcReference } from "../pay/epcqr";
import { useDocValue } from "./useDoc";
import { MembersSheet } from "./MembersSheet";
import { SubPage } from "./components/SubPage";
import { TapButton } from "./components/TapButton";

/**
 * `importFiles` is a newer webxdc API level, like sendToChat: feature-detect
 * rather than promise the user a restore path the host cannot provide.
 */
const canImportFiles =
  typeof window !== "undefined" &&
  typeof window.webxdc?.importFiles === "function";

function selfAddr(): string | undefined {
  return typeof window === "undefined" ? undefined : window.webxdc?.selfAddr;
}

function textValue(e: Event): string {
  return (e.currentTarget as HTMLInputElement).value;
}

/** Help text under the name field; also the bank-transfer reference preview. */
function NameHint({ title }: { title?: string }) {
  return (
    <span className="field-suffix">
      Shown in the chat as this app's name, and used as the reference on bank
      transfers ("{epcReference(title)}"). Worth setting if the chat runs more
      than one split, or so the payment shows up recognisably on people's
      statements.
    </span>
  );
}

// --- first run ---------------------------------------------------------------

/**
 * Has anybody configured this group yet? Pure, so both the app and the test
 * can ask without a doc.
 *
 * The test is `title === undefined`, i.e. the settings key was never written.
 * It has to be the title rather than the currency because getSettings() hands
 * back DEFAULT_CURRENCY for an unset groupCurrency, so "nobody chose" and
 * "somebody chose EUR" are indistinguishable — whereas `title` is reported
 * raw, and the setup screen below always writes it, as "" when it is skipped.
 *
 * A late joiner cannot trip this: once anyone finished setup the empty string
 * is in the doc, and it reaches every peer with the rest of the state. The
 * member/expense clauses are the backstop for a group created before this
 * screen existed (title genuinely never written) — a running ledger, or a
 * second member, means the group is under way and nobody is asked again.
 *
 * The one window is the moment before a joining peer's doc has replayed: it is
 * empty, so this says "unconfigured" for a frame or two until the updates land
 * and the screen unmounts itself. Nothing durable happens in that window unless
 * a human beats the replay to the Start button, and settings are per-key
 * last-write-wins anyway.
 */
export function needsSetup(
  settings: Settings,
  memberCount: number,
  expenseCount: number,
): boolean {
  if (settings.title !== undefined) return false;
  return memberCount <= 1 && expenseCount === 0;
}

/** The one-screen form shown until needsSetup() goes false. */
export function FirstRunSetup({ open }: { open: boolean }) {
  const settings = useDocValue(getSettings);
  const [currency, setCurrency] = useState(settings.groupCurrency);
  const [title, setTitle] = useState("");
  const valid = isCurrencyCode(currency);

  return (
    <SubPage open={open} title="Set up this split">
      <p>
        Two things before you start. Both can be changed later under Group
        settings on the Me tab.
      </p>

      <label className="field">
        <span className="field-label">Group currency (3-letter code)</span>
        <input
          type="text"
          maxLength={3}
          value={currency}
          onInput={(e) => setCurrency(textValue(e).trim())}
        />
        <span className="field-suffix">
          Every expense and every balance in this chat is in this currency —
          Halvsies never converts, so pick the one you will actually pay in.
        </span>
      </label>

      <label className="field">
        <span className="field-label">Name (optional)</span>
        <input
          type="text"
          placeholder="Halvsies"
          value={title}
          onInput={(e) => setTitle(textValue(e))}
        />
        <NameHint title={title.trim()} />
      </label>

      <TapButton
        className="btn btn-primary"
        disabled={!valid}
        onActivate={() => {
          if (!valid) return;
          // One write, both keys: `title` is what marks this group configured,
          // so it must land in the same transaction as the currency.
          setSettings({ groupCurrency: currency, title: title.trim() });
        }}
      >
        {title.trim() ? "Start splitting" : "Start without a name"}
      </TapButton>
      {!valid && (
        <p className="field-suffix">
          A currency code is three letters, e.g. EUR, GBP, USD, INR.
        </p>
      )}
    </SubPage>
  );
}

// --- the sub-page ------------------------------------------------------------

export interface GroupSettingsProps {
  open: boolean;
  onClose: () => void;
}

export function GroupSettings({ open, onClose }: GroupSettingsProps) {
  const self = selfAddr();
  const settings = useDocValue(getSettings);
  const memberCount = useDocValue(listMembers).length;
  const profile = useDocValue(() => (self ? getProfile(self) : undefined));
  const [showMembers, setShowMembers] = useState(false);
  const [importError, setImportError] = useState<string | undefined>(undefined);

  // Nothing configured means an empty file — offer the button only once it
  // would carry something.
  const hasOwnDetails = Object.values(profile ?? {}).some(
    (v) => v !== undefined && (!Array.isArray(v) || v.length > 0),
  );

  function handleImport(): void {
    setImportError(undefined);
    window.webxdc
      ?.importFiles({ extensions: [".json"], mimeTypes: ["application/json"] })
      .then(async (files) => {
        const file = files[0];
        if (!file) return; // user cancelled
        const text = await file.text();
        // One picker, two exports: a payment-details file has a top-level
        // "profile" key, a full backup never does — so the shape decides,
        // not the file name (which the user may have renamed).
        let raw: unknown = undefined;
        try {
          raw = JSON.parse(text);
        } catch {
          throw new Error("Import failed: the file is not valid JSON");
        }
        // Both parsers throw a human-readable Error on anything malformed;
        // surface it rather than leaving the user staring at an inert button.
        if (typeof raw === "object" && raw !== null && "profile" in raw) {
          importOwnProfile(text);
        } else {
          importSnapshot(text);
        }
      })
      .catch((e: unknown) => {
        setImportError(e instanceof Error ? e.message : "Import failed");
      });
  }

  return (
    <SubPage open={open} title="Group settings" onBack={onClose}>
      <label className="field">
        <span className="field-label">Group currency (3-letter code)</span>
        <input
          type="text"
          maxLength={3}
          defaultValue={settings.groupCurrency}
          onBlur={(e) => setSettings({ groupCurrency: textValue(e).trim() })}
        />
      </label>
      <label className="field">
        <span className="field-label">Name (optional)</span>
        <input
          type="text"
          placeholder="Halvsies"
          defaultValue={settings.title ?? ""}
          onBlur={(e) => setSettings({ title: textValue(e).trim() })}
        />
        <NameHint title={settings.title} />
      </label>

      <TapButton
        className="btn btn-secondary"
        onActivate={() => setShowMembers(true)}
      >
        Members ({memberCount})
      </TapButton>
      <p className="field-suffix">
        Add someone who doesn't use this app, rename anyone, or remove a member
        no expense mentions.
      </p>

      <MembersSheet open={showMembers} onClose={() => setShowMembers(false)} />

      <h2>Backup</h2>
      {canSendToChat && (
        <>
          <TapButton
            className="btn btn-secondary"
            onActivate={sendSnapshotToChat}
          >
            Export everything
          </TapButton>
          <p className="field-suffix">
            The whole ledger and everyone's payment details — sent to this chat
            as one file, to restore this group later.
          </p>

          {hasOwnDetails && (
            <>
              <TapButton
                className="btn btn-secondary"
                onActivate={sendOwnProfileToChat}
              >
                Export just your payment details
              </TapButton>
              <p className="field-suffix">
                Only your own payment links, nobody else's data. Send it to
                yourself so that when you join another Halvsies group you can
                import it there instead of typing your details in again.
              </p>
            </>
          )}
        </>
      )}
      {canImportFiles && (
        <TapButton className="btn btn-secondary" onActivate={handleImport}>
          Restore from file
        </TapButton>
      )}
      {importError && (
        <p role="alert" className="money-negative">
          {importError}
        </p>
      )}
      <p className="field-suffix">
        {canImportFiles
          ? "Either file works here. Restoring everything is destructive: it replaces this group's ledger with the contents of the backup. Restoring only your payment details just fills in your own links and changes nothing else."
          : "This messenger cannot open files from inside the app, so a backup can only be restored on a device that can."}
      </p>
    </SubPage>
  );
}
