// The "Me" tab: edit your own payment profile (self-edited only, per
// Plan.md §4), plus group settings, a virtual-member add, and JSON backup.
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
import type { CustomPaymentMethod, PaymentProfile } from "../state/model";
import {
  formatIban,
  isValidBic,
  isValidIban,
  normalizeIban,
} from "../pay/iban";
import {
  monzoLink,
  paymentMethodsFor,
  paypalLink,
  revolutLink,
  validateCustomTemplate,
  venmoLink,
  wiseLink,
} from "../pay/links";
import { buildEpcPayload, epcReference, validateEpcParams } from "../pay/epcqr";
import { QR } from "./components/QR";
import { CopyButton } from "./components/CopyButton";

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

interface FormState {
  paypalMe: string;
  iban: string; // kept spaced (formatIban) for display; normalized on save
  accountHolder: string;
  bic: string;
  revolutTag: string;
  wiseTag: string;
  venmo: string;
  monzoMe: string;
  customLabel: string;
  customUrl: string;
  note: string;
}

function toForm(p: PaymentProfile | undefined): FormState {
  return {
    paypalMe: p?.paypalMe ?? "",
    iban: p?.iban ? formatIban(p.iban) : "",
    accountHolder: p?.accountHolder ?? "",
    bic: p?.bic ?? "",
    revolutTag: p?.revolutTag ?? "",
    wiseTag: p?.wiseTag ?? "",
    venmo: p?.venmo ?? "",
    monzoMe: p?.monzoMe ?? "",
    customLabel: p?.custom?.label ?? "",
    customUrl: p?.custom?.urlTemplate ?? "",
    note: p?.note ?? "",
  };
}

function toProfile(f: FormState): PaymentProfile {
  const custom: CustomPaymentMethod | undefined =
    f.customLabel.trim() && f.customUrl.trim()
      ? { label: f.customLabel.trim(), urlTemplate: f.customUrl.trim() }
      : undefined;
  return {
    paypalMe: f.paypalMe.trim() || undefined,
    iban: f.iban.trim() ? normalizeIban(f.iban) : undefined,
    accountHolder: f.accountHolder.trim() || undefined,
    bic: f.bic.trim() ? normalizeIban(f.bic) : undefined,
    revolutTag: f.revolutTag.trim() || undefined,
    wiseTag: f.wiseTag.trim() || undefined,
    venmo: f.venmo.trim() || undefined,
    monzoMe: f.monzoMe.trim() || undefined,
    custom,
    note: f.note.trim() || undefined,
  };
}

function textValue(e: Event): string {
  return (e.currentTarget as HTMLInputElement | HTMLTextAreaElement).value;
}

