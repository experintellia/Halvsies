# Halvsies

A bill-splitting **webxdc** mini-app for Delta Chat (and other webxdc messengers) with first-class **pay-up helpers**: every debt becomes a few-click payment via generated deep links, EPC QR codes, and send-to-chat flows.

See [webxdc.org](https://webxdc.org/) for more about the webxdc platform.

## What makes it different

Members attach payment coordinates (PayPal.Me, IBAN, Revolut, Wise, Venmo, Monzo, or a custom URL template), and Halvsies generates amount-pre-filled payment links and EPC QR codes so settling a debt takes seconds. No accounts, no server, end-to-end encrypted via the chat.

> Status: early development. See [`./Plan.md`](./Plan.md) for the design and roadmap.

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

Open multiple simulated peers in the webxdc dev simulator (requires `pnpm dev` to be running in another terminal):

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
