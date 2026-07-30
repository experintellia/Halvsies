# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — unreleased

### Added

- Expense ledger: add, edit, and view expenses with flexible split modes (even, weights, exact amounts)
- Net balances: calculates who owes whom from all expenses and settlements
- Simplified transfer suggestions: greedy min-cash-flow algorithm to minimize number of settlements
- Settlement tracking: record payments via multiple payment methods
- Payment profiles: members attach payment coordinates (PayPal.Me, IBAN, Revolut, Wise, Venmo, Monzo, custom template)
- Pay-up sheet: generate amount-pre-filled payment links for all methods
- EPC QR codes: standardized bank transfer QR for IBAN-based payments (EPC069-12)
- Copy to clipboard: one-tap link copying for fast sharing
- Send to chat: post payment links and settlement announcements to the chat feed
- JSON export/import: snapshot the full expense ledger and share it via chat
- Dark/light theme: automatically follows device `prefers-color-scheme` preference
- Responsive design: works on mobile and desktop webviews
- Multi-peer sync: Yjs CRDT ensures all peers converge to identical state even during concurrent edits or offline periods
