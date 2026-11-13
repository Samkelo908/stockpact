# StockPact on XRP Ledger Testnet

StockPact helps South African shops and food businesses order from local wholesalers and pay for stock that actually arrived. For a first pilot, onboard Cape Town wholesalers and their existing repeat customers together. They get one place to compare quotes, confirm deliveries, and match payments to received quantities.

## Two Android phones

1. Install the signed StockPact APK on both phones and open the same protected demo workspace. Keep phone 1 in **Buyer · Harbour Table**. On phone 2, switch to **Supplier · Cape Supply Co.**
2. On the buyer phone, open **More → Company settings → XRPL Testnet autopay → New supplier mandate**. Choose Cape Supply Co. and leave its configured payout address in place. Set the per-payment cap to **3 XRP** and the total cap to **4 XRP**. Approve the mandate.
3. Accept Cape Supply Co.’s **Chopped tomatoes** quote for 20 cases. Approve the order if prompted. Choose **Choose payment method → Enable test autopay**. On the supplier phone, open that order and dispatch it.
4. Inspect **12 cases** on the buyer phone and generate the handover QR. On the supplier phone, scan it in **Deliveries** and choose **Accept handover and check autopay**. The agent requests **2.67 test XRP**. When validation finishes, either phone can open the explorer receipt from the order.
5. Repeat with **8 cases**. The agent requests **1.78 test XRP**. The signer blocks the transfer because it exceeds the remaining **1.33 XRP** of the mandate. Both phones show the reason, and no second payment hash is created. Scanning either used QR again cannot pay twice.
6. Show the owner’s **Pause** control. Pausing prevents new submissions from being authorized. A transaction already authorized for submission may still settle, so the app continues checking its original hash.

The demo maps R1,000 in quote value to 1 test XRP to make the amounts easy to explain. This is a fixed demonstration rate. No rand moves, no escrow is deposited for these orders, and test XRP has no monetary value. Delivery and settlement each have their own status. An accepted handover can have a blocked or pending payment.

In the verified run, the first handover settled on [XRPL Testnet ledger 22291027](https://testnet.xrpl.org/transactions/4AE9767AB2F16255AD38FF84D51EF60D3C58204FD9112C994CDFA3D9C51CCF8E). The second handover was recorded without a payment. The check used two separate mobile browser sessions and fed the generated QR images through the camera decoder.

## Private workspace setup

- Start with a fresh private workspace and set `STOCKPACT_DEMO=true`. These payments are enabled only for fictional company accounts. This path works with the app’s PostgreSQL or local PGlite setup.
- Use the [official XRP Testnet faucet](https://xrpl.org/resources/dev-tools/xrp-faucets) to activate two dedicated accounts. Put the signing account, its private seed, and the supplier’s public address in the server environment. Use the example settings in [`.env.example`](../.env.example) and set `STOCKPACT_XRPL_ENABLED=true`. The demo uses `STOCKPACT_XRPL_TESTNET_SUPPLIER_ID=demo-supplier-company`. Keep the reserve small and never use this seed on Mainnet.
- Configure the Workers AI account and token. If the AI is unavailable, the payment waits for a valid decision. It never falls back to sending without one. Leave the job scheduler enabled so interrupted submissions can be checked even when both phones are closed.
- Serve both phones from the same protected HTTPS origin for the camera. Build the APK against that origin using the [Android instructions](../android/README.md).

The agent receives only the immutable handover facts. It cannot choose a new amount or recipient, change the mandate, or access the wallet seed. The server checks the owner’s rules and the fixed deployment recipient before signing. It stores the signed hash before contacting the ledger and reconciles that exact transaction on retry. Only a validated matching `tesSUCCESS` result counts as paid. The audit log records the agent’s request and the policy outcome separately. [XRPL agent starter kit](https://xrpl.org/docs/agents/agentic-transactions) · [Reliable transaction submission](https://xrpl.org/docs/concepts/transactions/reliable-transaction-submission)
