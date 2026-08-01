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
import { buildEpcPayload, epcReference, validateEpcParams } from "../pay/epcqr";
import { formatIban } from "../pay/iban";
import { Sheet } from "./components/Sheet";
import { CopyButton } from "./components/CopyButton";
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

export function PayUpSheet({
  transfer,
  direction,
  open,
  onClose,
}: PayUpSheetProps) {
  const [shownQr, setShownQr] = useState<string | null>(null);
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
    setShownQr(null);
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
  const methods = paymentMethodsFor(
    profile,
    transfer.amountCents,
    currency,
    reference,
  );

  // The stored member name, never the display substitution: creditorName is
  // the literal "You" when the creditor is the local user, and a QR whose
  // beneficiary reads "You" gets flagged by banks that match payee to IBAN.
  const epcName = profile.accountHolder || creditor?.name || "";
  const epcParams = {
    name: epcName,
    iban: profile.iban || "",
    amountCents: transfer.amountCents,
    currency,
    reference,
    bic: profile.bic,
  };
  const epcError = validateEpcParams(epcParams);

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

      {methods.length === 0 && epcError && !profile.note && (
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
            <div className="row" key={m.id} style={{ display: "block" }}>
              <p>
                <strong>{m.label}</strong>
                {!m.amountPrefilled && (
                  <span className="field-suffix"> — amount not pre-filled</span>
                )}
              </p>
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
              <div className="field-row">
                <TapButton
                  className="btn btn-secondary"
                  onActivate={() => setShownQr(shownQr === m.id ? null : m.id)}
                >
                  {shownQr === m.id ? "Hide QR" : "Show QR"}
                </TapButton>
                {canSendToChat && (
                  <TapButton
                    className="btn btn-secondary"
                    onActivate={() => {
                      setUsedMethod(m.label);
                      const otherName =
                        direction === "pay" ? creditorName : debtorName;
                      const text =
                        direction === "pay"
                          ? `Paying ${otherName} ${amount} now — ${m.url}`
                          : `Hey ${otherName} — ${amount} whenever you get a chance: ${m.url}`;
                      sendToChat(text);
                    }}
                  >
                    Send to chat
                  </TapButton>
                )}
              </div>
              {shownQr === m.id && <QR payload={m.url} />}
              {m.caveat && <p className="field-suffix">{m.caveat}</p>}
            </div>
          ))}
        </>
      )}

      {!epcError ? (
        <div className="row" style={{ display: "block" }}>
          <p>
            <strong>Bank transfer</strong>
          </p>
          <QR payload={buildEpcPayload(epcParams)} />
          <p>Scan with your banking app.</p>
          <div className="field-row">
            <span className="money">{formatIban(profile.iban || "")}</span>
            <CopyButton
              value={formatIban(profile.iban || "")}
              label="Copy IBAN"
            />
          </div>
          <p>{epcName}</p>
          <div className="field-row">
            <span>{reference}</span>
            <CopyButton value={reference} label="Copy reference" />
          </div>
        </div>
      ) : (
        methods.length > 0 && (
          <p className="field-suffix">
            Bank transfer QR unavailable: {epcError}.
          </p>
        )
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
        <TapButton
          className="btn btn-primary"
          onActivate={() => setConfirming(true)}
        >
          {direction === "pay" ? "Mark as paid" : "Mark as received"}
        </TapButton>
      )}
    </Sheet>
  );
}
