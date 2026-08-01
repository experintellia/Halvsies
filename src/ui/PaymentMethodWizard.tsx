// "Add a payment method" wizard. Two steps: pick a provider, then enter the
// one thing it needs — with the app telling you where to find it, and a live
// test link at the end so you can prove the handle works before anyone tries
// to pay you.
//
// It writes nothing itself: it hands a finished PaymentProfile patch back to
// ProfileForm, which owns persistence.
import { useState } from "preact/hooks";
import type { CustomPaymentMethod, PaymentProfile } from "../state/model";
import { newId } from "../state/model";
import { now } from "../state/doc";
import {
  PROVIDERS,
  providerFor,
  type HandleField,
  type ProviderSpec,
} from "../pay/providers";
import {
  customLink,
  paymentMethodsFor,
  validateCustomTemplate,
} from "../pay/links";
import {
  formatIban,
  isValidBic,
  isValidIban,
  normalizeIban,
} from "../pay/iban";
import { Sheet } from "./components/Sheet";
import { CopyButton } from "./components/CopyButton";

/** What the wizard is currently editing. `null` = still on the picker step. */
export type WizardTarget =
  | { kind: "provider"; field: HandleField }
  | { kind: "bank" }
  | { kind: "custom"; id?: string };

export interface PaymentMethodWizardProps {
  open: boolean;
  onClose: () => void;
  profile: PaymentProfile;
  onSave: (patch: PaymentProfile) => void;
  /** Set to jump straight to editing an existing method (skips the picker). */
  editing?: WizardTarget;
  /** Sample debt used for the test link. */
  previewCents: number;
  currency: string;
  reference: string;
}

function textValue(e: Event): string {
  return (e.currentTarget as HTMLInputElement | HTMLTextAreaElement).value;
}

