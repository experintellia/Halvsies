# Halvsies

Bill-splitting webxdc mini-app. Preact + TypeScript + Yjs (y-webxdc). See
Plan.md for full spec/scope.

## Commands (pnpm)

- `pnpm dev` — vite dev server on :3000
- `pnpm build` — `tsc --noEmit && vite build` → `dist-xdc/halvsies.xdc`
- `pnpm test` — vitest run
- `pnpm test:peers` — dev server + `webxdc-dev` multi-peer simulator
- `pnpm make-icon` — regenerate `public/icon.png`
- `pnpm check` / `pnpm fix` — prettier

## Webxdc sandbox (non-negotiable)

- No network at runtime: no fetch(), no CDN links, no external URLs anywhere
  in the bundle.
- `webxdc.js` is injected by the messenger — reference it as
  `<script src="webxdc.js"></script>`, never import/bundle it.
- No localStorage for durable data. Durable state goes through the Y.Doc only.
- Size budget: built `.xdc` must stay under 1 MB.
- Build target: es2020 / chrome87 / safari14 / firefox78. No top-level await,
  `Array.at`, `:has()`, `structuredClone`, etc.

## Money & determinism

- Money is always integer cents (`number`) + a currency code string. Never
  floats, never `parseFloat` arithmetic. Format only at render time with
  `formatMoney()` from `src/state/model.ts`.
- Derived computations (balances, simplify) must be deterministic across
  peers: stable sort by id, no `Date.now()`/`Math.random()` inside pure
  functions — pass timestamps in as arguments.

## Known gotchas

- `y-webxdc`'s only export is the **default** `WebxdcProvider` class:
  `import WebxdcProvider from "y-webxdc"`. The README's named-import example
  is wrong. It ships no types; see `src/declarations.d.ts` for the real
  constructor shape (`new WebxdcProvider({ webxdc, ydoc, getEditInfo,
autosaveInterval, resendAllUpdates? })`). Call `provider.syncToChatPeers()`
  to flush — never touch `window.webxdc`'s update IO directly.
- Delta Chat's Android WebView fires `blur` before `click`, even with
  `preventDefault` on `pointerdown` — anything unmounted on blur never gets
  its click. Put tap handlers on `onPointerUp`, gate `onClick` to
  `e.detail === 0` (keyboard activation only). Never use native `<datalist>`
  (renders as a near-full-screen popup there).

## Layout

- `src/state/model.ts` — shared types (Member, Expense, Settlement, …) and
  `formatMoney`/`newId`. Everything else imports from here.
- `src/state/doc.ts` — Y.Doc + provider setup, typed accessors.
- `src/state/balances.ts`, `src/state/simplify.ts` — pure ledger math.
- `src/pay/` — payment link/QR/IBAN generators, pure.
- `src/ui/` — Preact components.
- `test/` — vitest, one file per pure module.
