# PhonePe Payment Gateway — Integration Guide (for later)

Payment is intentionally **not integrated** in this build. The kiosk's PAY NOW
flow stops at a placeholder screen ("Payment gateway not configured — ask at the
counter"). The order engine, totals, order numbers, receipts, printing and
kitchen flow are all live and work with the dev-only **TEST PAYMENT SUCCESS**
hook (Admin → Orders → *Mark paid (test)*) — so you can run the truck on cash
today and drop PhonePe in without touching anything else.

## Which integration to choose

| Option | When it's the best choice |
|---|---|
| **Node SDK / REST API** (`phonepe-sdk` or plain REST) | **Recommended.** Your backend is Node.js (this repo). Native, no extra process, clean webhook handling. |
| **Official PHP SDK / kit** | Only if you already run a PHP server. You'd add a second service (PHP) just for payments and have Node call it — extra moving parts on a truck. |

**Verdict: use the Node side (PhonePe Standard Checkout v2 REST API).
The PHP SDK would only make sense for a pure-PHP stack.**

## How it plugs in (the 3 touchpoints)

Everything is already stubbed around a payment-provider boundary:

1. **`server/app.js` → `POST /api/orders`** — today it creates the order with
   `payment_status='awaiting'` and the kiosk shows the placeholder screen.
   Later: create a PhonePe payment request here (server-side, keys never reach
   the iPad) and return its redirect/QR URL to the kiosk.
2. **Kiosk placeholder screen** (`public/kiosk.js`, `showPaymentPlaceholder`)
   — replace the placeholder body with: open the PhonePe page / show its QR,
   poll `GET /api/orders/:id` until `payment_status` flips to `paid`.
3. **`server/app.js` → `POST /api/payments/webhook`** — webhook route is
   already mounted and validates the `x-verify` SHA256 signature header before
   trusting anything. Mark the order paid here (never from the browser) — the
   moment `markOrderPaid()` runs, receipts + kitchen slips print automatically
   and the kitchen board updates.

## Minimal server flow (Standard Checkout v2)

```
iPad                    Node server                      PhonePe
  │  POST /api/orders      │                                │
  │───────────────────────►│  POST /pg/v1/pay               │
  │                        │───────────────────────────────►│
  │  ◄── order + pay URL ──│  ◄───── payPageUrl ─────────── │
  │  open URL / show QR    │                                │
  │                        │  ◄── webhook: payment success ─│
  │  poll order status     │  verify x-verify checksum      │
  │───────────────────────►│  markOrderPaid() → print!      │
  │  ◄─── payment_status=paid ─                              │
```

## Environment variables to add later (`.env`)

```
PAYMENT_PROVIDER=phonepe
PHONEPE_MERCHANT_ID=Mxxxxxxxxxxxxx
PHONEPE_SALT_KEY=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
PHONEPE_SALT_INDEX=1
PHONEPE_ENV=UAT        # switch to PRODUCTION after testing
PHONEPE_CALLBACK_URL=https://your-domain/api/payments/webhook
```

⚠️ Never put salt keys in the frontend. The iPad only ever talks to this Node
server. Use a real HTTPS domain for webhooks (Cloudflare Tunnel / ngrok for
trials) — PhonePe cannot reach a LAN IP.

## UAT testing

PhonePe's UAT environment accepts test UPI flows with zero real money. Test
matrix before going live: success, failure/timeout, duplicate webhook, app
killed mid-payment (order must stay `awaiting`, never auto-paid), and one
forged webhook (must be rejected by the checksum check).
