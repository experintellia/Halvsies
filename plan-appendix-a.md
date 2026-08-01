# Appendix A — Expanded payment methods (bunq, Cash App, UPI, crypto)

> **How to use this file:** drop it next to `plan.md` in the repo root and tell Claude Code:
> *"Read plan-appendix-a-payment-methods.md and merge it into plan.md and the codebase: extend the payment-profile model and the M2 link generators as specified. Skip anything already implemented."*
> It amends the M2 (pay-up helpers) milestone; nothing in M1/M3/M4 changes.

## A.1 Payment-profile model changes

Extend the per-member `PaymentProfile` in `src/state/model.ts` with:

```ts
bunqMe?: string      // bunq.me handle
cashtag?: string     // Cash App $cashtag (store without the "$")
upiVpa?: string      // UPI virtual payment address, e.g. anna@upi
crypto?: { label: string, address: string, network?: string }
// existing fields (paypalMe, iban/bic/accountHolder, revolutTag, wiseTag,
// venmo, monzoMe, custom, note) stay unchanged
```

## A.2 New link generators (`src/pay/links.ts`)

All pure functions, unit-tested, currency-gated (a method is only offered when the debt's currency matches):

| Method | Format | Gate & notes |
|---|---|---|
| bunq | `https://bunq.me/<name>/<amount>/<description>` → `https://bunq.me/anna/23.50/Halvsies%20Rome%20trip` | EUR only. URL-encode the description. Payer needs **no** bunq account (landing page offers iDEAL/Wero, Bancontact, Visa/Mastercard, Apple/Google Pay). iDEAL capped at €2,000 — hint in UI above that amount. |
| Cash App | `https://cash.app/$<cashtag>/<amount>` → `https://cash.app/$anna/23.50` | USD or GBP. Amount in path; **no note parameter exists** — don't invent one. |
| UPI | `upi://pay?pa=<vpa>&pn=<name>&am=<amount>&cu=INR&tn=<note>` | INR only. Fully static deep link — also render it as a QR (same offline pattern as the EPC QR, reuse the QR component). |
| Crypto | `bitcoin:<address>` / `ethereum:<address>` / `monero:<address>?tx_description=<ref>&recipient_name=<name>` URI + QR, **amount-only-in-fiat display** | Any currency. **Never embed a crypto amount** (Monero's `tx_amount` param exists but stays unused): the ledger stays fiat-denominated and the app has no exchange rates (no network). Show the fiat debt ("€23.50") next to the QR; the payer's wallet (which does have internet) converts at pay time. Monero's `tx_description`/`recipient_name` params do carry the reference and creditor name (URL-encoded, RFC 3986). Stablecoin users note the token in `crypto.label`. Settlement is recorded manually via "mark as paid", like cash. |

Reminder of the already-specced Monzo generator (include if not yet built): `https://monzo.me/<user>/<amount>?d=<reference>` — GBP only, £1–£100 per payment, recipient max £1,000/30 days; payer needs no Monzo account.

## A.3 PayUpSheet changes

- Method list per creditor is filtered by currency gate; each entry still offers all four outputs: tappable link, copy, QR where applicable (SEPA, UPI, crypto, PayPal), and `webxdc.sendToChat`.
- `ProfileForm`: add the four new fields with format validation (cashtag charset, VPA `local@handle` shape, address non-empty). Crypto field shows a one-line hint: "Amount is not embedded — the payer's wallet converts the € amount." The `network` field selects the URI scheme (bitcoin / ethereum / monero / none for anything else).
- **Crypto fallback is mandatory:** many devices have no handler registered for `bitcoin:`/`ethereum:`/`monero:` URIs, so tapping the link may do nothing. The crypto entry must always display the **raw address in full, with its own copy button** (plus a separate copy button for the URI), in addition to the QR. Never show only the link.

## A.4 Explicitly NOT supported as generators

No static/templatable public link format exists (links are minted per-request in their apps, or they work via phone number only): **Tikkie (NL), Swish (SE), Vipps (NO), MobilePay (DK/FI), Twint (CH), Bizum (ES), Blik (PL), Zelle (US), Interac (CA)**. Do not attempt generators for these; they're covered by the profile `note` and the custom `{amount}`/`{currency}`/`{ref}` URL template. Watch **Wero** for a future P2P link standard. Brazil's **PIX** BR Code *is* offline-generatable (EMV QR + CRC16) and is a good M3+ candidate if Brazilian users show up.

## A.5 New/updated tests

- Link builders: exact expected URLs for each method incl. URL-encoding of descriptions and amount formatting (always dot-decimal, two digits, from integer cents).
- Currency gating: EUR debt ⇒ bunq+PayPal+SEPA offered, Monzo/CashApp/UPI hidden; GBP ⇒ Monzo+CashApp(+PayPal); INR ⇒ UPI; crypto always.
- UPI QR payload equals the deep-link string.
- Crypto: assert generated URI contains **no** amount parameter (incl. no `tx_amount` for Monero); Monero URI carries URL-encoded `tx_description`/`recipient_name`; raw address is always exposed alongside the URI.
