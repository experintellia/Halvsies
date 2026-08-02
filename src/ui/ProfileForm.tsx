// The "Me" tab: your payment methods (added one at a time via a wizard, so the
// screen stays short) and a free-text note that is always visible. Nothing here
// is shared: everything the whole group owns — currency, name, members, backup
// — lives behind the Group settings button at the top (see GroupSettings.tsx).
import { useState } from "preact/hooks";
import { getProfile, getSettings, setProfile } from "../state/doc";
import { useDocValue } from "./useDoc";
import type { PaymentProfile } from "../state/model";
import { formatIban, isValidIban } from "../pay/iban";
import { paymentMethodsFor } from "../pay/links";
import { configuredProviders, notOfferedReason } from "../pay/providers";
import { epcReference } from "../pay/epcqr";
import { bankQr } from "../pay/bankqr";
import { QR } from "./components/QR";
import { CopyButton } from "./components/CopyButton";
import { TapButton } from "./components/TapButton";
import { PaymentMethodWizard, type WizardTarget } from "./PaymentMethodWizard";

function selfAddr(): string | undefined {
  return typeof window === "undefined" ? undefined : window.webxdc?.selfAddr;
}

/** Fixed sample amount for the "what others see" preview — not a real debt. */
const PREVIEW_CENTS = 1000;

function textValue(e: Event): string {
  return (e.currentTarget as HTMLInputElement | HTMLTextAreaElement).value;
}

export interface ProfileFormProps {
  /** Opens the group-settings sub-page; the route itself lives in App. */
  onOpenGroupSettings: () => void;
}

export function ProfileForm({ onOpenGroupSettings }: ProfileFormProps) {
  const self = selfAddr();
  const settings = useDocValue(getSettings);
  const profile = useDocValue(() => (self ? getProfile(self) : undefined));
  // Lazily seeded once: this component unmounts/remounts with the tab, so a
  // fresh visit always starts from the current doc state without needing a
  // continuous sync effect that could clobber an in-progress edit.
  const [note, setNote] = useState(profile?.note ?? "");
  const [wizard, setWizard] = useState<WizardTarget | "new" | null>(null);

  const current: PaymentProfile = profile ?? {};

  function save(next: PaymentProfile): void {
    if (!self) return;
    setProfile(self, next);
  }

  // What is actually configured, in the order the pay-up sheet shows it.
  const providers = configuredProviders(current);
  const customs = current.customs ?? [];
  // The same check PayUpSheet gates the payer's bank block on. A truthiness
  // test would count a typo'd IBAN as configured here while the pay-up sheet
  // silently dropped it — the two screens have to agree on what "configured"
  // means, or the preview is lying about what others see.
  const hasBank = isValidIban(current.iban ?? "");
  const crypto = current.crypto;
  const methodCount =
    providers.length + customs.length + (hasBank ? 1 : 0) + (crypto ? 1 : 0);

  const previewReference = epcReference(settings.title);
  const previewMethods = paymentMethodsFor(
    current,
    PREVIEW_CENTS,
    settings.groupCurrency,
    previewReference,
  );
  // The same decision the payer's sheet makes, from the same function, so the
  // preview cannot promise a QR the payer will not get.
  const previewQr = bankQr({
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

      <TapButton className="btn btn-secondary" onActivate={onOpenGroupSettings}>
        Group settings
      </TapButton>
      <p className="field-suffix">
        The group's currency and name, who is in the split, and backup — the
        things everyone here shares.
      </p>

      <h2>Your payment details</h2>
      {methodCount === 0 ? (
        <p className="placeholder">
          No payment methods yet. Add one so people can pay you back in a couple
          of taps instead of asking for your details.
        </p>
      ) : (
        <ul className="method-list">
          {providers.map((spec) => {
            // A method the currency gate excludes vanishes from what the payer
            // sees. Silently, until now: someone who had just added a bunq
            // handle to a SEK group could not tell that from a broken app.
            const notOffered = notOfferedReason(spec, settings.groupCurrency);
            return (
              <li key={spec.field} className="method-row">
                <span className="method-main">
                  <strong>{spec.label}</strong>{" "}
                  {notOffered && (
                    <span className="pill-warn">{notOffered}</span>
                  )}
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
            );
          })}

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

          {crypto && (
            <li className="method-row">
              <span className="method-main">
                <strong>{crypto.label || "Crypto"}</strong>
                <span className="field-suffix">{crypto.address}</span>
              </span>
              <span className="field-row">
                <TapButton
                  className="btn btn-secondary"
                  onActivate={() => setWizard({ kind: "crypto" })}
                >
                  Edit
                </TapButton>
                <TapButton
                  className="btn btn-danger"
                  onActivate={() => save({ ...current, crypto: undefined })}
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
      {/* `hasBank`, not `previewEpc`: an IBAN is an international account
          number and a transfer to it works in any currency — only the EPC QR
          is EUR-only. Gating this on the QR told a GBP user whose one method
          was a perfectly good IBAN that they had nothing at all. */}
      {previewMethods.length === 0 && !hasBank && (
        <p className="placeholder">
          {methodCount === 0
            ? "Nothing yet — fill in at least one method above."
            : // The lie this replaces: someone who had just added a bunq
              // handle to a SEK group was told they had added nothing.
              `None of your saved methods work for ${settings.groupCurrency} debts — see the notes above. Add one that does, or change the group currency.`}
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
      {hasBank && (
        <div className="row row-block">
          <p>
            <strong>Bank transfer</strong>
          </p>
          <div className="field-row">
            <span className="money">{formatIban(current.iban || "")}</span>
            <CopyButton value={formatIban(current.iban || "")} label="Copy" />
          </div>
          {previewQr.ok ? (
            <>
              <QR payload={previewQr.payload} />
              <p className="field-suffix">{previewQr.hint}</p>
            </>
          ) : (
            <p className="field-suffix">
              No scannable QR in {settings.groupCurrency}: {previewQr.reason}.
              Payers still get the IBAN, your name and the reference.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
