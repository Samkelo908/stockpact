# StockPact for Android

StockPact opens in its own Android window. The APK connects to the StockPact HTTPS workspace supplied at build time. Both devices need internet access and the same workspace URL to share quotes, orders, and handovers.

## Build a demo APK

Use Windows PowerShell 7, JDK 17 or later on `PATH`, and Android SDK Platform 35 with Build-Tools 35.0.0. Set `ANDROID_HOME`, pass `-Sdk`, or use the default SDK location under `%LOCALAPPDATA%\Android\Sdk`.

```powershell
./android/build.ps1 -WorkspaceUrl 'https://your-workspace.example/'
```

The build creates and verifies `artifacts/StockPact.apk`. Keep the signing key in the ignored `.stockpact/android` directory if you need to install an update over a previous demo build. Use your managed Android release key for public distribution.

## Run the two-phone demo

1. Install the same APK on both Android phones and open **StockPact** from the app launcher. For an email-protected demo, sign in to the workspace with the allowed email on each phone.
2. On phone 1, stay in **Buyer · Harbour Table**. Open **More → Requests & quotes → Chopped tomatoes**, accept the **Cape Supply Co.** quote, and reserve demo funds.
3. On phone 2, open the account menu, switch to **Supplier · Cape Supply Co.**, then open the new order and tap **Dispatch goods**.
4. On phone 1, open the order, tap **Inspect goods & generate QR**, confirm the received quantity, and display the QR.
5. On phone 2, tap **Scan handover QR → Scan with camera**. Allow camera access, point it at phone 1, then review and confirm the demo release. Both devices show the updated order.

This walkthrough uses fictional businesses and simulated funds. The protected demo link must stay online throughout the presentation. Rebuild against the replacement HTTPS origin if the demo link changes.

For the Ripple track, follow the [XRPL Testnet walkthrough](../docs/ripple-demo.md) instead. That mode submits valueless test XRP to the native XRP Ledger and shows the validated receipt in the app.
