# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] — 2026-10-14

### Added

- Merge a member into yourself (#14). After importing a backup from another
  chat, or when someone added by hand starts using the app, tap "That's me" in
  the Members sheet; an import also asks once "Were you in this group before?".
  A merge is a tombstone the ledger reads through, so concurrent merges and
  edits never collide. First run offers "Import a backup instead".
- Members who don't use the app (#16). The pay sheet says to pay them however
  you usually do and mark it as paid, offers "Copy request" instead of asking
  in a chat they aren't in, and lets you add their payment details. Anyone may
  record a payment between two such members.
- Swipe a sheet down to close it (#12). A sheet with unsaved input springs
  back instead.

### Changed

- The expense form, currency picker and payment-method wizard open as
  full-screen pages instead of tall sheets (#12).
- Save on the expense form and the payment-method wizard stays reachable
  (#15): pressing it early says what's missing instead of doing nothing.
  Enter in a field does the same, and saves when the form is valid.
- An accessibility pass (#12): pinch-zoom is allowed, focus is never lost
  when a sheet or page closes, actions are announced to screen readers, and
  layouts reflow at 200% text.

### Fixed

- iOS: the page no longer scrolls, bounces or stays shifted up after the
  keyboard closes; only the list scrolls, and the header, tab bar and add
  button stay put. The date field no longer pokes out of the form (#12).
- Pressing Enter twice on "Mark as paid" can no longer skip the confirmation
  (#12).
- Emoji in member names stay whole in avatar initials instead of rendering
  as "�" (#11).

## [0.2.0] — 2026-10-12

### Changed

- A design pass over every screen (#1): a calmer palette with more than two
  steps, a real type and spacing scale, grouped lists instead of a card per
  row, icons used as a language rather than only in the tab bar, and designed
  empty states. Light and dark both.
- Group settings moved off the Me tab. Tap the group name, or the gear next to
  it, at the top of any tab.
- The Me tab is one row per payment method, each saying what a payer gets
  ("Fills in amount" or "Payer types amount"). Remove lives in the method's
  edit view, so the tab carries no red buttons. The second list of raw URLs is
  gone: "See what payers see" opens the real pay-up sheet for a sample €10
  debt.
- The pay-up sheet shows one method at a time behind a switcher, with the
  payee's note on top as a chat bubble and the amount in large type.
- Balances leads with what you owe (or are owed) and one button to settle it.
  Everyone's net position is a diverging bar list, so it no longer looks like
  the tappable transfers below it.
- Expenses opens with what the group spent and your share, each day shows its
  total, and every expense carries a bar scaled to its size.

### Added

- A preferred payment method. Tick it in a method's edit view and the pay-up
  sheet opens on it, lists it first and says so. Stored as an optional
  `preferred` field on the profile; older peers ignore it.

### Fixed

- The chat line for a settled debt names who paid. When the person being paid
  recorded it with "Mark as received", the line read "Bob paid Bob" instead of
  "Anna paid Bob".

## [0.1.1] — 2026-08-02

### Fixed

- The first-run setup screen no longer flashes past on every open. App decided
  "needs setup" from the document before webxdc had replayed the chat history
  into it — a real round trip on a device — so the answer was read before it
  had arrived. It now waits for the host to signal that replay is done.
- No more phantom "Someone joined the split" in the chat. A brand-new document
  defaulted its pending chat-info line to a join by nobody, so the first flush
  of a session — usually `setSettings` from finishing setup, which has nothing
  of its own to announce — posted it. Writers with nothing to say are now
  silent instead of inheriting a stale or invented announcement.

### Changed

- The wrapper around `window.webxdc` delegates to the host rather than copying
  its methods, and tolerates a host whose `setUpdateListener` returns nothing
  thenable — an older API level than the rest of the app already assumes.
  Without it, the oldest supported webviews would have rendered a blank app.

## [0.1.0] — 2026-08-02

First beta. Milestones M1 (ledger) and M2 (pay-up helpers) of
[`Plan.md`](./Plan.md) are complete; M3 comfort features and M5 partial
payments are not started.

### Added

**Expenses**

- Add, edit and delete expenses; tapping one opens a read-only summary, so
  editing is always a deliberate second tap
- Three split modes: evenly, by shares (with steppers and live proportions), or
  by exact amounts
- The list is grouped by day, newest first, with your own share on every card
- Remainder cents are distributed deterministically, so every peer computes the
  same split

**Balances**

- Net position per member, and suggested transfers that settle the whole group
  in as few payments as possible
- Record a settlement from either side, behind a two-tap confirmation

**Paying up**

- Payment profiles: IBAN (with holder and BIC), PayPal.Me, Revolut, Wise,
  Venmo, Monzo, bunq, Cash App, UPI, crypto addresses, and any number of custom
  URL templates — plus a free-text note about how you prefer to be paid
- Every debt opens a sheet with an amount-pre-filled link, a copy button and a
  QR code per method
- Bank transfers show holder, IBAN, BIC and reference as separate copyable
  fields, with an **EPC069-12** QR for euro debts and **SPD (QR Platba)** for
  Czech koruna
- "I'm paying now" announces a payment in the chat; "Ask for the money" posts
  one message listing every way to pay
- A "what others see" preview on the Me tab, generated by the same code the
  payer's sheet runs, so the two cannot drift
- Methods a currency excludes stay visible with a pill explaining why, rather
  than silently disappearing

**The group**

- First-run setup asks for currency and name before writing anything to the
  document — opening the app out of curiosity and closing it again leaves no
  trace in the chat
- Searchable currency picker, with a suggestion based on the device language
- Members register themselves from the chat; people who aren't in it can be
  added by hand, and removed again as long as no expense references them
- Backup: export or restore the whole ledger as JSON, or just your own payment
  profile, to carry it into another group

**Platform**

- Multi-peer sync over Yjs CRDT (`y-webxdc`): concurrent edits, late joiners
  and offline peers all converge on identical balances
- Chat info lines and a live summary of open debts
- Follows the device's light/dark preference
- No network at runtime, no localStorage for durable state, and a build that
  fails if the bundle breaks either rule or outgrows its 1 MB budget
