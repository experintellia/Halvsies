# Manual multi-peer checklist

The unit suite (`pnpm test`) covers the pure modules — split math, balances,
simplification, IBAN, EPC QR, payment links, snapshot validation. What it
cannot cover is the part that only exists inside a real messenger: CRDT sync
between peers, the webxdc host APIs, and the WebView quirks. That is this file.

Run it before every release, and whenever `src/state/doc.ts` changes.

```sh
pnpm test:peers     # vite dev server + webxdc-dev simulator
```

`webxdc-dev` opens one window per simulated peer. Use **three** peers unless a
case says otherwise. "Converge" below always means: leave the app idle a few
seconds, then compare the Balances tab on every peer — same net figures, same
suggested transfers, in the same order.

> Sync is not instantaneous. y-webxdc flushes on an autosave interval (~10 s) and
> on exit, so give each step a moment before calling it a failure.

---

## A. Core sync (M1)

- [ ] **A1 — Late joiner.** Peer 1 adds three expenses. _Then_ open peer 2 for
      the first time. Peer 2 shows all three, with identical balances.
- [ ] **A2 — Self-registration is idempotent.** Reload peer 1 several times. The
      member list still shows one entry for it, not one per reload.
- [ ] **A3 — Concurrent add.** With all peers open, add a different expense on
      peer 1 and peer 2 at the same moment. Both expenses survive on all three
      peers; nothing is lost, nothing is duplicated.
- [ ] **A4 — Concurrent edit of the same expense.** Peers 1 and 2 both edit the
      _same_ expense's amount simultaneously. All peers converge on **the same**
      value — which one wins is not specified (last-write-wins per entry), that
      they agree is.
- [ ] **A5 — Offline merge.** Close peer 3. Add expenses on peers 1 and 2, and a
      settlement on peer 1. Reopen peer 3: it catches up to the same state.
- [ ] **A6 — Remainder determinism.** Add an expense that does not divide evenly
      (e.g. **€10.00 even between 3**). Every peer shows the _same_ member
      carrying the extra cent (3.34 / 3.33 / 3.33, extra cent to the lowest id).
- [ ] **A7 — Settlement zeroes a debt.** Record a settlement covering a suggested
      transfer exactly. That transfer disappears from Balances on every peer.

## B. Chat integration

- [ ] **B1 — Info lines.** Adding an expense posts a line like
      `Simon added *Pizza* — €30.00` into the chat.
- [ ] **B2 — Summary is current.** After adding an expense, the app's summary in
      the chat reads e.g. `1 open debt · €15.00` — **not** "All settled up", and
      **without** anyone having opened the Balances tab first. (This was a real
      bug: the summary used to come from a counter only the Balances screen set.)
- [ ] **B3 — Settlement line.** "Mark as paid" posts `Simon paid Anna €23.50`.

## C. Pay-up helpers (M2) — the differentiator

- [ ] **C1 — Profile visibility.** Fill in a payment profile on peer 2. Peer 1
      opens a debt owed to peer 2 and sees those methods.
- [ ] **C2 — Live preview matches reality.** What the Me tab's "what others see"
      preview renders is what the other peer actually gets in PayUpSheet.
- [ ] **C3 — EPC QR scans.** With a real banking app, scan the bank-transfer QR.
      Verify **IBAN, amount and reference** all pre-fill correctly, and the
      beneficiary name is the account holder — never the literal "You".
- [ ] **C4 — EPC QR is EUR-only.** Set the group currency to `USD`. The bank
      transfer block disappears with an explanation; it returns for `EUR`.
- [ ] **C5 — PayPal.Me link.** Opens with the amount pre-filled.
- [ ] **C6 — Monzo gating.** With group currency `EUR`, no Monzo method is
      offered. Switch to `GBP`: it appears for a £23.50 debt with the
      £1–£100 caveat shown, and is absent for £0.50 and for £150.
- [ ] **C7 — Copy works.** Every Copy button puts the right string on the
      clipboard _on a real device_, not just in the desktop simulator — the
      async clipboard API is unavailable in some webviews and the fallback path
      is what matters here.
- [ ] **C8 — Send to chat.** Posts a tappable message containing the link. If
      the host doesn't support it, the button is **absent** rather than inert.
- [ ] **C9 — Request direction.** From an "X owes you" row, the sheet offers
      _your_ details and a friendly nudge.
