// The differentiator screen: turn one suggested transfer into an actual
// payment. Pay mode shows the creditor's payment methods; request mode shows
// the same data (which, per Balances.tsx, is only ever opened this way when
// the viewer IS the creditor, so "the creditor's methods" and "your own
// methods" are the same lookup — see the comment above `profile` below).
//
// One method at a time: a segmented switcher picks it, and only that method's
// QR and details are shown, so the sheet stays about a screen tall however
// many methods the creditor has. It opens on the creditor's preferred method.
import { useRef, useState } from "preact/hooks";
import {
  addSettlement,
  canSendToChat,
  getMember,
  getProfile,
  getSettings,
  now,
} from "../state/doc";
import { newId, formatMoney, type Transfer } from "../state/model";
import { paymentMethodsFor, type PayMethod } from "../pay/links";
import { epcReference } from "../pay/epcqr";
import { bankQr } from "../pay/bankqr";
import { formatIban, isValidIban } from "../pay/iban";
import { Sheet } from "./components/Sheet";
import { CopyButton } from "./components/CopyButton";
import { CopyField } from "./components/CopyField";
import { QR } from "./components/QR";
import { Avatar } from "./components/Avatar";
import { Icon, type IconName } from "./components/Icon";
import { TapButton } from "./components/TapButton";
import { announce } from "./announce";

export interface PayUpSheetProps {
  transfer: Transfer;
  direction: "pay" | "request";
  open: boolean;
  onClose: () => void;
  /**
   * The Me tab's "See what payers see": the payer's view of a sample debt to
   * the local user. Nothing can be recorded or sent from it.
   */
  preview?: boolean;
  /**
   * Opens the payment details of a creditor who doesn't use the app (a member
   * added by hand), so someone who does can fill them in for them.
   */
  onEditPayee?: () => void;
}

function selfAddr(): string | undefined {
  return typeof window === "undefined" ? undefined : window.webxdc?.selfAddr;
}

function sendToChat(text: string): void {
  const host = typeof window === "undefined" ? undefined : window.webxdc;
  if (!canSendToChat || !host) return; // button is hidden in this case anyway
  host.sendToChat({ text }).catch(() => {
    /* user cancelled the share, or the app is closing — nothing to recover */
  });
}

/** One entry in the method switcher. */
type Option =
  | {
      id: string;
      kind: "link";
      label: string;
      icon: IconName;
      method: PayMethod;
    }
  | {
      id: string;
      kind: "address";
      label: string;
      icon: IconName;
      address: string;
    }
  | { id: string; kind: "bank"; label: string; icon: IconName };

const QR_SIZE = 136;

