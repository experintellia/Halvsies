# plan.md — Halvsies

A bill-splitting **webxdc** mini-app for Delta Chat (and other webxdc messengers) with first-class **pay-up helpers**: every debt becomes a few-click payment via generated deep links, EPC QR codes, and copy/send-to-chat flows.

This file is the working plan for building the project with Claude Code. Work through milestones in order; check off tasks as they land. Keep this file updated — it is the source of truth for scope and status.

---

## 1. Product summary

Core loop (same as Splitwise/Tricount, but living inside a chat, no accounts, E2E-encrypted):

> add expenses (who paid, how much, for whom, split how) → running balances → simplified "who owes whom" → **pay up via the creditor's payment profile** → record settlement.

Differentiator vs. Divvy Bill / Split Bill: members attach payment coordinates (PayPal.Me, IBAN, Revolut, Wise, custom URL templates), and the app generates amount-pre-filled payment links and EPC QR codes so settling a debt takes seconds.

## 2. Tech stack & hard constraints

- **Preact + TypeScript**, JSX via Vite. State: Yjs + **y-webxdc** provider (CRDT sync over webxdc updates).
- **Vite** build → self-contained `dist-xdc/app.xdc` (ZIP with `index.html`, `manifest.toml`, `icon.png`). Use `vite-plugin-singlefile` or a zip build step; verify no external requests remain.
- QR generation: `qrcode-generator` (or similar ≤20 KB, zero-dependency), bundled.
- Dev harness: `webxdc-dev` (npm) to simulate multiple peers locally.
- **Webxdc sandbox rules (non-negotiable):**
  - No network access. No CDN links, no fetch to external URLs, no live FX rates.
  - `webxdc.js` is injected by the messenger — reference `<script src="webxdc.js">`, never bundle it.
  - No reliance on localStorage for important data (can be wiped); durable state goes through Yjs → webxdc updates.
  - External links may or may not open depending on messenger version ⇒ copy button, QR, and `webxdc.sendToChat()` are first-class paths, never fallbacks.
  - Size budget: **< 1 MB** `.xdc`.
- Money is always **integer cents** + currency code. Never floats. All derived computations (balances, simplification) must be **deterministic** (stable sort by id) so every peer renders identical results.
- License: choose before first commit (AGPL-3.0 if any Divvy Bill code is ever borrowed; otherwise MIT/Apache-2.0 is fine).

## 3. Repository layout

```
halvsies/
├── plan.md                 # this file
├── CLAUDE.md               # short: commands, constraints, conventions (create in M1)
├── manifest.toml           # name = "Halvsies", source_code_url
├── icon.png
├── index.html
├── package.json            # pnpm
├── vite.config.ts
├── src/
│   ├── main.tsx            # mount app, init provider
│   ├── state/
│   │   ├── doc.ts          # Y.Doc setup, y-webxdc provider, typed accessors
│   │   ├── model.ts        # types: Member, PaymentProfile, Expense, Settlement, Settings
│   │   ├── balances.ts     # pure: net balances from expenses+settlements
│   │   └── simplify.ts     # pure: min-cash-flow transfer suggestions
│   ├── pay/
│   │   ├── links.ts        # pure: link generators (paypal.me, revolut, wise, venmo, custom template)
│   │   ├── epcqr.ts        # pure: EPC069-12 payload builder + validation
│   │   └── iban.ts         # pure: IBAN mod-97 checksum, formatting
│   ├── ui/
│   │   ├── App.tsx         # tab shell: Expenses | Balances | Me
│   │   ├── ExpenseList.tsx / ExpenseForm.tsx
│   │   ├── Balances.tsx    # net balances + transfer suggestions + PayUp buttons
│   │   ├── PayUpSheet.tsx  # the differentiator screen
│   │   ├── ProfileForm.tsx # my payment profile editor + live preview
│   │   └── components/     # shared bits (Amount input, Avatar, Sheet, QR)
│   └── style/
└── tests/                  # vitest, for all pure modules
```

## 4. Data model (Yjs)

```ts
// Y.Map "settings"
{ groupCurrency: string /* "EUR" */, title?: string }

// Y.Map "members"  (key: memberId)
{ id, name, isVirtual: boolean, addr?: string /* webxdc.selfAddr for real members */ }

// Y.Map "profiles" (key: memberId, self-edited only)
{ paypalMe?, iban?, accountHolder?, bic?, revolutTag?, wiseTag?, venmo?, monzoMe?,
  custom?: { label: string, urlTemplate: string /* {amount} {currency} {ref} */ },
  note? }

// Y.Map "expenses" (key: expenseId; ulid-style ids for stable ordering)
{ id, title, amountCents: number, payerId,
  split: { mode: "even" | "weights" | "exact",
           entries: Record<memberId, number> },  // weights or cents
  date: string /* ISO */, category?: string, createdBy, editedAt }

// Y.Map "settlements" (key: settlementId)
{ id, fromId, toId, amountCents, method?: string, date, createdBy }
```