- [ ] **C10 — Third-party rows are read-only.** In a 4-person group, open a row
      between two _other_ members. There is no "Mark as paid" button — only a
      note saying who can record it.

## C2. Appendix-A methods

- [ ] **CA1 — Currency gating end to end.** With group currency `EUR`: bunq is
      offered, Cash App and UPI are not. `USD`: Cash App only. `INR`: UPI, and
      its QR scans in a UPI app with the right VPA, amount and note. `GBP`:
      Monzo and Cash App.
- [ ] **CA2 — Crypto never carries an amount.** Copy the crypto URI and read
      it: there is no `amount`/`tx_amount` parameter anywhere. The fiat figure
      is shown beside it as text only.
- [ ] **CA3 — Crypto address is always reachable.** On a device with **no**
      wallet installed, the `bitcoin:`/`monero:` link does nothing when tapped
      — the raw address and its Copy button must still be right there, plus the
      QR. With network `other`, the address block shows even though there is no
      URI at all.
- [ ] **CA4 — Warning pill.** Set group currency to `CHF`, open the add-payment
      wizard: bunq/Cash App/UPI/Monzo show a pill saying they won't be offered.
      Saving is still allowed (you may be about to change the currency).

## C3. Members

- [ ] **CM1 — Add and use a virtual member.** Add "Grandma" from Me →
      Members. She appears as a payer option and a participant on every peer.
- [ ] **CM2 — Removal is blocked while referenced.** Try to remove a member who
      is in an expense: the button is disabled and the reason is shown. Delete
      that expense, and removal succeeds.
- [ ] **CM3 — Removal syncs.** Removing a member on peer 1 removes them on
      peers 2 and 3, and the balances still sum to zero everywhere.
- [ ] **CM4 — A real member returns.** Remove a member who is in the chat.
      When they next open Halvsies they re-register — that is expected, and the
      screen says so.

## D. WebView quirks (do these on a real Delta Chat Android device)

- [ ] **D1 — Tap while an input is focused.** With the keyboard open and the
      amount field focused, tap Save directly. It saves. (This is the
      blur-before-click bug: with `onClick` instead of `onPointerUp`, the first
      tap is swallowed and only dismisses the keyboard.)
- [ ] **D2 — Keyboard doesn't steal the caret.** Open "Add expense": the amount
      field is focused and the keyboard stays up. Then have another peer add an
      expense while you type — your caret and keyboard must survive the
      incoming update.
- [ ] **D3 — Sheet dismissal.** Backdrop tap and hardware Back both close the
      sheet, and focus returns to the button that opened it.
- [ ] **D4 — Two-tap confirmations.** Delete shows "Really delete?" and only
      deletes on the second tap. Same for "Mark as paid". (These must not use
      `window.confirm` — some hosts have no dialog handler and it returns
      `false` instantly, silently doing nothing.)
- [ ] **D5 — Layout.** No clipped rows, no content under the tab bar, sheet
      reachable one-handed. Check light **and** dark (`prefers-color-scheme`).

## E. Import / export

- [ ] **E1 — Round trip.** "Export everything", then "Restore from file" on
      another peer reproduces the same ledger.
- [ ] **E4 — Payment details travel between groups.** In group A, "Export just
      your payment details"; in a _different_ Halvsies chat, "Restore from
      file". Your links appear there, and group B's expenses are **untouched**
      (this file must not behave like a full restore).
- [ ] **E5 — Either file, one button.** Rename the exported files to something
      else. Restore still routes each one correctly — the shape decides, not
      the name.
- [ ] **E2 — Malformed file is refused.** Hand-edit the JSON to set an
      `amountCents` to `-5000`, then import it. It is rejected with a readable
      message and the ledger is untouched — it must **not** import a negative
      expense (that invents a reversed debt on every peer).
- [ ] **E3 — Feature detection.** On a host without `importFiles`, the Restore
      button is absent and the copy says so, rather than promising a path that
      doesn't exist.

## F. Release sanity

- [ ] **F1 — Size.** `du -h dist-xdc/halvsies.xdc` is well under 1 MB.
- [ ] **F2 — No network.** Airplane mode: every screen still works. Payment
      links are the _only_ thing that should need connectivity, and only when
      tapped.
- [ ] **F3 — Fresh install.** Send the `.xdc` into a brand-new chat and complete
      one full loop: add expense → check balance → pay up → mark as paid.