export function ProfileForm() {
  const self = selfAddr();
  const settings = useDocValue(getSettings);
  const profile = useDocValue(() => (self ? getProfile(self) : undefined));
  // Lazily seeded once: this component unmounts/remounts with the tab, so a
  // fresh visit always starts from the current doc state without needing a
  // continuous sync effect that could clobber an in-progress edit.
  const [form, setForm] = useState<FormState>(() => toForm(profile));
  const [virtualName, setVirtualName] = useState("");
  const [importError, setImportError] = useState<string | undefined>(undefined);
  const virtualNameId = useId();

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

  function field<K extends keyof FormState>(key: K, value: string): void {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function persist(next: FormState = form): void {
    if (!self) return;
    setProfile(self, toProfile(next));
  }

  const paypalError =
    form.paypalMe.trim() &&
    !paypalLink(form.paypalMe, PREVIEW_CENTS, settings.groupCurrency)
      ? "Doesn't look like a valid PayPal.Me handle."
      : null;
  const revolutError =
    form.revolutTag.trim() && !revolutLink(form.revolutTag)
      ? "Doesn't look like a valid Revolut tag."
      : null;
  const wiseError =
    form.wiseTag.trim() && !wiseLink(form.wiseTag)
      ? "Doesn't look like a valid Wise tag."
      : null;
  const venmoError =
    form.venmo.trim() && !venmoLink(form.venmo)
      ? "Doesn't look like a valid Venmo username."
      : null;
  // Force GBP + an in-range amount to isolate the username-format check from
  // the currency/amount gate (links.ts exports no format-only validator).
  const monzoError =
    form.monzoMe.trim() && !monzoLink(form.monzoMe, PREVIEW_CENTS, "GBP", "x")
      ? "Doesn't look like a valid Monzo username."
      : null;
  const ibanError =
    form.iban.trim() && !isValidIban(form.iban)
      ? "This doesn't look like a valid IBAN."
      : null;
  const bicError =
    form.bic.trim() && !isValidBic(form.bic)
      ? "This doesn't look like a valid BIC."
      : null;
  const customError = form.customUrl.trim()
    ? validateCustomTemplate(form.customUrl)
    : null;

  const previewProfile = toProfile(form);
  const previewReference = epcReference(settings.title);
  const previewMethods = paymentMethodsFor(
    previewProfile,
    PREVIEW_CENTS,
    settings.groupCurrency,
    previewReference,
  );
  const previewEpc = validateEpcParams({
    name: previewProfile.accountHolder || "You",
    iban: previewProfile.iban || "",
    amountCents: PREVIEW_CENTS,
    currency: settings.groupCurrency,
    reference: previewReference,
    bic: previewProfile.bic,
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

      <label className="field">
        <span className="field-label">PayPal.Me handle</span>
        <input
          type="text"
          value={form.paypalMe}
          onInput={(e) => field("paypalMe", textValue(e))}
          onBlur={() => persist()}
        />
        {paypalError && <p className="field-suffix">{paypalError}</p>}
      </label>

      <label className="field">
        <span className="field-label">IBAN</span>
        <input
          type="text"
          value={form.iban}
          onInput={(e) => field("iban", textValue(e))}
          onBlur={() => {
            const displayed = form.iban.trim() ? formatIban(form.iban) : "";
            const next = { ...form, iban: displayed };
            setForm(next);
            persist(next);
          }}
        />
        {ibanError && <p className="field-suffix">{ibanError}</p>}
      </label>
      <label className="field">
        <span className="field-label">Account holder name</span>
        <input
          type="text"
          value={form.accountHolder}
          onInput={(e) => field("accountHolder", textValue(e))}
          onBlur={() => persist()}
        />
      </label>
      <label className="field">
        <span className="field-label">BIC (optional)</span>
        <input
          type="text"
          value={form.bic}
          onInput={(e) => field("bic", textValue(e))}
          onBlur={() => {
            const displayed = form.bic.trim() ? normalizeIban(form.bic) : "";
            const next = { ...form, bic: displayed };
            setForm(next);
            persist(next);
          }}
        />
        {bicError && <p className="field-suffix">{bicError}</p>}
      </label>

      <label className="field">
        <span className="field-label">Revolut tag</span>
        <input
          type="text"
          value={form.revolutTag}
          onInput={(e) => field("revolutTag", textValue(e))}
          onBlur={() => persist()}
        />
        {revolutError && <p className="field-suffix">{revolutError}</p>}
      </label>

      <label className="field">
        <span className="field-label">Wise tag</span>
        <input
          type="text"
          value={form.wiseTag}
          onInput={(e) => field("wiseTag", textValue(e))}
          onBlur={() => persist()}
        />
        {wiseError && <p className="field-suffix">{wiseError}</p>}
      </label>

      <label className="field">
        <span className="field-label">Venmo username</span>
        <input
          type="text"
          value={form.venmo}
          onInput={(e) => field("venmo", textValue(e))}
          onBlur={() => persist()}
        />
        {venmoError && <p className="field-suffix">{venmoError}</p>}
      </label>

      <label className="field">
        <span className="field-label">Monzo.me username (GBP only)</span>
        <input
          type="text"
          value={form.monzoMe}
          onInput={(e) => field("monzoMe", textValue(e))}
          onBlur={() => persist()}
        />
        {monzoError && <p className="field-suffix">{monzoError}</p>}
      </label>

      <label className="field">
        <span className="field-label">Custom link label</span>
        <input
          type="text"
          value={form.customLabel}
          onInput={(e) => field("customLabel", textValue(e))}
          onBlur={() => persist()}
        />
      </label>
      <label className="field">
        <span className="field-label">
          Custom link template (use {"{amount}"}, {"{currency}"}, {"{ref}"})
        </span>
        <input
          type="text"
          placeholder="https://pay.example/{amount}/{currency}/{ref}"
          value={form.customUrl}
          onInput={(e) => field("customUrl", textValue(e))}
          onBlur={() => persist()}
        />
        {customError && <p className="field-suffix">{customError}</p>}
      </label>

      <label className="field">
        <span className="field-label">Note (shown alongside your details)</span>
        <textarea
          value={form.note}
          onInput={(e) => field("note", textValue(e))}
          onBlur={() => persist()}
        />
      </label>

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
        <div className="field-row" key={m.kind}>
          <p>
            <strong>{m.label}:</strong> {m.url}
          </p>
          <CopyButton value={m.url} label="Copy" />
        </div>
      ))}
      {!previewEpc && form.iban.trim() && (
        <div className="row" style={{ display: "block" }}>
          <p>
            <strong>Bank transfer QR</strong>
          </p>
          <QR
            payload={buildEpcPayload({
              name: previewProfile.accountHolder || "You",
              iban: previewProfile.iban || "",
              amountCents: PREVIEW_CENTS,
              currency: settings.groupCurrency,
              reference: previewReference,
              bic: previewProfile.bic,
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
