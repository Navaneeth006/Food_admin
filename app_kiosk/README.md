# App Kiosk

The Android app hosts the kiosk on the phone. It includes a foreground HTTP service, an in-app server control screen, customer kiosk and admin pages, and an API for menu/orders.

## Install the Android app

Download the `app-kiosk-debug-apk` artifact from the successful GitHub Actions run, extract the ZIP, and install `app-debug.apk` on the phone. On first launch, allow notifications so Android can show the ongoing server notification.

## Start the phone server

1. Open **Food Kiosk** on the phone.
2. Turn **Phone server** on. It starts on port `4242` and shows an ongoing notification while active.
3. Connect the iPad to the same Wi-Fi network as the phone.
4. Open the **iPad URL** shown in the app on the iPad. It looks like `http://PHONE-IP:4242/kiosk.html`.
5. Use **Open admin** on the phone to open the admin page. The demo PIN is `1234`.

The notification has a **Stop server** action. Turning the server off in the app or notification also disables automatic restart. The in-app **Kiosk appearance & menu** panel lets staff change the kiosk theme/accent, background video, item videos, prices, availability, and display order while the phone server is running.

## Background and restart behavior

- The server runs as an Android foreground service, so it can continue when the app screen is closed or the display is off.
- If Android kills the service, it requests a restart. If the phone reboots, the server starts again when it was previously enabled and Android permits background startup.
- For more reliable background operation, open Android Settings → Apps → Food Kiosk → Battery and select **Unrestricted** (wording varies by phone manufacturer).
- A powered-off phone cannot host a server. The server can only resume after the phone is powered on and Android completes startup.
- Android force-stop, disabling the app, or some manufacturer battery controls can prevent automatic restart until the app is opened again.
- The phone and iPad must be on the same reachable Wi-Fi network. Guest Wi-Fi/client isolation can block connections.

## Local Node.js development

```bash
npm install
npm start
```

Then open `http://localhost:4242/` on the computer, or use the computer's LAN IP from another device.

## Current scope

Orders created by the Android-hosted service are stored on that phone and survive app restarts. Token numbers start at **101** and continue across app restarts. Placing an order queues a kitchen bill first, then a separate token slip three seconds later. The customer gives the kitchen bill to the kitchen and keeps the matching token slip for collection. Payment is collected separately at the counter by cash or the shop's PhonePe Business QR; staff records the payment in **Admin**. The kiosk does not collect UPI payments or verify them automatically. Admin shows the last seven days of order counts and paid revenue, and provides separate kitchen-bill and token-slip print retries when needed.

The kiosk uses a bundled, subtle looping food animation by default and repeats it in square menu-item previews. Staff can upload MP4/WebM videos (up to 20 MB) from the in-app panel or use direct HTTPS MP4/WebM URLs. Uploaded videos and menu/theme settings are stored on the phone.

The sample menu and admin PIN are demo values. The local Node.js development server does not have the Android Bluetooth printer and keeps development orders in memory; use the Android app for the persistent, printer-backed counter workflow.
