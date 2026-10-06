# Food Truck

The Food Truck Android app hosts the kiosk on the phone. It includes a foreground HTTP service, a tabbed in-app admin/settings screen, a customer kiosk, and an API for menu/orders.

## Install the Android app

Download the `app-kiosk-debug-apk` artifact from the successful GitHub Actions run, extract the ZIP, and install `app-debug.apk` on the phone. On first launch, allow notifications so Android can show the ongoing server notification.

## Start the phone server

1. Open **Food Truck** on the phone.
2. Turn **Phone server** on. It starts on port `4242` and shows an ongoing notification while active.
3. Connect the iPad to the same Wi-Fi network as the phone.
4. Open the **iPad URL** shown in the app on the iPad. It looks like `http://PHONE-IP:4242/kiosk.html`.
5. Use the **Menu**, **Kiosk & brand**, **Receipts**, **Orders**, and **Printer** tabs inside the phone app. There is no separate web admin page or admin PIN.

The notification has a **Stop server** action. Turning the server off in the app or notification also disables automatic restart. The in-app admin controls let staff add, edit, and remove menu items, choose up to four featured items, set the kiosk theme, upload a logo, configure looping background and cart promo media, customize customer-facing kiosk messages, and customize bill/token headings, message, print delay, and text size. Changes are stored on the phone and appear after the connected kiosk reloads.

For Bluetooth printing, pair a **Classic Bluetooth SPP ESC/POS** printer in Android Bluetooth settings, choose it in the app's **Printer** tab, and print a test receipt. Printers that do not implement Classic SPP (for example, BLE-only models) are not supported by this connection path.

## Background and restart behavior

- The server runs as an Android foreground service, so it can continue when the app screen is closed or the display is off.
- If Android kills the service, it requests a restart. If the phone reboots, the server starts again when it was previously enabled and Android permits background startup.
- For more reliable background operation, open Android Settings → Apps → Food Truck → Battery and select **Unrestricted** (wording varies by phone manufacturer).
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

Orders created by the Android-hosted service are stored on that phone and survive app restarts. Token numbers start at **101** and continue across app restarts. Confirming an order queues its itemized kitchen/order-summary bill, then prints the separate token slip after the configurable 2–3 second delay. The customer gives the bold, highlighted order-summary bill to the kitchen and keeps the matching bold token for collection; the kiosk shows a countdown while the token slip is queued. Payment is collected separately at the counter by cash or PhonePe QR; the kiosk does not collect or record payment.

The kiosk uses a bundled, subtle looping food animation by default and repeats it in menu-item previews. A separate promo panel below the cart supports looping video or image. Staff can upload MP4/WebM videos and JPG/PNG/WebP images (up to 20 MB) from the in-app panel or use direct HTTPS media URLs. Uploaded media and menu/theme/receipt settings are stored on the phone.

The sample menu is demo data, with four items initially selected for the featured panel. The local Node.js development server does not have the Android Bluetooth printer and keeps development orders in memory; use the Android app for the persistent, printer-backed counter workflow.
