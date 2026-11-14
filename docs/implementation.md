# StockPact implementation checklist

- [x] Phone and desktop workspace with persistent Cape Town demo accounts, an installable web app and a signed Android APK for the private demo.
- [x] Typed and guided purchasing, editable structured drafts, supplier search, progress, RFQs and quote comparison.
- [x] Order, stock reservation, dispatch, quantity acceptance, single-use QR, simulated settlement and reorder.
- [x] Native XRP Ledger Testnet autopay with buyer mandates, an independently enforced signing policy and a recorded validated payment. A second handover in the same demo was recorded with its payment blocked by the total cap.
- [x] Separate EVM testnet escrow contract, deployment scripts, wallet and receipt verification.
- [x] Authenticated private order attachments, in-app notices, reviews and manual dispute and verification queues.
- [x] Verify live Workers AI drafting and transcription through the private demo workspace.
- [ ] Provision the Firebase SQL Connect-associated Cloud SQL for PostgreSQL pilot database, migrate and verify records, and configure the pilot’s storage, identity verification and email delivery.
- [ ] Verify the optional EVM escrow configuration with the intended deployed contracts, wallet accounts and testnet for the pilot.
- [x] Supplier photo uploads, private two-way quote conversations and grouped purchase requests with separately quoted and fulfilled lines.
- [x] Separate delivery and XRPL payment status, with buyer recovery for unsigned payments blocked by a mandate.
- [x] Account email verification for joining an invited company and owner controls for removing staff access.
- [ ] Extend procurement to bundled supplier quotes and add independent carrier allocation.
- [ ] Connect testnet driver assignment, dispute settlement, and timeout refunds from the contract to the application screens. Demo-mode reviewer and driver workflows are available in the app.
- [ ] Complete production dispute operations, payment reconciliation, exchange-rate display and fiat rails before settling real value.

## Service boundaries

Workers AI provides draft extraction, optional speech transcription and the request-or-hold decision for native XRPL Testnet autopay. The local draft parser and available browser speech support let users draft requests without a Cloudflare account. An unavailable AI decision leaves the native Testnet payment waiting for a valid decision. PostgreSQL or local PGlite stores the marketplace and settlement records.

Database demo settlement records fictional reserves and releases. Native XRP Ledger Testnet autopay uses the server’s test signing account and records validated matching payments. The separate EVM testnet escrow flow binds browser wallet identity to company membership and verifies successful matching contract receipts. Test assets are valueless. [Ripple setup](ripple-demo.md) · [EVM escrow setup](../contracts/README.md)

Demo users can switch into fictional companies. Disable demo mode for any pilot using real companies. Persona provides optional hosted capture. Reviewers grant company verification after matching approved provider checks to the company record.

## Visual assets

The new photographs were made with built-in ImageGen and optimised for the app.

- [Cape Town shop delivery](../public/cape-town-shop-delivery.webp) shows a woman shop owner checking a delivery on her phone as a supplier brings in a box of stock. The prompt called for a documentary photograph of an independent Cape Town grocery shop, a golden apron, ordinary grocery shelves, and both people, the phone, and the carton visible in a wide crop.
- The catalogue photos of [chopped tomatoes](../public/listing-tomatoes.webp), [sunflower oil](../public/listing-oil.webp), and [coffee beans](../public/listing-coffee.webp) use a shared prompt for unbranded wholesale stock against a neutral studio backdrop with soft daylight.
