// The "Me" tab: your payment methods (added one at a time via a wizard, so the
// screen stays short), a free-text note that is always visible, group settings,
// a virtual-member add, and JSON backup.
import { useId, useState } from "preact/hooks";
import {
  addVirtualMember,
  canSendToChat,
  getProfile,
  getSettings,
  importSnapshot,
  now,
  sendSnapshotToChat,
  setProfile,
  setSettings,
} from "../state/doc";
import { useDocValue } from "./useDoc";
import type { PaymentProfile } from "../state/model";
import { formatIban } from "../pay/iban";
import { paymentMethodsFor } from "../pay/links";
import { configuredProviders } from "../pay/providers";
import { buildEpcPayload, epcReference, validateEpcParams } from "../pay/epcqr";
import { QR } from "./components/QR";
import { CopyButton } from "./components/CopyButton";
import { PaymentMethodWizard, type WizardTarget } from "./PaymentMethodWizard";

function selfAddr(): string | undefined {
  return typeof window === "undefined" ? undefined : window.webxdc?.selfAddr;
}

/** Fixed sample amount for the "what others see" preview — not a real debt. */
const PREVIEW_CENTS = 1000;

/**
 * `importFiles` is a newer webxdc API level, like sendToChat: feature-detect
 * rather than promise the user a restore path the host cannot provide.
 */
const canImportFiles =
  typeof window !== "undefined" &&
  typeof window.webxdc?.importFiles === "function";

function textValue(e: Event): string {
  return (e.currentTarget as HTMLInputElement | HTMLTextAreaElement).value;
}

/** Tap-safe button — taps ride pointerup in this WebView (see Row.tsx). */
function TapButton({
  onActivate,
  className,
  children,
}: {
  onActivate: () => void;
  className: string;
  children: preact.ComponentChildren;
}) {
  return (
    <button
      type="button"
      className={className}
      onPointerUp={onActivate}
      onClick={(e) => {
        if (e.detail === 0) onActivate();
      }}
    >
      {children}
    </button>
  );
}

