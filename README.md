# StockPact

**A mobile procurement marketplace for buyers and suppliers across Africa, starting with a Cape Town pilot.**

StockPact gives a shop owner, caterer or purchasing team one place to find stock, ask suppliers questions, compare delivered quotes and confirm what arrived. Young suppliers and independent wholesalers can list inventory, reach nearby buyers, quote for real requests and build a reputation through completed orders. Samkelo Maswana built StockPact for the Node Engine hackathon.

![Illustration of a Cape Town shop owner checking her phone as a supplier delivers stock](public/cape-town-shop-delivery.webp)

[Download the signed Android APK](https://github.com/Samkelo908/stockpact/releases/download/android-demo-v0.1.5/StockPact-0.1.5.apk) · [Two-phone walkthrough](#two-phone-ripple-demo) · [Run locally](#run-locally) · [Technical setup](#configure-a-private-workspace)

## Why StockPact

A first-time shop owner can spend hours finding who has stock, what a case contains and how much delivery will add. A young wholesaler can have the right goods on hand and still struggle to reach customers outside an existing network. StockPact brings those decisions into a shared purchasing record that both businesses can follow from the first question through delivery.

The first market uses South African rand, Cape Town delivery areas and South African date formatting. The expansion plan is to validate the model with local buyers and suppliers, then adapt it market by market for local currencies, languages, delivery networks and payment options.

## What the app does

| Area | What you can do |
| --- | --- |
| **Purchasing assistant** | Type or speak a requirement, or use the guided form. Review the extracted product, quantity, pack size, delivery or collection area, date, budget and notes. You can edit the draft before starting the search. |
| **Supplier discovery** | Browse the marketplace and filter stock. A request search checks verified supplier listings for product fit, available stock, minimum order, unit and pack size, delivery coverage and lead time. A progress indicator shows when matching is underway and when results are ready. |
| **Requests and quotes** | Choose which suppliers receive a request for quote. Compare quantities, delivered totals, tax, delivery fees, delivery dates and quote versions. The buyer controls whether to share the budget and allow substitutions. A grouped purchase can contain up to 12 products, each with its own quotes and order. |
| **Private supplier chat** | Ask an invited supplier about stock, pack sizes, substitutions or delivery times in a conversation attached to the request. The buyer and each invited supplier have their own thread. Orders also support participant messages and private attachments. |
| **Supplier catalogue** | Create and update listings, photos, prices, minimums, quantities, delivery areas and lead times. Import catalogue rows by CSV, mark surplus stock and archive listings. Buyers can save favourites, preferred suppliers and shopping lists. |
| **Orders and delivery** | Accept a quote and reserve inventory. Use purchase approval thresholds where configured, dispatch the order and inspect full or partial deliveries. Both parties can follow the order activity and access summaries and receipts. |
| **QR handover** | The buyer generates a short-lived, single-use QR for the inspected quantity. The supplier or an eligible assigned driver scans it in StockPact, reviews the handover and confirms it. A link or token can be entered manually if the camera is unavailable. |
| **Supplier ratings** | An eligible buyer can leave one review per completed purchase with accepted goods. Rate overall experience, product quality, delivery reliability, order accuracy and communication. Suppliers can reply, users can report reviews and platform reviewers can moderate them. |
| **Business controls** | Company owners can manage staff access and verification. The reviewer workspace includes verification, disputes and reported reviews. Optional Persona Hosted Flow and account email delivery extend business onboarding. |

| Private supplier chat | Validated XRPL Testnet receipt |
| --- | --- |
| <img src="docs/images/supplier-chat.webp" alt="Harbour Table asks Cape Supply Co. about stock and Friday delivery in a private request conversation" width="320"> | <img src="docs/images/xrpl-testnet-receipt.webp" alt="StockPact shows 2.67 test XRP validated on ledger 22291027" width="320"> |

### A purchase from start to finish

1. **Describe the order.** On Home, enter a requirement such as `I need 20 cases of chopped tomatoes, 12 tins per case, delivered to Woodstock, Cape Town by next Friday.` Choose **Build request** or open the guided form. Check the exact required date, quantity and pack size before proceeding.
2. **Find suppliers.** Select **Find suppliers**, review the matches and send the request to the suppliers you choose. Buyer business and representative verification are required to send a request outside the pre-verified fictional demo.
3. **Ask questions and compare offers.** Open the private chat with a supplier, then compare the quote terms. Suppliers receive invitations and can send or revise a quote from **Requests & quotes**.
4. **Accept and dispatch.** Accept the quote, complete any required approval, select the available payment mode and let the supplier mark the goods dispatched.
5. **Inspect and confirm.** Record the quantity that arrived. The buyer displays the handover QR and the supplier scans it from **Deliveries**. Review the handover before confirming it.
6. **Close the loop.** Check delivery and payment statuses, download the relevant receipt, and leave a review once the purchase is eligible. Use **Buy again** to start a new request from the order.

## Install on Android

1. Download [StockPact 0.1.5](https://github.com/Samkelo908/stockpact/releases/tag/android-demo-v0.1.5) from the private GitHub release. Install the APK on an Android 8.0 or later device. Android may prompt you to allow installs from the app used to open the file.
2. Launch **StockPact** from the Android launcher. The APK opens the workspace in its own Android window.
3. Enter the private workspace access code supplied by the workspace host. Both phones need internet access and the same workspace. Allow camera or microphone access when you choose to use those features.
4. If you see **Reconnect**, use it to sign in again. StockPact keeps an in-progress sourcing draft during sign-in so you can retry. If the host changes the temporary HTTPS address, ask for an APK built for the new address.

The APK includes a WebView and Android integration for the camera, microphone and downloads. The application and shared records are served by the StockPact HTTPS backend. The signed demo APK needs its private workspace online. To create an APK for another environment, use the [Android build instructions](android/README.md).

## Two-phone Ripple demo

Use the account menu to keep **Phone 1** in **Buyer · Harbour Table** and switch **Phone 2** to **Supplier · Cape Supply Co.** These are fictional businesses.

1. On the buyer phone, go to **More → Company settings → XRPL Testnet autopay → New supplier mandate**. Choose Cape Supply Co., keep the configured payout address, and approve caps of **3 test XRP per payment** and **4 test XRP total**.
2. Accept Cape Supply Co.’s seeded quote for **20 cases of chopped tomatoes**. Approve the order if prompted, then choose **Choose payment method → Enable test autopay**. On the supplier phone, dispatch that order.
3. The buyer inspects **12 cases** and displays the handover QR. The supplier opens **Deliveries**, scans the code and chooses **Accept handover and check autopay**.
4. Wait for validation and open the receipt. The test payment is **2.67 test XRP**. Repeat with the remaining **8 cases**. The second payment request for **1.78 test XRP** exceeds the **1.33 test XRP** still available under the total cap. StockPact records the delivery and shows the blocked payment and its reason.
5. Show the buyer’s **Pause** control. It prevents new payment submissions from being authorized. StockPact continues checking the original hash of a transaction already authorized for submission.

| Handover | Accepted | Test payment | Outcome |
| --- | ---: | ---: | --- |
| First delivery | 12 cases | 2.67 test XRP | Validated on ledger **22291027** in the recorded run |
| Second delivery | 8 cases | 1.78 test XRP requested | Blocked by the remaining mandate cap |

[Recorded XRP Ledger Testnet transaction](https://testnet.xrpl.org/transactions/4AE9767AB2F16255AD38FF84D51EF60D3C58204FD9112C994CDFA3D9C51CCF8E) · [Detailed Ripple setup and walkthrough](docs/ripple-demo.md)

The fixed demo conversion uses R1,000 in quote value for 1 test XRP. XRP Ledger Testnet uses valueless test funds. The documented run used two mobile browser sessions and the app’s QR decoder with a test camera feed. Android sign-in and AI drafting were also checked in the installed APK on an emulator.

### Payment modes

| Mode | What settles | How to use it |
| --- | --- | --- |
| **Simulated reserve and release** | Database entries representing fictional funds | Available in the local demo without wallet or blockchain credentials. |
| **XRP Ledger Testnet autopay** | Native test XRP sent by the server’s configured test signing account | The hackathon path. Enable the Workers AI decision provider and the XRP Ledger Testnet configuration, then approve a buyer mandate. A wallet app on the phones is unnecessary. |
| **EVM testnet escrow** | A valueless ERC-20 test token funded and released through the configured contract | Optional wallet-based path. Deploy the Solidity contracts and link buyer and supplier wallets in a compatible browser. [Contract setup and limits](contracts/README.md) |

## How it works

```mermaid
flowchart LR
    A["Android app or web client"] --> B["StockPact HTTPS backend"]
    B --> C[("PostgreSQL or local PGlite")]
    B --> D["Workers AI"]
    B --> E["Private local or R2 storage"]
    C --> F["Confirmed handover and queued test payment"]
    F --> D
    D --> G["Buyer mandate and signing policy"]
    G --> H["XRP Ledger Testnet"]
    H --> B
```

- **App and authentication.** Next.js App Router, React, TypeScript and Tailwind CSS serve the responsive interface and API. Better Auth manages business sessions. The server checks role, company membership and access to each request or order before processing an action.
- **Data and jobs.** Kysely runs queries against PostgreSQL, or file-backed PGlite for a single local demo process. SQL migrations run on the first database connection. Transactions protect inventory reservations and settlement records. Persisted jobs handle matching, payment reconciliation, request expiry and shopping reminders.
- **AI and matching.** Cloudflare Workers AI extracts a structured draft and can transcribe short recordings. The server validates AI output. Drafting falls back to a local parser if inference is unavailable. Matching uses the stored catalogue, and buyers explicitly send requests and accept quotes. [Workers AI REST API](https://developers.cloudflare.com/workers-ai/get-started/rest-api/)
- **Handover and payment.** A QR identifies a specific order and accepted quantity. The server checks the participants, expiry and prior redemption. For native XRPL Testnet, the AI can request a payment or hold it. The signer independently checks the supplier, destination, evidence, caps and pause state. It saves the signed transaction and hash before submission, checks the original hash during recovery and marks the payment confirmed only after matching validated success. Delivery has its own status. [XRPL reliable transaction submission](https://xrpl.org/docs/concepts/transactions/reliable-transaction-submission)
- **Files and recovery.** Private files pass through authorized application routes. The service worker caches built-in marketplace and Home photos for navigation. Workspace records come from the authenticated backend, and supplier search retries reuse a request ID to avoid creating duplicate requests.

## Run locally

Use **Node.js 22.18 or later** and npm. Run these commands from the repository root.

```sh
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Development starts with fictional demo data by default. Switch between the buyer, two suppliers, a driver and the reviewer from the account menu. A fresh local demo starts with example listings, quotes and orders. Its data persists in `.stockpact/db` by default.

To run a production build of the fictional workspace, copy [`.env.example`](.env.example) to `.env.local`. Keep `STOCKPACT_DEMO=true` and `STOCKPACT_ESCROW_MODE=demo` for simulated settlement and run the following commands.

```sh
npm run build
npm start
```

To refresh an expired seeded quote before rehearsing, stop the local app, confirm `STOCKPACT_DEMO=true` and leave `DATABASE_URL` empty. Run `npm run demo:reset` and restart. This replaces the fictional demo records.

## Configure a private workspace

For a business pilot, use a separate PostgreSQL database and a stable HTTPS origin. Set `STOCKPACT_DEMO=false`, `STOCKPACT_ESCROW_MODE=disabled` and `STOCKPACT_XRPL_ENABLED=false` to start with procurement. Set `BETTER_AUTH_URL` to the external HTTPS origin. Deploy the Node app behind the intended HTTPS endpoint and build the APK for that origin.

| Service | Environment and operation |
| --- | --- |
| **PostgreSQL and sign-in** | Set `DATABASE_URL`, `BETTER_AUTH_URL` and a unique `BETTER_AUTH_SECRET` of at least 32 characters. The database role needs permission to apply the repository’s migrations. |
| **Cloudflare Workers AI** | Set `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` on the server. The environment example lists the draft, transcription and test payment decision models. |
| **Private attachments** | Set `STOCKPACT_STORAGE_MODE=local` and `STOCKPACT_FILE_PATH` for one instance with persistent disk, or configure the `STOCKPACT_R2_*` settings for a private R2 bucket. |
| **Background processing** | Schedule `POST /api/jobs` against the backend with `Authorization: Bearer <STOCKPACT_JOBS_SECRET>`. Keep the scheduler available for payment reconciliation when the phones are closed. |
| **Account email** | Configure `STOCKPACT_EMAIL_WEBHOOK` and optionally `STOCKPACT_EMAIL_SECRET`. The webhook receives email verification and password reset links for delivery to the account address. |
| **Company verification** | Use the manual reviewer workflow, or configure the optional Persona templates, API key and signed webhook. Platform reviewers grant verification after matching provider evidence to the company record. |
| **Private APK demo access** | The shared-code gateway is for the fictional demo. Run it in front of the loopback app, and give both test phones the code privately. See [Android gateway setup](android/README.md#host-a-private-demo). |

The planned Firebase deployment uses a **Cloud SQL for PostgreSQL** instance associated with Firebase SQL Connect. StockPact would connect from the Node backend via `DATABASE_URL` and keep its SQL migrations and access checks. The checked-in app currently uses PostgreSQL or PGlite. Provisioning, data migration and verification for the Firebase-backed pilot are pending. [Pilot setup](docs/pilot-setup.md) · [Firebase SQL Connect database access](https://firebase.google.com/docs/sql-connect/manage-services-and-databases#grant-postgresql-roles)

Keep runtime secrets, APK signing keys, database files, private attachments and the demo access code outside Git. For a manual verification pilot, grant the platform reviewer role to an existing authorized account with `npm run reviewer:grant -- reviewer@example.com`.

## Repository and checks

| Path | What it contains |
| --- | --- |
| [`src/app/`](src/app) and [`src/components/`](src/components) | Next.js routes, API handlers and buyer, supplier, payments and administration screens |
| [`src/server/`](src/server) | Authentication scope, procurement, reviews, handovers, payment policy and background jobs |
| [`src/integrations/`](src/integrations) | Workers AI, private storage, Persona, XRP Ledger and EVM adapters |
| [`db/migrations/`](db/migrations) | Versioned PostgreSQL schema |
| [`android/`](android) | Android wrapper, signed APK build script and private demo gateway |
| [`contracts/`](contracts) | Optional EVM escrow and test token, deployment instructions and tests |
| [`tests/`](tests) | Unit and integration tests, with Playwright scenarios in `tests/ui/` |

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run test:ui
npm run contract:build
npm run contract:test
```

Playwright runs desktop and phone viewport projects. It uses Microsoft Edge by default on Windows and Chromium on other hosts. To use Playwright Chromium, run `npx playwright install chromium` and set `STOCKPACT_BROWSER_CHANNEL=chromium`. Solidity tests run on a local test chain.

## Business model and next milestones

**Proposed revenue.** A small fee on completed orders aligns revenue with purchases that go through. Optional paid supplier plans could add catalogue management and sales reporting. The Cape Town pilot would test adoption and willingness to pay before setting prices.

**What investment would fund.** Recruit local shops and young suppliers, help them complete their first orders, and run a supported pilot on stable hosting. Track completed orders, repeat buying, supplier participation, willingness to pay and cost per order. Use those results to decide how to expand into the next African market.

**Pilot scope.** The repo includes the procurement workflow, Android app, real Workers AI calls in the configured demo and a verified native Testnet payment. Production work includes hosted database and identity onboarding, operations and reconciliation, and the controls and payment integrations required before handling real customer funds. [Implementation checklist](docs/implementation.md) · [Node Engine hackathon](https://w3node.io/node-engine)
