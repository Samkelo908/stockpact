# StockPact implementation checklist

- [x] Phone and desktop workspace with persistent Cape Town demo accounts and an installable web app.
- [x] Typed and guided purchasing, editable structured drafts, supplier search, progress, RFQs and quote comparison.
- [x] Order, stock reservation, dispatch, quantity acceptance, single-use QR, simulated settlement and reorder.
- [x] Testnet escrow contract, deployment scripts, wallet and receipt verification.
- [x] Authenticated private order attachments, in-app notices, reviews and manual dispute and verification queues.
- [ ] Configure and verify a live Workers AI account, private R2 bucket, Persona templates and webhook, email delivery and external PostgreSQL for a pilot.
- [ ] Deploy the contracts to a funded testnet and validate wallet signing and live receipts with separate participants.
- [x] Supplier photo uploads, private two-way quote conversations and grouped purchase requests with separately quoted and fulfilled lines.
- [x] Separate delivery and XRPL payment status, with buyer recovery for unsigned payments blocked by a mandate.
- [x] Account email verification for joining an invited company and owner controls for removing staff access.
- [ ] Extend procurement to bundled supplier quotes and add independent carrier allocation.
- [ ] Connect testnet driver assignment, dispute settlement, and timeout refunds from the contract to the application screens. Demo-mode reviewer and driver workflows are available in the app.
- [ ] Complete production dispute operations, payment reconciliation, exchange-rate display and fiat rails before settling real value.

## Service boundaries

Workers AI provides draft extraction and optional speech transcription. The local draft parser and browser speech support keep the demo usable without a Cloudflare account. PostgreSQL remains the source of truth for supplier and order records.

StockPact uses demo settlement only when explicitly enabled for the demo. In testnet mode, the application binds wallet identity to company membership and records only successful, matching on-chain receipts. The contract applies pro-rata allocation to the accepted quote total with a final rounding reconciliation. The test token is valueless.

Demo users can switch into fictional companies. Disable demo mode for any pilot using real companies. Persona provides optional hosted capture. Reviewers grant company verification after matching approved provider checks to the company record.

## Visual assets

The new photographs were made with built-in ImageGen and optimised for the app.

- [Cape Town shop delivery](../public/cape-town-shop-delivery.webp) shows a woman shop owner checking a delivery on her phone as a supplier brings in a box of stock. The prompt called for a documentary photograph of an independent Cape Town grocery shop, a golden apron, ordinary grocery shelves, and both people, the phone, and the carton visible in a wide crop.
- The catalogue photos of [chopped tomatoes](../public/listing-tomatoes.webp), [sunflower oil](../public/listing-oil.webp), and [coffee beans](../public/listing-coffee.webp) use a shared prompt for unbranded wholesale stock against a neutral studio backdrop with soft daylight.
