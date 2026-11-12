# StockPact implementation checklist

- [x] Phone and desktop workspace with persistent Cape Town demo accounts and an installable web app.
- [x] Typed and guided purchasing, editable structured drafts, supplier search, progress, RFQs and quote comparison.
- [x] Order, stock reservation, dispatch, quantity acceptance, single-use QR, simulated settlement and reorder.
- [x] Testnet escrow contract, deployment scripts, wallet and receipt verification.
- [x] Authenticated private order attachments, in-app notices, reviews and manual dispute and verification queues.
- [ ] Configure and verify a live Workers AI account, private R2 bucket, Persona templates and webhook, email delivery and external PostgreSQL for a pilot.
- [ ] Deploy the contracts to a funded testnet and validate wallet signing and live receipts with separate participants.
- [ ] Extend supplier catalogue, negotiation and delivery-provider workflows for multi-line quotes and independent carrier allocation.
- [ ] Connect testnet driver assignment, dispute settlement, and timeout refunds from the contract to the application screens. Demo-mode reviewer and driver workflows are available in the app.
- [ ] Complete production dispute operations, payment reconciliation, exchange-rate display and fiat rails before settling real value.

## Service boundaries

Workers AI provides draft extraction and optional speech transcription. The local draft parser and browser speech support keep the demo usable without a Cloudflare account. PostgreSQL remains the source of truth for supplier and order records.

StockPact uses demo settlement only when explicitly enabled for the demo. In testnet mode, the application binds wallet identity to company membership and records only successful, matching on-chain receipts. The contract applies pro-rata allocation to the accepted quote total with a final rounding reconciliation. The test token is valueless.

Demo users can switch into fictional companies. Disable demo mode for any pilot using real companies. Persona provides optional hosted capture. Reviewers grant company verification after matching approved provider checks to the company record.

## Visual assets

The new photographs were made with built-in ImageGen and optimised for the app.

- [Cape Town loading bay](../public/cape-town-loading-bay.webp) depicts a wholesale loading bay near Epping Industria with Table Mountain in the distance, a worker moving yellow produce crates and cartons, and worn concrete in late-afternoon sunlight. The prompt called for documentary framing, warm industrial colours, and unbranded workwear and stock.
- The catalogue photos of [chopped tomatoes](../public/listing-tomatoes.webp), [sunflower oil](../public/listing-oil.webp), and [coffee beans](../public/listing-coffee.webp) use a shared prompt for unbranded wholesale stock against a neutral studio backdrop with soft daylight.
