// "Add a payment method" wizard. Two steps: pick a provider, then enter the
// one thing it needs — with the app telling you where to find it, and a live
// test link at the end so you can prove the handle works before anyone tries
// to pay you.
//
// Opened on a saved method, the same page is that method's edit view: the
// live preview, a "preferred" switch, and Remove as the last, quietest action
// (the Me tab itself carries no destructive buttons at all).
//
// It writes nothing itself: it hands a finished PaymentProfile patch back to
// ProfileForm, which owns persistence.
import { useId, useState } from "preact/hooks";
import type {
  CryptoPaymentMethod,
  CustomPaymentMethod,
  PaymentProfile,
} from "../state/model";
import { formatMoney, newId } from "../state/model";
import { now } from "../state/doc";
import {
  CRYPTO_NETWORKS,
  CRYPTO_STEP,
  PICKER_SECTIONS,
  currencyPill,
  providerFor,
  validateCrypto,
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
import { SubPage } from "./components/SubPage";
import { announce } from "./announce";
import { CopyButton } from "./components/CopyButton";
import { Icon } from "./components/Icon";

/** What the wizard is currently editing. `null` = still on the picker step. */
export type WizardTarget =
  | { kind: "provider"; field: HandleField }
  | { kind: "bank" }
  | { kind: "crypto" }
  | { kind: "custom"; id?: string };

type CryptoNetwork = NonNullable<CryptoPaymentMethod["network"]>;

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

/** The id `PaymentProfile.preferred` stores for this method; undefined for a
 *  custom link that has not been saved yet (it gets its id in save()). */
function methodIdOf(t: WizardTarget): string | undefined {
  if (t.kind === "provider") return providerFor(t.field).kind;
  if (t.kind === "custom") return t.id ? `custom:${t.id}` : undefined;
  return t.kind; // "bank" | "crypto"
}

/** `profile` with `id`'s preferred flag set to `on`, leaving any other
 *  method's flag alone. */
function withPreferred(
  profile: PaymentProfile,
  id: string,
  on: boolean,
): PaymentProfile {
  const preferred = on
    ? id
    : profile.preferred === id
      ? undefined
      : profile.preferred;
  return { ...profile, preferred };
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
  const [network, setNetwork] = useState<CryptoNetwork>("bitcoin");
  const [preferred, setPreferred] = useState(false);
  // Left a field below the main one: only then may its error show.
  const [restTouched, setRestTouched] = useState(false);

  // Re-seed whenever the page is (re)opened, so a previous run's half-typed
  // handle never leaks into the next one. This stays mounted while closed.
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
          : t?.kind === "crypto"
            ? (profile.crypto?.address ?? "")
            : t?.kind === "custom"
              ? (profile.customs?.find((c) => c.id === t.id)?.urlTemplate ?? "")
              : "",
    );
    setHolder(profile.accountHolder ?? "");
    setBic(profile.bic ?? "");
    setRestTouched(false);
    setLabel(
      t?.kind === "custom"
        ? (profile.customs?.find((c) => c.id === t.id)?.label ?? "")
        : t?.kind === "crypto"
          ? (profile.crypto?.label ?? "")
          : "",
    );
    setNetwork(profile.crypto?.network ?? "bitcoin");
    const id = t && methodIdOf(t);
    setPreferred(id !== undefined && profile.preferred === id);
  }

  const spec: ProviderSpec | null =
    target?.kind === "provider" ? providerFor(target.field) : null;

  const cryptoDraft: CryptoPaymentMethod = {
    label: label.trim(),
    address: value.trim(),
    network,
  };

  // The group currency may not be one this method can be offered in. That's a
  // warning, not a block — people set methods up before a currency change. The
  // picker table is the single source for the lists (links.ts for everything
  // with a PayMethodKind).
  const stepPill = (() => {
    if (!target) return null;
    const entry = PICKER_SECTIONS.flatMap((s) => s.entries).find(
      (e) =>
        e.target.kind === target.kind &&
        (e.target.kind !== "provider" ||
          (target.kind === "provider" && e.target.field === target.field)),
    );
    return entry ? currencyPill(entry.currencies, currency) : null;
  })();

  // --- validation, per shape -----------------------------------------------
  let error: string | null = null;
  // Whether the error is about the main field, which is then marked invalid —
  // not the holder or name fields further down.
  let valueBad = false;
  if (target?.kind === "provider" && value.trim()) {
    error = spec!.validate(value);
    valueBad = error !== null;
  } else if (target?.kind === "bank" && value.trim()) {
    error = isValidIban(value) ? null : "That doesn't look like a valid IBAN.";
    valueBad = error !== null;
    if (!error && bic.trim() && !isValidBic(bic))
      error = "That doesn't look like a valid BIC.";
    if (!error && !holder.trim())
      error = "Banks need the account holder's name.";
  } else if (target?.kind === "crypto" && value.trim()) {
    error = validateCrypto(cryptoDraft);
    valueBad = error !== null;
  } else if (target?.kind === "custom" && value.trim()) {
    error = validateCustomTemplate(value.trim());
    valueBad = error !== null;
    if (!error && !label.trim()) error = "Give the link a name.";
  }
  const filled = value.trim() !== "";
  const valid = filled && error === null;
  // An error about a field further down (holder, BIC, name) waits until that
  // part was touched: announcing "Banks need the account holder's name" the
  // moment the IBAN turns valid interrupts someone who hasn't got there yet.
  const shown = filled && (valueBad || restTouched) ? error : null;
  const rest = (on: boolean) => ({
    "aria-invalid": (on && !valueBad && shown !== null) || undefined,
    "aria-describedby": on && !valueBad && shown ? statusId : undefined,
    onBlur: () => setRestTouched(true),
  });
  const statusId = useId();
  const exampleId = useId();

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
    } else if (target.kind === "crypto") {
      // null for network "other": no URI scheme exists, so there is nothing to
      // test-open — the payer copies the address instead.
      testUrl =
        paymentMethodsFor(
          { crypto: cryptoDraft },
          previewCents,
          currency,
          reference,
        )[0]?.url ?? null;
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
      const stored = spec!.normalize ? spec!.normalize(value) : value.trim();
      onSave(
        withPreferred(
          { ...profile, [target.field]: stored },
          spec!.kind,
          preferred,
        ),
      );
    } else if (target.kind === "crypto") {
      onSave(
        withPreferred({ ...profile, crypto: cryptoDraft }, "crypto", preferred),
      );
    } else if (target.kind === "bank") {
      onSave(
        withPreferred(
          {
            ...profile,
            iban: normalizeIban(value),
            accountHolder: holder.trim() || undefined,
            bic: bic.trim() ? normalizeIban(bic) : undefined,
          },
          "bank",
          preferred,
        ),
      );
    } else {
      const entry: CustomPaymentMethod = {
        id: target.id ?? newId(now()),
        label: label.trim(),
        urlTemplate: value.trim(),
      };
      const rest = (profile.customs ?? []).filter((c) => c.id !== entry.id);
      onSave(
        withPreferred(
          { ...profile, customs: [...rest, entry] },
          `custom:${entry.id}`,
          preferred,
        ),
      );
    }
    onClose();
    announce("Payment method saved");
  }

  /** Only reachable from an edit view, so `target` is a saved method. */
  function remove(): void {
    if (!target) return;
    const id = methodIdOf(target);
    const next: PaymentProfile =
      target.kind === "provider"
        ? { ...profile, [target.field]: undefined }
        : target.kind === "bank"
          ? {
              ...profile,
              iban: undefined,
              accountHolder: undefined,
              bic: undefined,
            }
          : target.kind === "crypto"
            ? { ...profile, crypto: undefined }
            : {
                ...profile,
                customs: (profile.customs ?? []).filter(
                  (c) => c.id !== target.id,
                ),
              };
    onSave(id ? withPreferred(next, id, false) : next);
    onClose();
    announce("Payment method removed");
  }

  const removeLabel =
    target === null
      ? ""
      : target.kind === "provider"
        ? spec!.label
        : target.kind === "bank"
          ? "bank transfer"
          : target.kind === "crypto"
            ? profile.crypto?.label || "crypto address"
            : profile.customs?.find((c) => c.id === target.id)?.label || "link";

  const title =
    target === null
      ? "Add a payment method"
      : target.kind === "provider"
        ? spec!.label
        : target.kind === "bank"
          ? "Bank transfer"
          : target.kind === "crypto"
            ? CRYPTO_STEP.label
            : target.id
              ? "Edit link"
              : "Custom link";

  return (
    <SubPage
      open={open}
      // Back steps out of a method to the list first, like the button it
      // replaced; editing an existing method has no list to go back to.
      onBack={target !== null && !editing ? () => setTarget(null) : onClose}
      title={title}
    >
      {target === null ? (
        <>
          <p className="field-suffix">
            Pick how you'd like to be paid back. You can add more later.
          </p>
          {PICKER_SECTIONS.map((section) => (
            <div key={section.id}>
              <h2 className="picker-section">{section.title}</h2>
              <div className="wizard-options">
                {section.entries.map((entry) => {
                  const pill = currencyPill(entry.currencies, currency);
                  return (
                    <TapButton
                      key={entry.label}
                      className="wizard-option"
                      onActivate={() => {
                        setTarget(entry.target);
                        // Re-adding the method that is already preferred must
                        // not quietly drop the mark on save.
                        const id = methodIdOf(entry.target);
                        setPreferred(
                          id !== undefined && profile.preferred === id,
                        );
                      }}
                    >
                      <span className="wizard-option-title">
                        <strong>{entry.label}</strong>
                        {pill && <span className="pill-warn">{pill}</span>}
                      </span>
                      <span className="field-suffix">{entry.blurb}</span>
                    </TapButton>
                  );
                })}
              </div>
            </div>
          ))}
        </>
      ) : (
        // Enter in any text field saves, once the method is valid.
        <div
          onKeyDown={(e) => {
            const t = e.target as HTMLInputElement;
            if (e.key === "Enter" && t.type === "text" && valid) save();
          }}
        >
          {/* Step 2: where to find it, then the field itself. Opened on a
              saved method, it is an edit view: they found it once already. */}
          {!editing && (
            <p>
              {target.kind === "provider"
                ? spec!.whereToFind
                : target.kind === "bank"
                  ? "Your IBAN is on your bank statement or in your banking app under account details. The account holder name must match the account, or some banks reject the transfer."
                  : target.kind === "crypto"
                    ? CRYPTO_STEP.whereToFind
                    : "Paste a payment URL and mark where the amount goes. Use {amount}, {currency} and {ref} as placeholders — we substitute them for each debt."}
            </p>
          )}

          {stepPill && (
            <p className="field-suffix">
              <span className="pill-warn">{stepPill}</span> — won't be offered
              for {currency.trim().toUpperCase()} debts. Save it anyway if you
              expect the group currency to change.
            </p>
          )}

          {(target.kind === "custom" || target.kind === "crypto") && (
            <label className="field">
              <span className="field-label">Name</span>
              <input
                type="text"
                autoCapitalize="words"
                placeholder={target.kind === "crypto" ? "Bitcoin" : "Twint"}
                value={label}
                onInput={(e) => setLabel(textValue(e))}
                {...rest(shown === "Give the link a name.")}
              />
            </label>
          )}

          <div className="field">
            <label>
              <span className="field-label">
                {target.kind === "provider"
                  ? `${spec!.label} handle`
                  : target.kind === "bank"
                    ? "IBAN"
                    : target.kind === "crypto"
                      ? "Wallet address"
                      : "Link template"}
              </span>
              <input
                type="text"
                autoFocus
                // IBANs read in capitals; handles, addresses and URLs must not
                // be capitalised or "corrected" by the phone keyboard.
                autoCapitalize={target.kind === "bank" ? "characters" : "none"}
                autoCorrect="off"
                spellcheck={false}
                inputMode={target.kind === "custom" ? "url" : undefined}
                aria-invalid={valueBad || undefined}
                aria-describedby={
                  [
                    target.kind === "provider" && !editing && exampleId,
                    valueBad && statusId,
                  ]
                    .filter(Boolean)
                    .join(" ") || undefined
                }
                placeholder={
                  target.kind === "provider"
                    ? spec!.placeholder
                    : target.kind === "bank"
                      ? "DE89 3704 0044 0532 0130 00"
                      : target.kind === "crypto"
                        ? "bc1q…"
                        : "https://pay.example/{amount}/{currency}/{ref}"
                }
                value={value}
                onInput={(e) => setValue(textValue(e))}
              />
            </label>
            {/* Outside the <label>: help, not part of the field's name. */}
            {target.kind === "provider" && !editing && (
              <span className="field-suffix" id={exampleId}>
                {spec!.example}
              </span>
            )}
          </div>

          {target.kind === "crypto" && (
            <label className="field">
              <span className="field-label">Network</span>
              <select
                value={network}
                onChange={(e) =>
                  setNetwork(
                    (e.currentTarget as HTMLSelectElement)
                      .value as CryptoNetwork,
                  )
                }
              >
                {CRYPTO_NETWORKS.map((n) => (
                  <option key={n.value} value={n.value}>
                    {n.label}
                  </option>
                ))}
              </select>
              <span className="field-suffix">{CRYPTO_STEP.hint}</span>
            </label>
          )}

          {target.kind === "bank" && (
            <>
              <label className="field">
                <span className="field-label">Account holder name</span>
                <input
                  type="text"
                  autoComplete="name"
                  autoCapitalize="words"
                  value={holder}
                  onInput={(e) => setHolder(textValue(e))}
                  {...rest(!shown?.includes("BIC"))}
                />
              </label>
              <label className="field">
                <span className="field-label">BIC (optional)</span>
                <input
                  type="text"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellcheck={false}
                  value={bic}
                  onInput={(e) => setBic(textValue(e))}
                  {...rest(!!shown?.includes("BIC"))}
                />
              </label>
            </>
          )}

          {/* Status, not alert: it changes as you type, and an alert would
              cut in on every keystroke that flips the message. */}
          <p id={statusId} role="status" className="money-negative form-status">
            {shown}
          </p>

          {target.kind === "provider" && spec!.caveat && (
            <p className="field-suffix">{spec!.caveat}</p>
          )}

          {/* The end of the wizard: prove it works before saving. */}
          {valid && testUrl && (
            <div className="wizard-test">
              <p>
                <strong>Try it.</strong> This is exactly what someone paying you{" "}
                {formatMoney(previewCents, currency)} would open.
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
                <CopyButton
                  value={testUrl}
                  label="Copy link"
                  ariaLabel="Copy test link"
                />
              </div>
              {/* The filled-in link itself: the one place to check that a
                  custom template's placeholders land where they should. */}
              <p className="field-suffix">{testUrl}</p>
            </div>
          )}
          {valid && !testUrl && target.kind === "bank" && (
            <p className="field-suffix">
              Payers get a scannable QR code on EUR and CZK debts, and the IBAN
              with copy buttons in any currency.
            </p>
          )}
          {valid && !testUrl && target.kind === "crypto" && (
            <p className="field-suffix">
              There's no standard link for this network, so the payer gets the
              address with a copy button.
            </p>
          )}

          {/* Native checkbox: it never unmounts on blur, so the WebView's
              blur-before-click quirk (see Row.tsx) cannot eat the tap. */}
          <label className="check-field">
            <input
              type="checkbox"
              checked={preferred}
              onChange={(e) =>
                setPreferred((e.currentTarget as HTMLInputElement).checked)
              }
            />
            <span>Preferred way to be paid</span>
          </label>

          <div className="wizard-actions">
            <TapButton
              className="btn btn-primary btn-block"
              disabled={!valid}
              onActivate={save}
            >
              Save
            </TapButton>
            {editing && (
              <TapButton
                className="btn btn-quiet btn-block"
                onActivate={remove}
              >
                <Icon name="trash" size={18} />
                Remove {removeLabel}
              </TapButton>
            )}
          </div>
        </div>
      )}
    </SubPage>
  );
}
