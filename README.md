# Halvsies

A bill-splitting **webxdc** mini-app for Delta Chat (and other webxdc messengers) with first-class **pay-up helpers**: every debt becomes a few-click payment via generated deep links, EPC QR codes, and send-to-chat flows.

See [webxdc.org](https://webxdc.org/) for more about the webxdc platform.

## What makes it different

Members attach payment coordinates (PayPal.Me, IBAN, Revolut, Wise, Venmo, Monzo, or a custom URL template), and Halvsies generates amount-pre-filled payment links and EPC QR codes so settling a debt takes seconds. No accounts, no server, end-to-end encrypted via the chat.

> Status: early development. See [`./Plan.md`](./Plan.md) for the design and roadmap.

## Screenshots

<table>
  <tr>
    <td width="33%"><img src="docs/screenshots/expenses.png" alt="A list of eight expenses from a trip, each showing who paid, the date, the total and your own share." width="240"></td>
    <td width="33%"><img src="docs/screenshots/expense.png" alt="A read-only summary of one expense, listing what each person owes, with an Edit button." width="240"></td>
    <td width="33%"><img src="docs/screenshots/shares.png" alt="The expense editor with the split set to Shares: each person has a stepper, and one person has two shares, which reads as 50 percent." width="240"></td>
  </tr>
  <tr>
    <td>Every expense, newest first — with your share on each.</td>
    <td>Tapping an expense opens a read-only summary. Editing is a deliberate second tap.</td>
    <td>Split evenly, by shares, or by exact amounts.</td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/balances.png" alt="Each member's net position, then a short list of suggested transfers that settle the whole group." width="240"></td>
    <td><img src="docs/screenshots/payup.png" alt="The pay-up sheet for one debt: a note from the payee, then PayPal and bunq, each with an open link, a copy button and a QR code." width="240"></td>
    <td><img src="docs/screenshots/me.png" alt="Your own payment methods, and below them a preview of exactly what a payer will be shown." width="240"></td>
  </tr>
  <tr>
    <td>Who owes whom, in as few transfers as possible.</td>
    <td>One tap from a debt to actually paying it — link, copy, QR, or straight into the chat.</td>
    <td>Your payment details, previewed exactly as the payer will see them.</td>
  </tr>
</table>

Regenerate them with `node scripts/screenshots.mjs` — it drives the real app in
headless Chrome against a fixed demo ledger, so the output is reproducible.

## Development

### Install

```sh
pnpm install
```

### Run

Runs the Vite dev server:

```sh
pnpm dev
```

### Multi-peer testing

Starts the dev server and the webxdc dev simulator together, for testing several peers against each other:

```sh
pnpm test:peers
```

### Check / lint

```sh
pnpm check        # typecheck + prettier
pnpm fix          # auto-fix formatting
```

### Test

```sh
pnpm test
```

### Build

Produces `dist-xdc/halvsies.xdc`:

```sh
pnpm build
```

Send the `.xdc` into a chat in any webxdc-capable messenger (e.g. Delta Chat).

## Release

Push a `vX.Y.Z` tag; the GitHub Action in `.github/workflows/release.yml` builds the `.xdc` and attaches it to a GitHub Release:

```sh
git tag v0.1.0
git push origin v0.1.0
```

Every push and pull request also runs CI (`.github/workflows/ci.yml`): typecheck, lint and build. PRs automatically get a downloadable preview build linked in the PR comments.

## App store

To list Halvsies on the webxdc app store, open a pull request against [webxdc/hub](https://codeberg.org/webxdc/hub). Note that this is a manual step — it is not automated.

## Privacy

A member's payment profile (payment coordinates, account name, etc.) is visible to everyone in that chat.

## License

MIT
