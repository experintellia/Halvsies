// The differentiator screen: turn one suggested transfer into an actual
// payment. Pay mode shows the creditor's payment methods; request mode shows
// the same data (which, per Balances.tsx, is only ever opened this way when
// the viewer IS the creditor, so "the creditor's methods" and "your own
// methods" are the same lookup — see the comment above `profile` below).
import { useRef, useState } from "preact/hooks";
import type { ComponentChildren, JSX } from "preact";
import {
  addSettlement,
  canSendToChat,
  getMember,
  getProfile,
  getSettings,
  now,
} from "../state/doc";
import { newId, formatMoney, type Transfer } from "../state/model";
import { paymentMethodsFor } from "../pay/links";
import { epcReference } from "../pay/epcqr";
import { bankQr } from "../pay/bankqr";
import { formatIban, isValidIban } from "../pay/iban";
import { Sheet } from "./components/Sheet";
import { CopyButton } from "./components/CopyButton";
import { CopyField } from "./components/CopyField";
import { QR } from "./components/QR";

export interface PayUpSheetProps {
  transfer: Transfer;
  direction: "pay" | "request";
  open: boolean;
  onClose: () => void;
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

// Small local tap-handling helper (Row.tsx's armed/drag-cancel dance is for
// scrollable list rows; a plain action button only needs the simpler
// onPointerUp + e.detail===0 pair CopyButton.tsx already uses).
function TapButton({
  onActivate,
  children,
  ...rest
}: {
  onActivate: () => void;
  children: ComponentChildren;
} & Omit<
  JSX.HTMLAttributes<HTMLButtonElement>,
  "onClick" | "onPointerUp" | "children"
>) {
  return (
    <button
      type="button"
      onPointerUp={onActivate}
      onClick={(e) => {
        if (e.detail === 0) onActivate();
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

// Plan.md §5 M2: many devices have no handler registered for `bitcoin:`/
// `ethereum:`/`monero:`, so tapping the link can silently do nothing — the
// raw address is always shown in full with its own copy button, never the
// link alone. No crypto amount is ever emitted: the ledger is fiat and this
// app has no exchange rates, so the fiat debt is shown as text instead.
function CryptoAddress({
  address,
  amount,
}: {
  address: string;
  amount: string;
}) {
  return (
    <>
      {/* Same shape as the bank details: a value to be transcribed gets a
          full-width readable field and its own copy button. */}
      <label className="field">
        <span className="field-label">Address</span>
        <span className="field-row">
          <input
            className="copy-input"
            type="text"
            readOnly
            value={address}
            onFocus={(e) => (e.currentTarget as HTMLInputElement).select()}
          />
          <CopyButton value={address} label="Copy address" />
        </span>
      </label>
      <p className="field-suffix">
        Send the equivalent of <span className="money">{amount}</span> — the
        amount is not embedded in the address; the paying wallet converts it at
        pay time.
      </p>
    </>
  );
}

export function PayUpSheet({
  transfer,
  direction,
  open,
  onClose,
}: PayUpSheetProps) {
  const [usedMethod, setUsedMethod] = useState<string | undefined>(undefined);
  const [confirming, setConfirming] = useState(false);

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
  }
  const settings = getSettings();
  const currency = settings.groupCurrency;
  const amount = formatMoney(transfer.amountCents, currency);

  const debtor = getMember(transfer.fromId);
  const creditor = getMember(transfer.toId);
  const debtorName =
    transfer.fromId === self ? "You" : debtor?.name || "Someone";
  const creditorName =
    transfer.toId === self ? "You" : creditor?.name || "Someone";

  const headerText =
    transfer.fromId === self
      ? `You owe ${creditorName} ${amount}`
      : transfer.toId === self
        ? `${debtorName} owes you ${amount}`
        : `${debtorName} owes ${creditorName} ${amount}`;

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
  // the whole point of having filled it in, so it gets its own block below.
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

  const introText =
    direction === "pay"
      ? `Pay ${creditorName} using:`
      : transfer.toId === self
        ? `Share your payment details with ${debtorName}:`
        : `${creditorName}'s payment details:`;

  // Recording a settlement is a money claim every peer sees. Only a party to
  // the transfer may make it: otherwise tapping "Bob owes Carol €20" in a
  // 4-person group would let an uninvolved member clear a debt they know
  // nothing about, attributed to them in the chat info line.
  const isParty = transfer.fromId === self || transfer.toId === self;

  // The two directions post opposite things, and they do not belong in the
  // same place. Announcing a payment is method-specific — you paid by *one* of
  // these — so it stays inside the card. Asking for money is not: the debtor
  // should get every way to pay in one message and pick, so the ask is a single
  // action beside "Mark as received" rather than one button per card.
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
  }

  return (
    <Sheet open={open} onClose={onClose} title={headerText}>
      {/* The creditor's own instructions come first — they may override which
          method to use ("IBAN please, PayPal charges me a fee"), so showing
          them after the buttons would be showing them too late. */}
      {profile.note && (
        <p className="payee-note">
          <strong>
            {direction === "pay" ? `${creditorName} says:` : "Your note:"}
          </strong>{" "}
          {profile.note}
        </p>
      )}

      {methods.length === 0 &&
        !hasIban &&
        !profile.note &&
        !cryptoAddressOnly && (
          <p className="placeholder">
            {direction === "pay"
              ? `${creditorName} hasn't added any payment details yet — settle up in person, or ask them to fill in their profile in the Me tab.`
              : "Add your payment details in the Me tab so this is a one-tap payment next time."}
          </p>
        )}

      {methods.length > 0 && (
        <>
          <p>{introText}</p>
          {methods.map((m) => (
            <div className="row row-block" key={m.id}>
              <p>
                <strong>{m.label}</strong>
                {!m.amountPrefilled && (
                  <span className="field-suffix"> — amount not pre-filled</span>
                )}
              </p>
              {m.rawAddress && (
                <CryptoAddress address={m.rawAddress} amount={amount} />
              )}
              <div className="field-row">
                <a
                  className="btn btn-primary"
                  href={m.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onPointerUp={() => setUsedMethod(m.label)}
                >
                  Open {m.label}
                </a>
                <CopyButton value={m.url} label="Copy link" />
              </div>
              {canSendToChat && direction === "pay" && (
                <div className="field-row">
                  <TapButton
                    className="btn btn-secondary"
                    onActivate={() => {
                      setUsedMethod(m.label);
                      sendToChat(
                        `Paying ${creditorName} ${amount} now — ${m.url}`,
                      );
                    }}
                  >
                    I'm paying now
                  </TapButton>
                </div>
              )}
              {/* Every method's code is up front, exactly like the bank
                  transfer below. A QR behind a "Show QR" tap was one rule for
                  bank details and another for everything else, and the payer
                  reaching for a second device has no way to know a code exists
                  before tapping. */}
              <QR payload={m.url} />
              {m.caveat && <p className="field-suffix">{m.caveat}</p>}
            </div>
          ))}
        </>
      )}

      {cryptoAddressOnly && (
        <div className="row row-block">
          <p>
            <strong>{cryptoAddressOnly.label.trim() || "Crypto"}</strong>
            <span className="field-suffix">
              {" "}
              — address only, no payment link
            </span>
          </p>
          <CryptoAddress
            address={cryptoAddressOnly.address.trim()}
            amount={amount}
          />
          <QR payload={cryptoAddressOnly.address.trim()} />
        </div>
      )}

      {hasIban && (
        <div className="row row-block">
          <p>
            <strong>Bank transfer</strong>
          </p>
          {qr.ok ? (
            <>
              <QR payload={qr.payload} />
              <p>{qr.hint}</p>
            </>
          ) : (
            <p className="field-suffix">
              No scannable code for this debt: {qr.reason}. Only the code is
              missing — the details below work for a transfer in{" "}
              {currency.trim().toUpperCase()}.
            </p>
          )}
          {/* Every one of these is a value the payer has to retype into a
              banking app, so each gets the same shape: full-width, readable,
              its own copy button. */}
          <CopyField label="Account holder" value={payeeName} />
          <CopyField label="IBAN" value={formattedIban} />
          {profile.bic && <CopyField label="BIC" value={profile.bic} />}
          <CopyField
            label="Reference"
            value={reference}
            copyName="payment reference"
          />
          {canSendToChat && direction === "pay" && (
            <div className="field-row">
              <TapButton
                className="btn btn-secondary"
                onActivate={() => {
                  setUsedMethod("Bank transfer");
                  sendToChat(
                    `Paying ${creditorName} ${amount} by bank transfer — ${bankLine}`,
                  );
                }}
              >
                I'm paying now
              </TapButton>
            </div>
          )}
        </div>
      )}

      {/* In-app two-tap confirmation rather than window.confirm(): several
          webxdc hosts ship a WebView with no JS-dialog handler, where confirm()
          returns false instantly and the settlement would silently never be
          recorded. */}
      {!isParty ? (
        <p className="field-suffix">
          Only {debtorName} or {creditorName} can record this payment.
        </p>
      ) : confirming ? (
        <>
          <p>
            {direction === "pay"
              ? `Record that you paid ${creditorName} ${amount}?`
              : `Record that ${debtorName} paid you ${amount}?`}{" "}
            Everyone in this chat will see it.
          </p>
          <div className="field-row">
            <TapButton className="btn btn-primary" onActivate={record}>
              Yes, record it
            </TapButton>
            <TapButton
              className="btn btn-secondary"
              onActivate={() => setConfirming(false)}
            >
              Cancel
            </TapButton>
          </div>
        </>
      ) : (
        <div className="field-row">
          <TapButton
            className="btn btn-primary"
            onActivate={() => setConfirming(true)}
          >
            {direction === "pay" ? "Mark as paid" : "Mark as received"}
          </TapButton>
          {direction === "request" && canSendToChat && (
            <TapButton
              className="btn btn-secondary"
              onActivate={() => sendToChat(askText())}
            >
              Ask for the money
            </TapButton>
          )}
        </div>
      )}
    </Sheet>
  );
}
