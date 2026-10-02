# 🚚 Food Truck Self-Service Kiosk

A complete, production-ready self-ordering + billing kiosk system built for an
**iPad Air 2 mounted in a metal kiosk enclosure**. Dark premium POS interface,
huge touch targets, zero build step, zero frameworks — fast on old hardware.

## ⭐ Standalone mode — runs on the iPad alone (recommended start)

**`standalone/kiosk.html`** is the entire system in ONE file: kiosk menu + cart
+ payment screen + AirPrint bill printing + full admin panel with PIN login.
Copy it to the iPad, open it, Add to Home Screen — it runs **fully offline,
no server, no WiFi, no installation**. Data (menu, prices, orders, settings)
lives in the iPad's local storage.

```text
Transfer (USB cable / AirDrop / email — one time)
   ↓
iPad: Files → tap kiosk.html → Safari → Share → Add to Home Screen
   ↓
Fullscreen kiosk app · Admin PIN 1234 · Print via AirPrint
```

Full instructions: **docs/STANDALONE_IPAD_SETUP.md**.

---

## Server mode (multi-device: kitchen display + shared data)

The repo also contains the full Node.js server version when you outgrow a
single device — kitchen display tickets, shared SQLite data across devices,
ESC/POS thermal printing (USB/network/serial/BT-bridge) with a retry queue,
and live SSE updates:

```
iPad (Safari / Home-Screen PWA)
   ↓  Wi-Fi
Node.js server (this repo)  ──►  SQLite database (data/kiosk.db)
   ├── Kiosk UI         http://<server-ip>:4242/
   ├── Kitchen display  http://<server-ip>:4242/kitchen
   └── Admin dashboard  http://<server-ip>:4242/admin   (PIN, default 1234)
        ├── thermal printer (ESC/POS: simulated | USB | network | serial | BT-bridge)
        └── payment gateway  (NOT connected yet — reserved for PhonePe, see below)
```

## What works today (real, tested)

- **Kiosk**: menu with sticky category nav + scroll-synced highlighting, food
  cards, quantity controls, extras/modifier sheet with live totals, persistent
  cart bar (VIEW CART sheet + PAY NOW), cart survives page reloads, auto-reset,
  offline detection, PWA install with fullscreen landscape.
- **Orders**: server-side pricing (client can never set prices), sequential
  backend-assigned order numbers (starts #1001, no duplicates), atomic creation.
- **Printing**: ESC/POS receipt + kitchen slip (with cut line and giant order
  number) on every paid order; queue with auto-retry; failed jobs retryable from
  the admin; test print; simulated driver writes `.bin` files to `data/prints/`.
- **Kitchen display**: live tickets via SSE, NEW → PREPARING → READY → COMPLETED.
- **Admin**: today's stats, order search + reprint, full menu/category/modifier
  CRUD with image upload, bill designer with live receipt preview, printer
  diagnostics, kiosk settings.
- **Payments**: intentionally NOT wired. The payment page is a placeholder and
  the order is marked unpaid. One server function (`markOrderPaid`) is the
  single integration point for the upcoming gateway.

## Quick start

```bash
npm install
npm run seed        # loads the demo menu (placeholder prices)
npm start           # http://localhost:4242
```

Then from the iPad (same Wi-Fi): open `http://<server-ip>:4242/`.

| Where | URL | Notes |
|---|---|---|
| Kiosk | `/` | the customer screen |
| Kitchen | `/kitchen` | tablet/laptop next to the fryer |
| Admin | `/admin` | PIN `1234` (change it — see below) |

Change the admin PIN:
```bash
node server/scripts/pin-hash.js 9482   # prints a hash
# put it in .env → ADMIN_PIN_SHA256=<hash>, restart
```

Copy `.env.example` to `.env` and adjust (printer driver, port, etc.).

## Repo layout

```
server/
  app.js               all routes (kiosk, kitchen, admin, uploads)
  config.js            env-based configuration
  db/database.js       SQLite schema + settings store
  db/seed.js           demo menu seeder (npm run seed / reset:demo)
  services/orders.js   pricing + order engine (server-authoritative)
  services/receipt.js  bill/kitchen-slip template (settings-driven)
  services/printer.js  driver layer + print queue (never loses a job)
  services/qrcode.js   server-side QR SVG (kiosk does zero QR maths)
  services/auth.js     PIN sessions (HttpOnly cookie, server-side tokens)
  services/events.js   SSE hub (kitchen + admin live updates)
  tests/               node:test suites (QR round-trip, orders, receipts)
public/
  index.html / kiosk.css / kiosk.js     customer kiosk (vanilla, no framework)
  admin.html / admin.js                 owner dashboard
  kitchen.html                          live order board
  manifest.webmanifest / sw.js / icons  PWA plumbing
docs/
  STANDALONE_IPAD_SETUP.md  the no-server single-file kiosk (START HERE)
  IPAD_SETUP.md        server-mode kiosk installation on the iPad Air 2
  PRINTER_SETUP.md     thermal printer options + wiring
  PHONEPE_INTEGRATION.md  exact integration plan for the payment gateway
  TROUBLESHOOTING.md   common problems, fast fixes
standalone/
  kiosk.html           THE ENTIRE SYSTEM IN ONE FILE — runs on the iPad offline
```

## Daily operation

```bash
npm start            # run the server
npm run reset:demo   # wipe orders + menu, reseed demo data (dev only!)
npm test             # run the test suite
```

- Menu changes in **Admin → Menu** go live instantly — the kiosk picks them up
  on next load (no restart).
- If the printer is offline when an order is paid, the order is safe: retry from
  **Admin → Printer → Print Queue**.
- Configure business name, address, GST, footer etc. in **Admin → Billing** with
  a live preview. GST > 0 adds tax to the exact payable amount server-side.

## Payment status

Per the project brief, the payment page is a **blank placeholder**. Orders are
created and numbered but remain `unpaid` — staff complete them out-of-band
(or use `POST /api/dev/pay/:orderId` while `PAYMENT_MODE=test` for flow testing;
this endpoint hard-disables itself when `PAYMENT_MODE=live`).

The gateway integration (PhonePe) has a documented, ready-to-wire plan:
**docs/PHONEPE_INTEGRATION.md** — including the PHP SDK vs Node SDK decision.
Nothing else in the system needs to change when that lands: the kiosk payment
screen, success screen, printing, kitchen and reporting already key off
`markOrderPaid`.
