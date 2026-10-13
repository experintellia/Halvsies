// The "Me" tab: how the group pays you back. Each saved method is one row that
// says what a payer gets ("Fills in amount", "QR code"); tapping it opens its
// edit view, which is also where Remove lives. "See what payers see" opens the
// real pay-up sheet on a sample debt, so the preview is the payer's screen
// itself rather than a second, drifting copy of it. Everything the whole group
// owns (currency, name, members, backup) lives behind the header instead.
import { useId, useState } from "preact/hooks";
import { getMember, getProfile, getSettings, setProfile } from "../state/doc";
import { useDocValue } from "./useDoc";
import type { PaymentProfile } from "../state/model";
import { formatIban, isValidIban } from "../pay/iban";
import { paymentMethodsFor } from "../pay/links";
import { configuredProviders, notOfferedReason } from "../pay/providers";
import { epcReference } from "../pay/epcqr";
import { bankQr } from "../pay/bankqr";
import { Avatar } from "./components/Avatar";
import { Icon, type IconName } from "./components/Icon";
import { Row } from "./components/Row";
import { TapButton } from "./components/TapButton";
import { PaymentMethodWizard, type WizardTarget } from "./PaymentMethodWizard";
import { PayUpSheet } from "./PayUpSheet";

function selfAddr(): string | undefined {
  return typeof window === "undefined" ? undefined : window.webxdc?.selfAddr;
}

/** Fixed sample amount for the payer preview — not a real debt. */
const PREVIEW_CENTS = 1000;

function textValue(e: Event): string {
  return (e.currentTarget as HTMLInputElement | HTMLTextAreaElement).value;
}

interface MethodRow {
  /** The PayMethod id (or "bank"), which is also what `preferred` stores. */
  id: string;
  icon: IconName;
  name: string;
  detail: string;
  tag?: { text: string; ok: boolean };
  target: WizardTarget;
}