export function PayUpSheet({
  transfer,
  direction,
  open,
  onClose,
  preview = false,
  onEditPayee,
}: PayUpSheetProps) {
  const [usedMethod, setUsedMethod] = useState<string | undefined>(undefined);
  const [confirming, setConfirming] = useState(false);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const armedTab = useRef<string | undefined>(undefined);

  const self = selfAddr();

  // Sheet renders null when closed, so this component stays mounted across
  // different transfers — without this reset a method label tapped on the
  // previous debt would be written into the next settlement record.
  const key = `${transfer.fromId}|${transfer.toId}|${transfer.amountCents}|${open}`;
  const lastKey = useRef(key);
  if (lastKey.current !== key) {
    lastKey.current = key;
    setUsedMethod(undefined);
    setConfirming(false);
    setSelectedId(undefined);
  }
  const settings = getSettings();
  const currency = settings.groupCurrency;
  const amount = formatMoney(transfer.amountCents, currency);

  const debtor = getMember(transfer.fromId);
  const creditor = getMember(transfer.toId);
  const debtorName =
    transfer.fromId === self ? "You" : debtor?.name || "Someone";
  // The preview is the payer's screen, so it names you the way they see you.
  const creditorName =
    transfer.toId === self && !preview ? "You" : creditor?.name || "Someone";

  const title = preview
    ? "What payers see"
    : transfer.fromId === self
      ? `You owe ${creditorName}`
      : transfer.toId === self
        ? `${debtorName} owes you`
        : `${debtorName} owes ${creditorName}`;

  // ponytail: whoever is owed money (toId) is always the one whose payment
  // details are shown — in the two cases the task actually specifies (you
  // owe / owed to you), toId is either the creditor or self, so this single
  // lookup covers both "show their methods" and "show my own methods"
  // without a branch. A tap on a transfer between two other members (a group
  // >2 people) falls back to the same creditor-facing view, which is the
  // only one that makes sense when the viewer isn't part of the debt.
  const profile = getProfile(transfer.toId) ?? {};
  const reference = epcReference(settings.title);

  // The stored member name, never the display substitution: creditorName is
  // the literal "You" when the creditor is the local user, and a QR whose
  // beneficiary reads "You" gets flagged by banks that match payee to IBAN.
  // The same name feeds UPI's `pn` and Monero's `recipient_name`, which land
  // in the payer's app the same way.
  const payeeName = profile.accountHolder || creditor?.name || "";

  const methods = paymentMethodsFor(
    profile,
    transfer.amountCents,
    currency,
    reference,
    payeeName,
  );

  // network "other" (or none) has no URI scheme, so cryptoLink() deliberately
  // returns null and no crypto method is in the list — the address is still
  // the whole point of having filled it in, so it gets its own option.
  const crypto = profile.crypto;
  const cryptoAddressOnly =
    crypto?.address.trim() && !methods.some((m) => m.kind === "crypto")
      ? crypto
      : undefined;

  // An IBAN is an international account number (ISO 13616, ~85 countries), so
  // a valid one is a usable payment method in *any* currency. What is currency
  // -locked is the scannable code — hence two separate gates: hasIban shows the
  // details, and bankQr() decides whether any QR standard covers this debt.
  const formattedIban = formatIban(profile.iban || "");
  const hasIban = isValidIban(profile.iban || "");
  const qr = bankQr({
    name: payeeName,
    iban: profile.iban || "",
    amountCents: transfer.amountCents,
    currency,
    reference,
    bic: profile.bic,
  });
  const bankLine = `IBAN ${formattedIban}${payeeName ? ` (${payeeName})` : ""}${
    profile.bic ? `, BIC ${profile.bic}` : ""
  }, ref: ${reference}`;

  const options: Option[] = methods.map((m) => ({
    id: m.id,
    kind: "link",
    label: m.label,
    icon: m.kind === "crypto" ? "wallet" : "link",
    method: m,
  }));
  if (cryptoAddressOnly) {
    options.push({
      id: "crypto",
      kind: "address",
      label: cryptoAddressOnly.label.trim() || "Crypto",
      icon: "wallet",
      address: cryptoAddressOnly.address.trim(),
    });
  }
  if (hasIban) {
    options.push({
      id: "bank",
      kind: "bank",
      label: "Bank transfer",
      icon: "landmark",
    });
  }
  // The payee's pick goes first and is what the sheet opens on; the rest keep
  // their fixed order, so every peer sees the same switcher.
  const preferredIdx = options.findIndex((o) => o.id === profile.preferred);
  if (preferredIdx > 0) options.unshift(...options.splice(preferredIdx, 1));
  const selected = options.find((o) => o.id === selectedId) ?? options[0];
  const isPreferred =
    selected !== undefined && selected.id === profile.preferred;

  // Recording a settlement is a money claim every peer sees. Only a party to
  // the transfer may make it: otherwise tapping "Bob owes Carol €20" in a
  // 4-person group would let an uninvolved member clear a debt they know
  // nothing about, attributed to them in the chat info line.
  // Members added by hand (isVirtual) aren't in the chat and can't open the
  // app: they can't fill in their own details or be asked in the chat.
  const creditorOffline = !preview && creditor?.isVirtual === true;
  const debtorOffline = !preview && debtor?.isVirtual === true;
  // Between two of those, no party could ever record it — so anyone in the
  // group may (a chat of friends and family; the chat line still says who).
  const recordsForOthers = creditorOffline && debtorOffline;
  const isParty =
    !preview &&
    (transfer.fromId === self || transfer.toId === self || recordsForOthers);
  // Whose details these are, from where the viewer stands: your own only when
  // you are the creditor — not merely because Balances opened this in
  // "request" mode, which it also does for a debt between two others.
  const ownDetails = transfer.toId === self && !preview;
  // One primary action at a time. Opening the payment app is the payer's next
  // step; recording it takes over once they have. For anyone but the payer,
  // opening the creditor's link is not their job at all.
  const openIsPrimary = preview || (direction === "pay" && isParty);
  const markIsPrimary =
    !openIsPrimary || selected?.kind !== "link" || usedMethod !== undefined;

  // Asking for money is not method-specific: the debtor should get every way
  // to pay in one message and pick.
  const askText = (): string => {
    const ways = methods.map((m) => `${m.label}: ${m.url}`);
    if (cryptoAddressOnly) {
      ways.push(
        `${cryptoAddressOnly.label.trim() || "Crypto"}: ${cryptoAddressOnly.address.trim()}`,
      );
    }
    if (hasIban) ways.push(`Bank transfer — ${bankLine}`);
    const ask = `Hey ${debtorName} — ${amount} whenever you get a chance`;
    // No payment details on file is not a reason to withhold the nudge.
    return ways.length ? `${ask}:\n${ways.join("\n")}` : `${ask}.`;
  };

  // Announcing a payment is: you are paying by the method on screen.
  function tellTheChat(): void {
    if (!selected) return;
    if (selected.kind === "link") {
      setUsedMethod(selected.label);
      sendToChat(
        `Paying ${creditorName} ${amount} now — ${selected.method.url}`,
      );
    } else if (selected.kind === "address") {
      setUsedMethod(selected.label);
      sendToChat(
        `Paying ${creditorName} ${amount} now — ${selected.label}: ${selected.address}`,
      );
    } else {
      setUsedMethod("Bank transfer");
      sendToChat(
        `Paying ${creditorName} ${amount} by bank transfer — ${bankLine}`,
      );
    }
  }

  function record(): void {
    if (!isParty) return;
    addSettlement({
      id: newId(now()),
      fromId: transfer.fromId,
      toId: transfer.toId,
      amountCents: transfer.amountCents,
      method: usedMethod,
      date: new Date(now()).toISOString().slice(0, 10),
      createdBy: self || transfer.fromId,
    });
    onClose();
    announce("Payment recorded");
  }

  const nothingOnFile = options.length === 0 && !profile.note;
  const question =
    (recordsForOthers
      ? `Record that ${debtorName} paid ${creditorName} ${amount}?`
      : direction === "pay"
        ? `Record that you paid ${creditorName} ${amount}?`
        : `Record that ${debtorName} paid you ${amount}?`) +
    " Everyone in this chat will see it.";

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <p className={"sheet-amount money" + (amount.length > 12 ? " long" : "")}>
        {amount}
      </p>

      {/* The creditor's own instructions come first — they may override which
          method to use ("IBAN please, PayPal charges me a fee"), so showing
          them after the methods would be showing them too late. */}
      {profile.note && (
        <div className="payee-note">
          <Avatar
            member={creditor ?? { id: transfer.toId, name: creditorName }}
            size={24}
          />
          <p>
            <strong>{ownDetails ? "Your note" : creditorName}</strong>
            {profile.note}
          </p>
        </div>
      )}

      {nothingOnFile && (
        <p className="placeholder">
          {preview
            ? "Payers see nothing here yet. Add a payment method first."
            : ownDetails
              ? "Add your payment details in the Me tab so this is a one-tap payment next time."
              : creditorOffline
                ? `${creditorName} doesn't use Halvsies, so there are no payment details on file.${
                    transfer.fromId === self
                      ? " Pay them however you usually do, then mark it as paid."
                      : recordsForOthers
                        ? " Once they've settled up, anyone here can mark it as paid."
                        : ""
                  }`
                : `${creditorName} hasn't added any payment details yet — settle up in person, or ask them to add a payment method in the Me tab.`}
        </p>
      )}
      {/* They can't add their own details, so anyone in the group may, and
          the next payment gets the same QR codes and links as anyone's. */}
      {creditorOffline && nothingOnFile && onEditPayee && (
        <TapButton
          className="btn btn-secondary btn-block"
          onActivate={onEditPayee}
        >
          <Icon name="plus" size={18} />
          Add {creditorName}'s payment details
        </TapButton>
      )}

      {/* Toggle buttons in a labelled group rather than ARIA tabs: tabs
          promise arrow-key navigation and a linked panel, which this isn't. */}
      {options.length > 1 && (
        <div className="method-switch" role="group" aria-label="Payment method">
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              className="method-tab"
              aria-pressed={o === selected ? "true" : "false"}
              // The strip scrolls sideways when there are many methods, so a
              // pointerup only counts if it went down on this tab and stayed
              // (Row.tsx's rule for scrollable lists).
              onPointerDown={() => (armedTab.current = o.id)}
              onPointerLeave={() => (armedTab.current = undefined)}
              onPointerCancel={() => (armedTab.current = undefined)}
              onPointerUp={() => {
                if (armedTab.current === o.id) setSelectedId(o.id);
                armedTab.current = undefined;
              }}
              onClick={(e) => {
                if (e.detail === 0) setSelectedId(o.id);
              }}
            >
              <Icon name={o.icon} size={16} />
              <span>{o.label}</span>
            </button>
          ))}
        </div>
      )}

      {/* A lone method gets no switcher, so it needs its name said once. */}
      {options.length === 1 && selected && (
        <h3 className="method-heading">
          <span className="method-icon">
            <Icon name={selected.icon} size={20} />
          </span>
          {selected.label}
        </h3>
      )}

      {selected && (
        <div>
          {isPreferred && (
            <p className="preferred-line">
              <Icon name="circle-check" size={16} />
              {creditorName === "You"
                ? "Your preferred way to be paid"
                : `${creditorName}'s preferred way to be paid`}
            </p>
          )}

          {selected.kind === "link" && (
            <>
              <div className="qr-row">
                <QR payload={selected.method.url} size={QR_SIZE} />
                <p className="qr-caption">
                  <strong>
                    {selected.method.amountPrefilled
                      ? `${amount} is filled in`
                      : `Type in ${amount} yourself`}
                  </strong>
                  <span>Scan it from another phone.</span>
                </p>
              </div>
              {/* Plan.md §5 M2: many devices have no handler for `bitcoin:`/
                  `ethereum:`/`monero:`, so the raw address is always shown in
                  full with its own copy button, never the link alone. */}
              {selected.method.rawAddress && (
                <CryptoAddress
                  address={selected.method.rawAddress}
                  amount={amount}
                />
              )}
              <div className="open-row">
                <a
                  className={
                    openIsPrimary ? "btn btn-primary" : "btn btn-secondary"
                  }
                  href={selected.method.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onPointerUp={() => setUsedMethod(selected.label)}
                >
                  Open {selected.label}
                  <Icon name="arrow-right" size={18} />
                </a>
                <CopyButton
                  value={selected.method.url}
                  icon
                  ariaLabel={`Copy ${selected.label} link`}
                />
              </div>
              {selected.method.caveat && (
                <p className="field-suffix">{selected.method.caveat}</p>
              )}
            </>
          )}

          {selected.kind === "address" && (
            <>
              <div className="qr-row">
                <QR payload={selected.address} size={QR_SIZE} />
                <p className="qr-caption">
                  <strong>{selected.label}</strong>
                  <span>
                    Address only: there's no payment link for this network.
                  </span>
                </p>
              </div>
              <CryptoAddress address={selected.address} amount={amount} />
            </>
          )}

          {selected.kind === "bank" && (
            <>
              {qr.ok ? (
                <div className="qr-row">
                  <QR payload={qr.payload} size={QR_SIZE} />
                  <p className="qr-caption">
                    <strong>{qr.hint}</strong>
                    <span>Fills in IBAN, amount and reference.</span>
                  </p>
                </div>
              ) : (
                <p className="field-suffix">
                  No scannable code for this debt: {qr.reason}. Only the code is
                  missing — the details below work for a transfer in{" "}
                  {currency.trim().toUpperCase()}.
                </p>
              )}
              {/* Every one of these is a value the payer has to retype into a
                  banking app, so each gets the same shape: readable, its own
                  copy button. */}
              <div className="copy-list">
                <CopyField label="Account holder" value={payeeName} />
                <CopyField label="IBAN" value={formattedIban} />
                {profile.bic && <CopyField label="BIC" value={profile.bic} />}
                <CopyField
                  label="Reference"
                  value={reference}
                  copyName="payment reference"
                />
              </div>
            </>
          )}
        </div>
      )}

      {creditorOffline && !nothingOnFile && onEditPayee && (
        <TapButton className="btn btn-quiet btn-block" onActivate={onEditPayee}>
          Edit {creditorName}'s payment details
        </TapButton>
      )}

      {/* In-app two-tap confirmation rather than window.confirm(): several
          webxdc hosts ship a WebView with no JS-dialog handler, where confirm()
          returns false instantly and the settlement would silently never be
          recorded. */}
      <div className="sheet-actions">
        {preview ? (
          <p className="field-suffix">
            A sample {amount} debt. Nothing here is recorded or sent.
          </p>
        ) : !isParty ? (
          <p className="field-suffix">
            Only {debtorName} or {creditorName} can record this payment.
          </p>
        ) : confirming ? (
          <>
            <p>{question}</p>
            {/* Keyed, every button here: unkeyed, Preact reused the focused
                "Mark as paid" element as "Yes, record it", and a second
                Enter skipped the confirmation it exists to ask for. */}
            <TapButton
              key="cancel"
              className="btn btn-secondary"
              onActivate={() => setConfirming(false)}
            >
              Cancel
            </TapButton>
            <TapButton
              key="yes"
              className="btn btn-primary"
              onActivate={record}
            >
              Yes, record it
            </TapButton>
          </>
        ) : (
          <>
            {canSendToChat && direction === "pay" && selected && (
              <TapButton
                key="paying"
                className="btn btn-secondary"
                onActivate={tellTheChat}
              >
                <Icon name="send" size={18} />
                I'm paying now
              </TapButton>
            )}
            {/* Not in this chat: a chat message would never reach them. The
                same request, copied, goes wherever they can be reached. */}
            {transfer.toId === self && debtorOffline && (
              <p key="offline-note" className="field-suffix">
                {debtorName} isn't in this chat. Send them the request another
                way, then mark it as received.
              </p>
            )}
            {transfer.toId === self && debtorOffline && (
              <CopyButton
                key="copy-ask"
                value={askText()}
                label="Copy request"
                className="btn-block"
              />
            )}
            {canSendToChat && direction === "request" && !debtorOffline && (
              <TapButton
                key="ask"
                className="btn btn-secondary"
                onActivate={() => sendToChat(askText())}
              >
                <Icon name="send" size={18} />
                Ask for the money
              </TapButton>
            )}
            <TapButton
              key="mark"
              className={
                markIsPrimary ? "btn btn-primary" : "btn btn-secondary"
              }
              onActivate={() => {
                setConfirming(true);
                // The button you pressed is replaced by this question.
                announce(question);
              }}
            >
              <Icon name="check" size={18} />
              {direction === "pay" || recordsForOthers
                ? "Mark as paid"
                : "Mark as received"}
            </TapButton>
          </>
        )}
      </div>
    </Sheet>
  );
}

// No crypto amount is ever emitted: the ledger is fiat and this app has no
// exchange rates, so the fiat debt is shown as text instead.
function CryptoAddress({
  address,
  amount,
}: {
  address: string;
  amount: string;
}) {
  return (
    <>
      <div className="copy-list">
        <CopyField label="Address" value={address} copyName="address" />
      </div>
      <p className="field-suffix">
        Send the equivalent of <span className="money">{amount}</span> — the
        amount is not embedded in the address; the paying wallet converts it at
        pay time.
      </p>
    </>
  );
}
