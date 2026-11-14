# StockPact for Android

StockPact opens in its own Android window. The APK connects to the StockPact HTTPS workspace supplied at build time. Both devices need internet access and the same workspace URL to share quotes, orders, and handovers.

## Build a demo APK

Use Windows PowerShell 7, JDK 17 or later on `PATH`, and Android SDK Platform 35 with Build-Tools 35.0.0. Set `ANDROID_HOME`, pass `-Sdk`, or use the default SDK location under `%LOCALAPPDATA%\Android\Sdk`.

```powershell
./android/build.ps1 -WorkspaceUrl 'https://your-workspace.example/'
```

The build creates and verifies `artifacts/StockPact.apk`. Keep the signing key in the ignored `.stockpact/android` directory if you need to install an update over a previous demo build. Use your managed Android release key for public distribution.

## Run the two-phone demo

1. Install the same APK on both Android phones and open **StockPact** from the app launcher. On the current demo build, enter the workspace access code on each phone.
2. On phone 1, stay in **Buyer · Harbour Table**. Open **More → Requests & quotes → Chopped tomatoes**, accept the **Cape Supply Co.** quote, and reserve demo funds.
3. On phone 2, open the account menu, switch to **Supplier · Cape Supply Co.**, then open the new order and tap **Dispatch goods**.
4. On phone 1, open the order, tap **Inspect goods & generate QR**, confirm the received quantity, and display the QR.
5. On phone 2, tap **Scan handover QR → Scan with camera**. Allow camera access, point it at phone 1, then review and confirm the demo release. Both devices show the updated order.

This walkthrough uses fictional businesses and simulated funds. The protected demo link must stay online throughout the presentation. Rebuild against the replacement HTTPS origin if the demo link changes.

For the Ripple track, follow the [XRPL Testnet walkthrough](../docs/ripple-demo.md) instead. That mode submits valueless test XRP to the native XRP Ledger and shows the validated receipt in the app.

XRPL Testnet autopay runs on the workspace server and needs no wallet app on either phone. The order shows delivery and payment separately. The buyer owner can request another decision for a blocked handover before a transaction has been signed. The EVM escrow flow requires a browser with a connected EVM wallet.

## Host a private demo

1. Use a demo-only StockPact database. Set `STOCKPACT_DEMO=true` and set `BETTER_AUTH_URL` to the HTTPS workspace origin. Set up simulated settlement or follow the [XRPL Testnet configuration](../docs/ripple-demo.md#private-workspace-setup).
2. Build the Next.js app with `npm run build` and run `npm start -- --port 3112` on loopback.
3. Set `STOCKPACT_PHONE_ORIGIN` to the same HTTPS origin, `STOCKPACT_PHONE_ACCESS_CODE` to a random 24–64 character URL-safe code, and `STOCKPACT_PHONE_SESSION_KEY` to a random 32-byte hex key in the gateway process environment. Run `node android/demo-gateway.mjs` in a separate terminal.
4. Point the HTTPS tunnel at the gateway on loopback port 3116. The gateway prompts for the access code and proxies authenticated requests to the app on port 3112. Keep the app, gateway and tunnel running during the demo. Send the code privately to each tester.
5. Build the APK for that HTTPS origin and install it on both devices. If the temporary hostname changes, update both origins and rebuild the APK. Run the background scheduler against the app’s loopback endpoint with the configured job secret.