/** Tap-safe button — see Row.tsx for why taps ride pointerup in this WebView. */
function TapButton({
  onActivate,
  className,
  disabled,
  children,
}: {
  onActivate: () => void;
  className: string;
  disabled?: boolean;
  children: preact.ComponentChildren;
}) {
  return (
    <button
      type="button"
      className={className}
      disabled={disabled}
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

export function PaymentMethodWizard({
  open,
  onClose,
  profile,
  onSave,
  editing,
  previewCents,
  currency,
  reference,
}: PaymentMethodWizardProps) {
  const [target, setTarget] = useState<WizardTarget | null>(editing ?? null);
  const [value, setValue] = useState("");
  const [holder, setHolder] = useState("");
  const [bic, setBic] = useState("");
  const [label, setLabel] = useState("");

  // Re-seed whenever the sheet is (re)opened, so a previous run's half-typed
  // handle never leaks into the next one. Sheet stays mounted while closed.
  const key = `${open}|${editing ? JSON.stringify(editing) : ""}`;
  const [lastKey, setLastKey] = useState(key);
  if (lastKey !== key) {
    setLastKey(key);
    setTarget(editing ?? null);
    const t = editing;
    setValue(
      t?.kind === "provider"
        ? (profile[t.field] ?? "")
        : t?.kind === "bank"
          ? profile.iban
            ? formatIban(profile.iban)
            : ""
          : t?.kind === "custom"
            ? (profile.customs?.find((c) => c.id === t.id)?.urlTemplate ?? "")
            : "",
    );
    setHolder(profile.accountHolder ?? "");
    setBic(profile.bic ?? "");
    setLabel(
      t?.kind === "custom"
        ? (profile.customs?.find((c) => c.id === t.id)?.label ?? "")
        : "",
    );
  }

  const spec: ProviderSpec | null =
    target?.kind === "provider" ? providerFor(target.field) : null;

  // --- validation, per shape -----------------------------------------------
  let error: string | null = null;
  if (target?.kind === "provider" && value.trim()) {
    error = spec!.validate(value);
  } else if (target?.kind === "bank" && value.trim()) {
    error = isValidIban(value) ? null : "That doesn't look like a valid IBAN.";
    if (!error && bic.trim() && !isValidBic(bic))
      error = "That doesn't look like a valid BIC.";
    if (!error && !holder.trim())
      error = "Banks need the account holder's name.";
  } else if (target?.kind === "custom" && value.trim()) {
    error = validateCustomTemplate(value.trim());
    if (!error && !label.trim()) error = "Give the link a name.";
  }
  const filled = value.trim() !== "";
  const valid = filled && error === null;

  // --- the test link (the "end" of the wizard) ------------------------------
  // Built from the same generators the real pay-up sheet uses, so a link that
  // works here is a link that works there.
  let testUrl: string | null = null;
  if (valid && target) {
    if (target.kind === "provider") {
      const probe: PaymentProfile = { [spec!.field]: value.trim() };
      testUrl =
        paymentMethodsFor(probe, previewCents, currency, reference)[0]?.url ??
        null;
    } else if (target.kind === "custom") {
      testUrl =
        customLink(
          { id: "preview", label: label.trim(), urlTemplate: value.trim() },
          previewCents,
          currency,
          reference,
        )?.url ?? null;
    }
  }

  function save(): void {
    if (!valid || !target) return;
    if (target.kind === "provider") {
      onSave({ ...profile, [target.field]: value.trim() });
    } else if (target.kind === "bank") {
      onSave({
        ...profile,
        iban: normalizeIban(value),
        accountHolder: holder.trim() || undefined,
        bic: bic.trim() ? normalizeIban(bic) : undefined,
      });
    } else {
      const entry: CustomPaymentMethod = {
        id: target.id ?? newId(now()),
        label: label.trim(),
        urlTemplate: value.trim(),
      };
      const rest = (profile.customs ?? []).filter((c) => c.id !== entry.id);
      onSave({ ...profile, customs: [...rest, entry] });
    }
    onClose();
  }

  const title =
    target === null
      ? "Add a payment method"
      : target.kind === "provider"
        ? spec!.label
        : target.kind === "bank"
          ? "Bank transfer"
          : target.id
            ? "Edit link"
            : "Custom link";

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {target === null ? (
        <>
          <p className="field-suffix">
            Pick how you'd like to be paid back. You can add more later.
          </p>
          {PROVIDERS.map((p) => (
            <TapButton
              key={p.field}
              className="wizard-option"
              onActivate={() => setTarget({ kind: "provider", field: p.field })}
            >
              <strong>{p.label}</strong>
              <span className="field-suffix">{p.blurb}</span>
            </TapButton>
          ))}
          <TapButton
            className="wizard-option"
            onActivate={() => setTarget({ kind: "bank" })}
          >
            <strong>Bank transfer</strong>
            <span className="field-suffix">
              IBAN + a scannable QR code for EUR debts.
            </span>
          </TapButton>
          <TapButton
            className="wizard-option"
            onActivate={() => setTarget({ kind: "custom" })}
          >
            <strong>Custom link</strong>
            <span className="field-suffix">
              Anything else — Twint, MobilePay, PayNow…
            </span>
          </TapButton>
        </>
      ) : (
        <>
          {/* Step 2: where to find it, then the field itself. */}
          <p>
            {target.kind === "provider"
              ? spec!.whereToFind
              : target.kind === "bank"
                ? "Your IBAN is on your bank statement or in your banking app under account details. The account holder name must match the account, or some banks reject the transfer."
                : "Paste a payment URL and mark where the amount goes. Use {amount}, {currency} and {ref} as placeholders — we substitute them for each debt."}
          </p>

          {target.kind === "custom" && (
            <label className="field">
              <span className="field-label">Name</span>
              <input
                type="text"
                placeholder="Twint"
                value={label}
                onInput={(e) => setLabel(textValue(e))}
              />
            </label>
          )}

          <label className="field">
            <span className="field-label">
              {target.kind === "provider"
                ? `${spec!.label} handle`
                : target.kind === "bank"
                  ? "IBAN"
                  : "Link template"}
            </span>
            <input
              type="text"
              autoFocus
              placeholder={
                target.kind === "provider"
                  ? spec!.placeholder
                  : target.kind === "bank"
                    ? "DE89 3704 0044 0532 0130 00"
                    : "https://pay.example/{amount}/{currency}/{ref}"
              }
              value={value}
              onInput={(e) => setValue(textValue(e))}
            />
            {target.kind === "provider" && (
              <span className="field-suffix">{spec!.example}</span>
            )}
          </label>

          {target.kind === "bank" && (
            <>
              <label className="field">
                <span className="field-label">Account holder name</span>
                <input
                  type="text"
                  value={holder}
                  onInput={(e) => setHolder(textValue(e))}
                />
              </label>
              <label className="field">
                <span className="field-label">BIC (optional)</span>
                <input
                  type="text"
                  value={bic}
                  onInput={(e) => setBic(textValue(e))}
                />
              </label>
            </>
          )}

          {filled && error && (
            <p role="alert" className="money-negative">
              {error}
            </p>
          )}

          {target.kind === "provider" && spec!.caveat && (
            <p className="field-suffix">{spec!.caveat}</p>
          )}

          {/* The end of the wizard: prove it works before saving. */}
          {valid && testUrl && (
            <div className="wizard-test">
              <p>
                <strong>Try it.</strong> This is exactly what someone paying you{" "}
                {(previewCents / 100).toFixed(2)} {currency} would open:
              </p>
              <div className="field-row">
                <a
                  className="btn btn-secondary"
                  href={testUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open test link
                </a>
                <CopyButton value={testUrl} label="Copy" />
              </div>
              <p className="field-suffix">{testUrl}</p>
            </div>
          )}
          {valid && !testUrl && target.kind === "bank" && (
            <p className="field-suffix">
              Saved IBANs are shown with a scannable QR code on EUR debts.
            </p>
          )}

          <div className="field-row">
            <TapButton
              className="btn btn-primary"
              disabled={!valid}
              onActivate={save}
            >
              Save
            </TapButton>
            {!editing && (
              <TapButton
                className="btn btn-secondary"
                onActivate={() => setTarget(null)}
              >
                Back
              </TapButton>
            )}
          </div>
        </>
      )}
    </Sheet>
  );
}
