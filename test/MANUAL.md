# Manual device checklist

Everything a machine can check now **is** checked by a machine:

```sh
pnpm test     # 266 tests, incl. multi-peer sync, chat lines, gating, import/export
pnpm build    # typecheck, bundle, then scripts/audit-bundle.mjs (size + sandbox)
```

Both run in CI, and `pnpm build` gates the release workflow, so a bundle that
breaks the sandbox rules can never reach a GitHub Release.

What is left below is only what a real device can answer. Every item here fails
to automate for the same reason: **the environment lies in a test runner.**
jsdom fires events in spec order, always has a clipboard, always has a URI
handler, and has no idea what a bank app does with a QR code. If you can
automate an item on this list, it does not belong on this list.

Run it before every release. It should take about ten minutes.

```sh
pnpm test:peers     # vite dev server + webxdc-dev simulator, for the desktop parts
```

> Sync is not instantaneous. y-webxdc flushes on an autosave interval (~10 s) and
> on exit, so give each step a moment before calling it a failure.

---

## 1. On a real Delta Chat **Android** device

These are the WebView quirks the whole codebase is shaped around. jsdom cannot
reproduce them — a test asserting them would only be testing our belief about
the bug.

- [ ] **M1 — Tap while an input is focused.** With the keyboard open and the
      amount field focused, tap **Save** directly. It saves on the first tap.
      _(Android fires `blur` before `click`, so with a plain `onClick` the first
      tap is swallowed and only dismisses the keyboard. This is why every tap
      handler in the app is on `onPointerUp`.)_
- [ ] **M2 — The keyboard doesn't steal the caret.** Open "Add expense": the
      amount field is focused and the keyboard stays up. Now have another peer
      add an expense while you type. Your caret, your text and the keyboard all
      survive the incoming update.
- [ ] **M3 — Two-tap confirmations really are two taps.** Delete shows "Really
      delete?" and only deletes on the second. Same for "Mark as paid" and
      "Remove" in Members. _(These must never become `window.confirm` — some
      hosts have no dialog handler, where it returns `false` instantly and the
      action silently does nothing.)_
- [ ] **M4 — Copy works.** Every Copy button puts the right string on the
      clipboard **on the device**, not just in the desktop simulator. The async
      clipboard API is unavailable in some webviews, so the fallback path is the
      one that matters and hardware is the only thing that exercises it.
- [ ] **M5 — Sheet dismissal.** Backdrop tap and the hardware Back button both
      close the sheet, and focus returns to whatever opened it.
- [ ] **M6 — Layout.** No clipped rows, nothing hidden under the tab bar, sheets
      reachable one-handed. Check light **and** dark. Then repeat with a long
      member name and a long expense title — the automated tests assert the CSS
      rules exist, not that the result looks right.

## 2. Things only another app can confirm

- [ ] **M7 — The EPC QR scans.** With a real banking app, scan the bank-transfer
      QR. **IBAN, amount and reference** all pre-fill, and the beneficiary is the
      account holder's name — never the literal "You". _(The payload bytes are
      asserted in `test/epcqr.test.ts`; that a bank accepts them is not something
      this repo can know.)_
- [ ] **M8 — The UPI QR scans** in a UPI app, with the right VPA, amount and
      note. _(The payload string is asserted; the scan is not.)_
- [ ] **M9 — The QR Platba code scans.** With group currency `CZK` and a
      Czech IBAN, scan the bank-transfer QR with a Czech banking app: account,
      amount and message all pre-fill. The payload is asserted in
      `test/spd.test.ts`; that a Czech bank accepts it is not something this
      repo can know. Also confirm no QR appears for a CZK debt in a _non_-Czech
      banking app's scanner — a code that looks generic but isn't is the
      failure mode this gate exists to avoid.
- [ ] **M10 — Crypto links degrade properly.** On a device with **no** wallet
      installed, tap a `bitcoin:` link. It does nothing — and that is fine,
      because the raw address, its Copy button and the QR are right there
      anyway. This is the whole reason the address is never hidden behind the
      link.
