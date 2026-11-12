# StockPact testnet escrow

The normal application runs in demo mode and records simulated payments in the database. Enabling testnet mode makes the wallet fund and release the valueless `TSTK` ERC-20. A testnet settlement needs a successful receipt from the configured escrow and the configured confirmation count. Quotes use integer rand cents for display. One whole test token per 100 quote cents is a nominal demo convention with no exchange-rate or redemption claim. The wallet displays network fees in test gas before submitting.

## Local verification

Install dependencies from the repository root, then run `node contracts/compile.mjs` and `node --test contracts/escrow.test.mjs`. The tests deploy fresh contracts to an in-process Hardhat EVM and inspect balances and actual execution receipts from that local chain.

## Deploy to a testnet

Base Sepolia (84532) is the default. The application also accepts Ethereum Sepolia, Arbitrum Sepolia, OP Sepolia, Polygon Amoy, and Avalanche Fuji. Use a separate gas-funded testnet deployer and a separate attestation signing key. The resolver address holds dispute powers and should be distinct from the deployer and attestor. Give the initial token supply to a test buyer wallet or distribute it to demo wallets with normal ERC-20 transfers.

In an ignored `.env.local`, set the following deployment variables. Use the `0x` prefix for keys and addresses.

| Variable | Value |
| --- | --- |
| `STOCKPACT_TESTNET_CHAIN_ID` | Target test chain ID |
| `STOCKPACT_TESTNET_RPC_URL` | HTTPS RPC for that chain |
| `STOCKPACT_TESTNET_DEPLOYER_KEY` | Gas-funded test wallet key |
| `STOCKPACT_TESTNET_ATTESTOR_ADDRESS` | Public address of the server attestation wallet |
| `STOCKPACT_TESTNET_RESOLVER_ADDRESS` | Public address of the separate dispute resolver |
| `STOCKPACT_TESTNET_TOKEN_RECIPIENT` | Initial test token recipient |
| `STOCKPACT_TESTNET_TOKEN_SUPPLY` | Whole test tokens, defaults to `100000` |

Run `node --env-file-if-exists=.env.local contracts/deploy.mjs`. Save the printed token and escrow addresses in `STOCKPACT_TESTNET_TOKEN_ADDRESS` and `STOCKPACT_TESTNET_ESCROW_ADDRESS`. For the Next.js server, set `STOCKPACT_ESCROW_MODE=testnet` and `STOCKPACT_TESTNET_ATTESTOR_KEY` to the attestor's private key. Keep the deployer key out of the application runtime. The default token symbol and decimals are `TSTK` and `6`. `STOCKPACT_TESTNET_CONFIRMATIONS` defaults to `2`. Use separate buyer and supplier wallets registered to their respective companies and keep each wallet on the selected chain. The deploy script also accepts local Hardhat or Anvil RPCs on loopback for standalone contract development.

## Settlement rules

- Each order binds a fixed buyer, supplier, test token, whole order quantity, and total. The order reference derives from the app order ID and buyer address so a third party cannot occupy the buyer's escrow record.
- The buyer and server attestor sign the same EIP-712 authorization. It binds the chain, contract, order, supplier, previous cumulative quantity, new accepted quantity, exact token units, nonce, and expiry. The supplier or its authorized on-chain driver submits the authorization, and the contract always pays the supplier wallet. QR material alone is insufficient to send funds.
- The contract releases the difference between successive cumulative entitlements. Each entitlement is the funded amount in whole quote cents multiplied by accepted quantity and divided by total quantity, rounded down. The final accepted delivery receives the rounding residual. The accepted quote total includes any delivery and tax amounts already allocated at checkout. This single-quantity contract spreads those amounts across accepted quantities at the same rate and keeps the test token transfer exact.
- A successful release consumes the nonce and advances the quantity on-chain in the same transaction. Independently signed competing releases with stale cumulative quantity fail. On the order screen, the buyer can cancel an unsigned code immediately or revoke a signed code through the buyer wallet. The app checks the on-chain nonce and accepted quantity after confirmation before recording revocation. Authorizations expire within 15 minutes.
- Before the 30-day order timeout, either buyer or supplier can open a dispute. Prior releases stay settled. The unresolved balance is frozen until the resolver splits it between the existing supplier and buyer, or until 30 days pass and the remaining balance becomes refundable to the buyer. An undisputed order can refund the remaining balance after its 30-day timeout. Refund calls always pay the original buyer. An operational dispute process should promptly inspect evidence and act within the resolution window.
- The resolver can allocate only outstanding disputed funds and can pay only the existing parties. The attestor cannot move funds without the buyer and an authorized supplier or driver. Wallets sign transactions themselves, and AI receives no signing key.

This is a testnet contract. A business pilot requires contract review, production custody and operational controls, reconciliation, and separately configured regulated payment rails where applicable.

The application's testnet flow currently confirms funding and releases submitted by the linked supplier wallet. Testnet driver authorisation, dispute awards, revocations, and timeout refunds are contract operations. The app provides driver handovers and dispute review in database demo mode.