Identity: on first open, auto-register self as member via `webxdc.selfAddr`/`selfName`. Virtual members ("Grandma") can be added manually and later merged with a real member.

## 5. Milestones

### M1 — Core ledger (parity with Divvy Bill)

- [x] Scaffold: Vite + Preact + TS + pnpm; `webxdc-dev` script; zip build producing `dist-xdc/halvsies.xdc`; CI-able `pnpm build && pnpm test`.
- [x] `CLAUDE.md` with commands, webxdc constraints, money/determinism rules.
- [x] Yjs doc + y-webxdc provider wired; self-registration of members; late-joiner replay works.
- [x] Expense CRUD. Form: amount-first; payer defaults to self; participants default to all; split defaults to even; weights and exact-amounts one tap away. Even-split remainder cents distributed deterministically (by member id order).
- [x] `balances.ts`: net balance per member from expenses + settlements. Pure, unit-tested (sum of balances === 0 always).
- [x] `simplify.ts`: greedy min-cash-flow transfer suggestions. Pure, deterministic, unit-tested (suggested transfers exactly zero all balances).
- [x] Balances screen: net per member + suggested transfers list.
- [x] Record settlement ("mark as paid" without pay-up yet) → posts `sendUpdate` info line ("Simon paid Anna €23.50").
- [x] Chat integration: info lines on add/edit ("Simon added *Pizza* — €30.00"), summary ("3 open debts · €57.20") via provider `getEditInfo`.
- [x] JSON export/import (full doc snapshot) via `webxdc.sendToChat` file / `importFiles`.
- [x] Dark/light theme following `prefers-color-scheme`; responsive mobile+desktop.
- **Done when:** 3 simulated peers in `webxdc-dev` can add/edit expenses (incl. concurrently/offline), all converge to identical balances and suggestions; tests green; `.xdc` < 1 MB.

### M2 — Pay-up helpers ⭐ (the differentiator)

- [x] `ProfileForm`: edit own payment profile; IBAN mod-97 validation, PayPal.Me handle format check; live preview "what others see"; hint that the profile is visible to this chat's members.
- [x] `links.ts` generators (pure, tested):
  - PayPal: `https://paypal.me/<user>/<amount><CUR>` e.g. `/23.50EUR`
  - Revolut: `https://revolut.me/<tag>` · Wise: `https://wise.com/pay/me/<tag>` · Venmo: `https://venmo.com/u/<user>`
  - Monzo (UK, GBP only): `https://monzo.me/<user>/<amount>?d=<reference>` e.g. `https://monzo.me/anna/23.50?d=Halvsies%3A%20Rome%20trip`. Payer needs no Monzo account (UK debit card / Apple Pay / Google Pay). Enforce limits in UI hint: £1–£100 per payment, recipient max £1,000 per 30 days. Only offer when debt currency is GBP.
  - Custom template: substitute `{amount}` `{currency}` `{ref}`; treat as power-user escape hatch (Twint, MobilePay, PayNow…).
- [x] `epcqr.ts`: EPC069-12 payload (`BCD/002/1/SCT/BIC?/Name/IBAN/EUR23.50/…/reference`) + render QR in-app. Reference auto-set to group/expense context ("Halvsies: Rome trip").
- [x] `PayUpSheet`: from a debt row ("You owe Anna €23.50") show Anna's available methods, amount pre-filled. Per method offer **all** of: tappable link, copy-to-clipboard, QR (bank + PayPal), and **Send to chat** (`webxdc.sendToChat({text})` — link lands as tappable chat message and doubles as "I'm paying now" announcement).
- [x] "Mark as paid" from the sheet → settlement recorded, info line posted, balances update.
- [x] Reverse direction: from "Anna owes you" row, **Request** generates your own link/QR and sends a friendly nudge to chat.
- **Done when:** end-to-end on a real device: open debt → PayUpSheet → banking app scans EPC QR with correct IBAN/amount/reference; PayPal.Me link opens pre-filled; settlement zeroes the debt on all peers.

### M3 — Comfort features