- [ ] **M11 — Send to chat.** Posts a tappable message containing the link, and
      it opens from the chat. _(That the button is absent on a host lacking
      `sendToChat` is covered by `test/host.test.tsx`; that the posted message is
      usable is not.)_

## 3. Cross-messenger and release

- [ ] **M12 — Older webviews.** Open the app on Delta Chat iOS and desktop, and
      on the oldest webview you can reach (Ubuntu Touch is the known floor).
      `scripts/audit-bundle.mjs` smoke-checks the emitted syntax against the
      es2020 / chrome87 / safari14.1 / firefox78 target, but it is a grep, not a
      parser, and it says nothing about CSS support or host API level.
- [ ] **M13 — Fresh install, full loop.** Send the `.xdc` into a brand-new chat
      and do the whole thing once: add expense → check balance → pay up → mark
      as paid. On a second device, in the same chat.
- [ ] **M14 — Airplane mode.** Every screen still works with no connectivity.
      Payment links are the _only_ thing that should need the network, and only
      once tapped.

---

## What used to be here

These were manual items until 2026-08-01. They are automated now; the mapping is
recorded so that if one of these tests is ever deleted, it is obvious which
manual check has to come back.

| Was                             | Now covered by                                                   |
| ------------------------------- | ---------------------------------------------------------------- |
| A1 late joiner                  | `A1 — a late joiner replays every expense…` (convergence)        |
| A2 self-registration idempotent | `A2 — registers the local user exactly once…` (host)             |
| A3 concurrent add               | `A3 — concurrent adds on two peers all survive…` (convergence)   |
| A4 concurrent edit converges    | `agrees on one value when both peers edit…` (convergence)        |
| A5 offline merge                | `A5 — a peer that was closed catches up…` (convergence)          |
| A6 remainder determinism        | `A6 — the extra cent of €10.00 between three…` (convergence)     |
| A7 settlement zeroes a debt     | `A7 — a settlement covering a suggested transfer…` (convergence) |
| B1–B3 chat info lines           | `B1` / `B2` / `B3` (convergence + host)                          |
| C1 profile visibility           | `C1 — a profile filled in on one peer…` (convergence)            |
| C2 preview matches reality      | `C2 — the "what others see" preview lists exactly…` (render)     |
| C4 EPC is EUR-only              | `C4 — the bank transfer block is EUR-only…` (render)             |
| C5 PayPal amount pre-filled     | `C5 — the PayPal link carries the amount…` (render)              |
| C6 Monzo gating                 | `C6 — Monzo is offered for £23.50 only…` (render)                |
| C8 send-to-chat feature gate    | `C8 — offers no Send-to-chat button…` (host)                     |
| C9 request direction            | `C9 — a debt owed to you shows your own details…` (render)       |
| C10 third-party rows read-only  | `C10 — a debt between two other members is read-only` (render)   |
| CA1 currency gating             | `describe("currency gates")` (links)                             |
| CA2 crypto carries no amount    | `never embeds an amount, in any network` (links)                 |
| CA4 currency warning pill       | `CA4 — pills bunq, Cash App, UPI and Monzo in CHF…` (render)     |
| CM1–CM4 members                 | `CM1`…`CM4` (convergence + render + host + members)              |
| E1–E5 import/export             | round trip, E2 negative amount, E4 profile-only, E5 by shape     |
| F1 size budget                  | `scripts/audit-bundle.mjs` — fails the build                     |
| F2 no network in the bundle     | `scripts/audit-bundle.mjs` — fails the build                     |

Two known gaps in the automated coverage, for honesty:

- y-webxdc attaches `info` only to the **first** update of a session, so the
  chat-line tests assert `editInfo()` — the function the provider calls — rather
  than an intercepted `sendUpdate`.
- The provider's ~10 s autosave loop is bypassed; every writer calls `flush()`
  synchronously and that is what the tests drive. **M13** is what actually
  exercises the timer.
