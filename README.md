# StockPact

StockPact is a phone-first procurement workspace for South African businesses. It connects purchasing, supplier quotes, order fulfilment and delivery acceptance in one company account.

## Start the private local demo

Use Node.js 22.18 or later and npm.

```sh
npm ci
npm run dev
```

Open [StockPact locally](http://localhost:3000). The local demo seeds fictional Cape Town businesses and opens the buyer workspace. Use the account menu to switch between the buyer, two suppliers, a driver and a reviewer. Data persists in `.stockpact/db`. To reset it, stop the app, copy `.env.example` to `.env.local` with `STOCKPACT_DEMO=true`, and run `npm run demo:reset`.

On a phone, use **Add to Home Screen** from a supported browser over HTTPS. The production build serves an installable web app. Camera and microphone use require a secure browser context. Enter the handover token manually if a camera is unavailable.

To use a production build for a local demo, copy [the environment example](.env.example) to `.env.local`, leave `STOCKPACT_DEMO=true`, and run `npm run build` followed by `npm start`. Keep this demo instance private.

## Demonstrate a purchase

1. Open the purchasing assistant. Try “I need 20 cases of still bottled water delivered to Woodstock, Cape Town by Friday.” Review the editable draft and set a future date if needed.
2. Find suppliers. The progress indicator follows the matching request. Select the suppliers to invite and send the RFQ.
3. Switch to each invited supplier to submit a different delivered price. Return to the buyer to compare the quotes and accept a version. The accepted quote reserves stock.
4. Open the order and fund the labelled demo escrow. Switch to the winning supplier and dispatch.
5. Return to the buyer, enter 12 accepted cases, review the exact release, and generate the handover QR. Scan it from the supplier account or paste the token into the scanner. Review the release and confirm. A second attempt with the same token is rejected.
6. Repeat for the remaining eight cases. Download the order summary or settlement receipt, leave the order-linked review, and use **Buy again** to draft a fresh request.
7. Use the seeded dispute to demonstrate reviewer access and the distinction between released and outstanding funds.

Demo settlement updates the database. It does not produce a blockchain transaction. Follow the [contract setup](contracts/README.md) to demonstrate live testnet settlement.

## Setup for external services

| Service | Configuration |
| --- | --- |
| Database and auth | Set `STOCKPACT_DEMO=false`, `DATABASE_URL`, `BETTER_AUTH_URL` and a unique `BETTER_AUTH_SECRET` of at least 32 characters. Use a private PostgreSQL database. The app applies SQL migrations on startup. |
| Cloudflare Workers AI | Create an account-scoped Workers AI API token and set `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`. The text adapter validates structured output and identifies deterministic fallback in the draft. The transcription endpoint accepts short audio recordings. [Workers AI REST API](https://developers.cloudflare.com/workers-ai/get-started/rest-api/) |
| Private file storage | Create a private R2 bucket with object read/write access scoped to that bucket. Set the four `STOCKPACT_R2_*` values. Local demo attachments use a private directory when R2 is absent. [R2 credentials](https://developers.cloudflare.com/r2/api/tokens/) |
| Matching jobs | Set `STOCKPACT_JOBS_SECRET` and configure a private scheduler to call `POST /api/jobs` with `Authorization: Bearer <secret>`. Pending jobs are stored in PostgreSQL. |
| Password recovery | Configure the server-side `STOCKPACT_EMAIL_WEBHOOK` and optional bearer secret. The endpoint must deliver recovery messages over a trusted mail service. |
| Business verification | Configure a Persona key, webhook secret, and South Africa-appropriate inquiry templates for the desired scopes. Point Persona's signed inquiry-event webhook at `/api/verification/webhook`. Applicants complete hosted capture in Persona. A platform reviewer matches approved production inquiries to the submitted company record before granting verified status. Sandbox results stay in check history. The manual workflow is available without Persona. [Persona Hosted Flow](https://docs.withpersona.com/hosted-flow) |
| Escrow | Follow the [testnet instructions](contracts/README.md), deploy the escrow and token, configure the testnet RPC and contracts, and connect separate buyer and supplier wallets. |

External credentials stay server-side. Keep `.env.local`, the local database and business attachments outside Git. For manual or hosted verification outside the demo, provision a trusted reviewer using a `reviewer` membership in your private PostgreSQL instance. Reviewer permissions include access to verification and dispute queues across the active environment.

## Architecture

- Next.js App Router, React, TypeScript, Tailwind CSS and Inter for the responsive application and installable web app.
- Kysely over PostgreSQL. PGlite supplies a file-backed PostgreSQL engine for the single-process demo. SQL migrations keep business data separate from Better Auth user sessions and company memberships.
- Marketplace mutations validate the authenticated actor, check the company scope and serialize inventory and settlement state changes in database transactions. Company switches validate membership.
- The purchasing adapter produces editable request fields. Supplier search operates on persisted catalogue, delivery, verification and availability data. Sending an RFQ and accepting an offer require explicit application actions.
- Order attachments are accessed through the authenticated app route. Downloads recheck order access. Files live in private local storage or R2.
- The escrow adapter verifies successful transaction receipts before recording a testnet payment. Solidity contracts enforce signatures, expiry, nonce, cumulative quantity and original payout destination. AI has no spending role.

## Checks

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run contract:build
npm run contract:test
npm run test:ui
```

Browser checks use installed Microsoft Edge on Windows or Playwright Chromium on other hosts. On a host without a compatible browser, install Chromium with `npx playwright install chromium` and set `STOCKPACT_BROWSER_CHANNEL=chromium` for the UI test. Solidity tests execute in a local chain. A live testnet still needs the configuration above.

## Hackathon alignment

The published Node Engine tracks include Merchant & Machine Payments and Agentic Finance. StockPact uses buyer-approved procurement and testnet escrow to demonstrate that theme. The public page lists sponsor quests as forthcoming and does not identify a mandatory network, SDK, submission process or code-reuse rule. The repository uses a configurable EVM testnet setup. No ArcBot code was used. [Official Node Engine brief](https://w3node.io/node-engine)

See the [implementation checklist](docs/implementation.md) for scope and production dependencies.