const host = (url: string): string =>
  /^https?:\/\/([^/?#]+)/i.exec(url)?.[1] ?? url;

export function ProfileForm() {
  const self = selfAddr();
  const settings = useDocValue(getSettings);
  const profile = useDocValue(() => (self ? getProfile(self) : undefined));
  const me = useDocValue(() => (self ? getMember(self) : undefined));
  // Lazily seeded once: this component unmounts/remounts with the tab, so a
  // fresh visit always starts from the current doc state without needing a
  // continuous sync effect that could clobber an in-progress edit.
  const [note, setNote] = useState(profile?.note ?? "");
  const [wizard, setWizard] = useState<WizardTarget | "new" | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const noteId = useId();

  const current: PaymentProfile = profile ?? {};
  const currency = settings.groupCurrency;

  function save(next: PaymentProfile): void {
    if (!self) return;
    setProfile(self, next);
  }

  const reference = epcReference(settings.title);
  // What a payer would get for a sample debt, from the same function the
  // pay-up sheet uses — so a row's "Fills in amount" can't promise more than
  // the payer's screen delivers.
  const offered = paymentMethodsFor(
    current,
    PREVIEW_CENTS,
    currency,
    reference,
  );
  const capability = (id: string): MethodRow["tag"] => {
    const m = offered.find((x) => x.id === id);
    if (!m) return undefined;
    return m.amountPrefilled
      ? { text: "Fills in amount", ok: true }
      : { text: "Payer types amount", ok: false };
  };

  const rows: MethodRow[] = [];
  for (const spec of configuredProviders(current)) {
    // A method the currency gate excludes vanishes from what the payer sees.
    // Silently, until it said so here: someone who had just added a bunq
    // handle to a SEK group could not tell that from a broken app.
    const notOffered = notOfferedReason(spec, currency);
    rows.push({
      id: spec.kind,
      icon: "link",
      name: spec.label,
      detail: notOffered ?? current[spec.field] ?? "",
      tag: notOffered ? undefined : capability(spec.kind),
      target: { kind: "provider", field: spec.field },
    });
  }
  // The same check PayUpSheet gates the payer's bank block on. A truthiness
  // test would count a typo'd IBAN as configured here while the pay-up sheet
  // silently dropped it — the two screens have to agree on what "configured"
  // means.
  const hasBank = isValidIban(current.iban ?? "");
  if (hasBank) {
    // The same decision the payer's sheet makes, from the same function, so
    // the row cannot promise a QR the payer will not get.
    const qr = bankQr({
      name: current.accountHolder || me?.name || "",
      iban: current.iban || "",
      amountCents: PREVIEW_CENTS,
      currency,
      reference,
      bic: current.bic,
    });
    rows.push({
      id: "bank",
      icon: "landmark",
      name: "Bank transfer",
      detail: formatIban(current.iban!),
      // Same question as every other row: does the amount come pre-filled?
      // For a bank transfer, only the QR code can carry it.
      tag: qr.ok
        ? { text: "Fills in amount", ok: true }
        : { text: "Payer types amount", ok: false },
      target: { kind: "bank" },
    });
  }
  if (current.crypto) {
    rows.push({
      id: "crypto",
      icon: "wallet",
      name: current.crypto.label || "Crypto",
      detail: current.crypto.address,
      tag: offered.some((m) => m.id === "crypto")
        ? { text: "Wallet link", ok: true }
        : { text: "Address only", ok: false },
      target: { kind: "crypto" },
    });
  }
  for (const c of current.customs ?? []) {
    rows.push({
      id: `custom:${c.id}`,
      icon: "link",
      name: c.label,
      detail: host(c.urlTemplate),
      tag: capability(`custom:${c.id}`),
      target: { kind: "custom", id: c.id },
    });
  }

  // `hasBank`, not a QR: an IBAN is an international account number and a
  // transfer to it works in any currency — only the QR is currency-locked.
  // An address-only crypto method (no URI scheme) is offered too, just
  // without a link, so it counts.
  const nothingOffered =
    rows.length > 0 &&
    offered.length === 0 &&
    !hasBank &&
    !current.crypto?.address.trim();

  return (
    <section aria-label="Me">
      <section className="profile-head">
        {self && (
          <Avatar member={{ id: self, name: me?.name ?? "" }} size={56} />
        )}
        <div>
          <span className="profile-name">{me?.name || "You"}</span>
          <span className="profile-sub">How the group pays you back</span>
        </div>
      </section>

      <h2 className="section-label">Payment methods</h2>
      {rows.length === 0 && (
        <p className="fine">
          No payment methods yet. Add one so people can pay you back in a couple
          of taps instead of asking for your details.
        </p>
      )}
      <div className="list">
        {rows.map((r) => (
          <Row key={r.id} onActivate={() => setWizard(r.target)}>
            <span className="method-icon">
              <Icon name={r.icon} size={20} />
            </span>
            <span className="method-main">
              <span className="method-name">
                {r.name}
                {current.preferred === r.id && (
                  <span className="preferred-mark">
                    <Icon name="circle-check" size={14} />
                    Preferred
                  </span>
                )}
              </span>
              <span className="method-detail">{r.detail}</span>
            </span>
            {r.tag && (
              <span className={"tag" + (r.tag.ok ? " tag-ok" : "")}>
                {r.tag.text}
              </span>
            )}
            <span className="chevron">
              <Icon name="chevron-right" size={18} />
            </span>
          </Row>
        ))}
        <Row className="add-row" onActivate={() => setWizard("new")}>
          <span className="method-icon">
            <Icon name="plus" size={20} />
          </span>
          <span className="method-name">Add payment method</span>
        </Row>
      </div>
      {nothingOffered && (
        <p className="fine">
          None of your saved methods work for {currency} debts. Add one that
          does, or change the group currency.
        </p>
      )}
      {/* Payers see a note on its own too, so it counts as something shown. */}
      {(rows.length > 0 || current.note) && (
        <p className="fine">
          <Icon name="eye" size={15} />
          Everyone in this chat can see your payment details and note.
        </p>
      )}

      {/* Always visible, whether or not any method is configured: this is
          where "bank transfer only after the 1st" or "round it up" lives. */}
      <h2 className="section-label" id={noteId}>
        Note to payers
      </h2>
      <textarea
        className="note-input"
        aria-labelledby={noteId}
        value={note}
        placeholder="e.g. IBAN please, PayPal charges me a fee"
        onInput={(e) => setNote(textValue(e))}
        onBlur={() => save({ ...current, note: note.trim() || undefined })}
      />

      {self && (rows.length > 0 || current.note) && (
        <TapButton
          className="btn btn-ghost btn-block"
          onActivate={() => setPreviewing(true)}
        >
          <Icon name="eye" size={18} />
          See what payers see
        </TapButton>
      )}

      <PaymentMethodWizard
        open={wizard !== null}
        onClose={() => setWizard(null)}
        profile={current}
        onSave={save}
        editing={wizard && wizard !== "new" ? wizard : undefined}
        previewCents={PREVIEW_CENTS}
        currency={currency}
        reference={reference}
      />

      {self && (
        <PayUpSheet
          transfer={{ fromId: "", toId: self, amountCents: PREVIEW_CENTS }}
          direction="pay"
          preview
          open={previewing}
          onClose={() => setPreviewing(false)}
        />
      )}
    </section>
  );
}