- [ ] In-form calculator (evaluate `12+7.5*2` in amount field).
- [ ] Multi-currency: expenses in any currency; user-pinned manual rates per currency (no network ⇒ no live FX; copy Splid's model); balances shown in group currency.
- [ ] Categories + simple stats view (totals per category/member; keep charts dependency-free or tiny).
- [ ] Recurring expense templates (rent, streaming) — one-tap re-add, no background jobs (webxdc apps only run when open).
- [ ] CSV export of expense list via `sendToChat`.
- [ ] Merge virtual member into real member (reassign ids).

### M4 — Polish & release

- [ ] Icon, `manifest.toml` (name = "Halvsies"); optionally register `halvsies.app` (appeared unregistered as of 2026-07-30).
- [ ] Size audit (< 1 MB), bundle inspection for accidental external refs.
- [ ] Cross-messenger testing: Delta Chat Android/iOS/desktop, older webviews (avoid too-new JS/CSS features; Ubuntu Touch webview is the known floor).
- [ ] Accessibility pass (labels, contrast, focus order) + German/English i18n (simple dict, `navigator.language`).
- [ ] README with screenshots; submit to the webxdc app store (`webxdc.org/apps`, via codeberg.org/webxdc/hub PR).

## 6. Testing strategy

- **vitest** for all pure modules: `balances`, `simplify`, `links`, `epcqr`, `iban`, split math (remainder distribution). Property-style checks: balances always sum to zero; simplify output zeroes balances with ≤ n−1 transfers; EPC payload field lengths per spec.
- Multi-peer sync smoke tests via `webxdc-dev` (manual checklist in `tests/MANUAL.md`: concurrent edit, offline merge, late join).
- No network in tests — everything must run offline by construction.

## 7. Conventions

- Integer cents everywhere; format via `Intl.NumberFormat` at render time only.
- All derived data computed from the Y.Doc in pure functions — components never mutate state except through typed accessors in `state/doc.ts`.
- Ids: ULID-like sortable strings (timestamp passed in, not `Date.now()` inside pure functions — keep functions testable).
- Commits per task checkbox; conventional-commit style messages.
- After each milestone: update this file (check boxes, note deviations). ~~bump
  `manifest.toml` version~~ — **correction:** the webxdc manifest has no
  `version` field (it takes `name` and `source_code_url` only). The version
  lives in `package.json` and the `vX.Y.Z` git tag that triggers the release.

## 7a. Deviations from this plan (M1 + M2, 2026-07-30)

- **Artifact name** is `dist-xdc/halvsies.xdc`, not `app.xdc`. `webxdcViteConfig()`
  hardcodes `app.xdc` with no override, so `vite.config.ts` composes the same
  plugin set by hand (`buildXDC({outFileName}) + eruda + mockWebxdc +
  secureContext`) instead of calling it.
- **`y-webxdc` 1.3.0**, not 1.2.0. 1.3.0 ships its own types and exports
  `WebxdcProvider` as a **named** export; up to 1.2.0 it was an untyped
  *default* export. There is deliberately no local `declare module "y-webxdc"` —
  it would shadow the real types and let `tsc` pass while the bundler fails
  (which is exactly what happened before it was removed).
- **No `vite-plugin-singlefile`** (§2 offered it as an option): unnecessary,
  `buildXDC` already zips.
- **Manual checklist lives at `test/MANUAL.md`**, not `tests/MANUAL.md` — one
  test directory, not two near-identical ones.
- **Browser floor is `safari14.1`**, not `safari14`: the layout uses flexbox
  `gap`, which WebKit shipped in 14.1. Declared honestly in `vite.config.ts`
  rather than hand-rolling margin fallbacks for a population that no longer
  exists.
- **`build.modulePreload.polyfill` is off** so the bundle contains no `fetch(`
  at all — it was dead code in a single-chunk build, but "no network calls" is
  worth keeping greppable.
- **M3 is not started.** M4 is partially done: license (MIT), README, CI +
  release workflow, icon, size audit. Cross-messenger testing, i18n, the
  accessibility pass and the app-store submission are outstanding.

## 8. Open questions / risks

- External-link opening varies by messenger version → UX treats copy/QR/sendToChat as primary (already designed in).
- PayPal.Me availability varies by country/account; validate format only, let users test via profile preview.
- Name decided: **Halvsies** ("going halvsies"). No competing app found in the payments/splitting space as of 2026-07-30; halvsies.com is taken (unrelated), halvsies.app looked unregistered. ~~License still to be decided before first release~~ — **decided: MIT** (no Divvy Bill code was borrowed, so the AGPL trigger in §2 never applied).
- Monzo.me amount-links are GBP/UK only and capped (£100/payment) — the generator must currency-gate this method and surface the cap, so users aren't handed a link that fails for a €230 debt.
- Regional QR standards (Swiss QR-bill, BezahlCode) — covered by custom template for now; revisit after user feedback.