export function ProfileForm() {
  const self = selfAddr();
  const settings = useDocValue(getSettings);
  const profile = useDocValue(() => (self ? getProfile(self) : undefined));
  // Lazily seeded once: this component unmounts/remounts with the tab, so a
  // fresh visit always starts from the current doc state without needing a
  // continuous sync effect that could clobber an in-progress edit.
  const [note, setNote] = useState(profile?.note ?? "");
  const [virtualName, setVirtualName] = useState("");
  const [importError, setImportError] = useState<string | undefined>(undefined);
  const [wizard, setWizard] = useState<WizardTarget | "new" | null>(null);
  const virtualNameId = useId();

  const current: PaymentProfile = profile ?? {};

  function save(next: PaymentProfile): void {
    if (!self) return;
    setProfile(self, next);
  }

  function handleImport(): void {
    setImportError(undefined);
    window.webxdc
      ?.importFiles({ extensions: [".json"], mimeTypes: ["application/json"] })
      .then(async (files) => {
        const file = files[0];
        if (!file) return; // user cancelled
        // parseSnapshot throws a human-readable Error on anything malformed;
        // surface it rather than leaving the user staring at an inert button.
        importSnapshot(await file.text());
      })
      .catch((e: unknown) => {
        setImportError(e instanceof Error ? e.message : "Import failed");
      });
  }

  // What is actually configured, in the order the pay-up sheet shows it.
  const providers = configuredProviders(current);
  const customs = current.customs ?? [];
  const hasBank = !!current.iban;
  const methodCount = providers.length + customs.length + (hasBank ? 1 : 0);

  const previewReference = epcReference(settings.title);
  const previewMethods = paymentMethodsFor(
    current,
    PREVIEW_CENTS,
    settings.groupCurrency,
    previewReference,
  );
  const previewEpc = validateEpcParams({
    name: current.accountHolder || "You",
    iban: current.iban || "",
    amountCents: PREVIEW_CENTS,
    currency: settings.groupCurrency,
    reference: previewReference,
    bic: current.bic,
  });

  return (
    <div>
      <p>
        <strong>Everyone in this chat can see your payment profile.</strong>
      </p>

      <h2>Group</h2>
      <label className="field">
        <span className="field-label">Group title</span>
        <input
          type="text"
          defaultValue={settings.title ?? ""}
          onBlur={(e) => setSettings({ title: textValue(e).trim() })}
        />
      </label>
      <label className="field">
        <span className="field-label">Group currency (3-letter code)</span>
        <input
          type="text"
          maxLength={3}
          defaultValue={settings.groupCurrency}
          onBlur={(e) => setSettings({ groupCurrency: textValue(e).trim() })}
        />
      </label>
      <div className="field">
        <label className="field-label" htmlFor={virtualNameId}>
          Add a member who doesn't use this app
        </label>
        <span className="field-row">
          <input
            id={virtualNameId}
            type="text"
            placeholder="Grandma"
            value={virtualName}
            onInput={(e) => setVirtualName(textValue(e))}
          />
          <button
            type="button"
            className="btn btn-secondary"
            onPointerUp={() => {
              if (!virtualName.trim()) return;
              addVirtualMember(virtualName, now());
              setVirtualName("");
            }}
            onClick={(e) => {
              if (e.detail === 0 && virtualName.trim()) {
                addVirtualMember(virtualName, now());
                setVirtualName("");
              }
            }}
          >
            Add
          </button>
        </span>
      </div>

      <h2>Your payment details</h2>
      {methodCount === 0 ? (
        <p className="placeholder">
          No payment methods yet. Add one so people can pay you back in a couple
          of taps instead of asking for your details.
        </p>
      ) : (
        <ul className="method-list">
          {providers.map((spec) => (
            <li key={spec.field} className="method-row">
              <span className="method-main">
                <strong>{spec.label}</strong>
                <span className="field-suffix">{current[spec.field]}</span>
              </span>
              <span className="field-row">
                <TapButton
                  className="btn btn-secondary"
                  onActivate={() =>
                    setWizard({ kind: "provider", field: spec.field })
                  }
                >
                  Edit
                </TapButton>
                <TapButton
                  className="btn btn-danger"
                  onActivate={() =>
                    save({ ...current, [spec.field]: undefined })
                  }
                >
                  Remove
                </TapButton>
              </span>
            </li>
          ))}

          {hasBank && (
            <li className="method-row">
              <span className="method-main">
                <strong>Bank transfer</strong>
                <span className="field-suffix">
                  {formatIban(current.iban!)}
                  {current.accountHolder ? ` · ${current.accountHolder}` : ""}
                </span>
              </span>
              <span className="field-row">
                <TapButton
                  className="btn btn-secondary"
                  onActivate={() => setWizard({ kind: "bank" })}
                >
                  Edit
                </TapButton>
                <TapButton
                  className="btn btn-danger"
                  onActivate={() =>
                    save({
                      ...current,
                      iban: undefined,
                      accountHolder: undefined,
                      bic: undefined,
                    })
                  }
                >
                  Remove
                </TapButton>
              </span>
            </li>
          )}

          {customs.map((c) => (
            <li key={c.id} className="method-row">
              <span className="method-main">
                <strong>{c.label}</strong>
                <span className="field-suffix">{c.urlTemplate}</span>
              </span>
              <span className="field-row">
                <TapButton
                  className="btn btn-secondary"
                  onActivate={() => setWizard({ kind: "custom", id: c.id })}
                >
                  Edit
                </TapButton>
                <TapButton
                  className="btn btn-danger"
                  onActivate={() =>
                    save({
                      ...current,
                      customs: customs.filter((x) => x.id !== c.id),
                    })
                  }
                >
                  Remove
                </TapButton>
              </span>
            </li>
          ))}
        </ul>
      )}

      <TapButton
        className="btn btn-primary"
        onActivate={() => setWizard("new")}
      >
        + Add payment method
      </TapButton>

      {/* Always visible, whether or not any method is configured: this is
          where "bank transfer only after the 1st" or "round it up" lives. */}
      <label className="field">
        <span className="field-label">
          Note — anything people should know about paying you
        </span>
        <textarea
          value={note}
          placeholder="e.g. IBAN please, PayPal charges me a fee"
          onInput={(e) => setNote(textValue(e))}
          onBlur={() => save({ ...current, note: note.trim() || undefined })}
        />
      </label>

      <PaymentMethodWizard
        open={wizard !== null}
        onClose={() => setWizard(null)}
        profile={current}
        onSave={save}
        editing={wizard && wizard !== "new" ? wizard : undefined}
        previewCents={PREVIEW_CENTS}
        currency={settings.groupCurrency}
        reference={previewReference}
      />

      <h2>What others see</h2>
      <p className="field-suffix">
        Preview for a sample {PREVIEW_CENTS / 100}.00 {settings.groupCurrency}{" "}
        debt.
      </p>
      {previewMethods.length === 0 && !!previewEpc && (
        <p className="placeholder">
          Nothing yet — fill in at least one method above.
        </p>
      )}
      {previewMethods.map((m) => (
        <div className="field-row" key={m.id}>
          <p>
            <strong>{m.label}:</strong> {m.url}
          </p>
          <CopyButton value={m.url} label="Copy" />
        </div>
      ))}
      {!previewEpc && hasBank && (
        <div className="row" style={{ display: "block" }}>
          <p>
            <strong>Bank transfer QR</strong>
          </p>
          <QR
            payload={buildEpcPayload({
              name: current.accountHolder || "You",
              iban: current.iban || "",
              amountCents: PREVIEW_CENTS,
              currency: settings.groupCurrency,
              reference: previewReference,
              bic: current.bic,
            })}
          />
        </div>
      )}

      <h2>Backup</h2>
      <div className="field-row">
        {canSendToChat && (
          <button
            type="button"
            className="btn btn-secondary"
            onPointerUp={sendSnapshotToChat}
            onClick={(e) => {
              if (e.detail === 0) sendSnapshotToChat();
            }}
          >
            Send backup to chat
          </button>
        )}
        {canImportFiles && (
          <button
            type="button"
            className="btn btn-secondary"
            onPointerUp={handleImport}
            onClick={(e) => {
              if (e.detail === 0) handleImport();
            }}
          >
            Restore from file
          </button>
        )}
      </div>
      {importError && (
        <p role="alert" className="money-negative">
          {importError}
        </p>
      )}
      <p className="field-suffix">
        {canImportFiles
          ? "Restoring replaces this group's ledger with the contents of the backup file."
          : "This messenger cannot open files from inside the app, so a backup can only be restored on a device that can."}
      </p>
    </div>
  );
}
