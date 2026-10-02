# Troubleshooting

## Kiosk / iPad

| Problem | Fix |
|---|---|
| "CONNECTING…" forever | Server down or wrong IP. Check `npm start` is running; browse `http://<server-ip>:4242/` from a laptop on the same Wi-Fi. |
| Pinch/double-tap zoom still happens | Settings → Accessibility → Zoom → OFF on the iPad; app also blocks it in JS. |
| Stale menu after deploying changes | Close the Kiosk app completely (swipe away) and reopen. Service worker refreshes network-first. |
| Cart won't clear between customers | Auto-reset runs after the success screen (`auto_reset_seconds` in Admin → Settings); Guided Access keeps customers from escaping it. |
| Screen sleeps | Settings → Display & Brightness → Auto-Lock → Never. |

## Orders / server

| Problem | Fix |
|---|---|
| "Something went wrong" when creating an order | Check `data/server.log`. Most common: disk full or the database file locked by a second server instance — run only one `npm start`. |
| Duplicate order numbers | Shouldn't happen (SQLite assigns them inside a transaction). If the DB was manually edited, run `npm run reset:demo` (wipes orders). |
| Prices changed in Admin but kiosk shows old | Hard refresh once (server worker is network-first, but an open tab may be cached). Server pricing is always authoritative at checkout — the client price is display-only. |
| Tax looks wrong | Tax is a single server-side percent on the subtotal (Admin → Settings → `tax_percent`). Set `0` to disable. |

## Printing

| Problem | Fix |
|---|---|
| No print after paid order | Admin → Printer: check status + queue. Driver `simulated` writes to `data/prints/` instead of hardware. |
| Print job failed | Fix the printer (power/IP/pairing), then **RETRY** on the failed job in Admin → Printer — orders are never lost, they stay queued. |
| Garbled characters | Wrong codepage on the printer; see docs/PRINTER_SETUP.md. |
| Bill too wide/narrow | Set `paper_width_chars` (32 for 80mm, 48 for 112mm) in Admin → Billing and re-print. |

## Payments (placeholder until PhonePe)

| Problem | Fix |
|---|---|
| PAY NOW shows "gateway not configured" | Expected — payment is a placeholder. Use Admin → Orders → **Mark paid (test)** to run the full flow without money. |
| Need to clear test orders | `npm run reset:demo` re-seeds menu + settings and wipes orders. |

## Dev commands

```bash
npm run seed         # add demo menu if missing (idempotent)
npm run reset:demo   # wipe + reseed everything
npm test             # unit tests (QR, order engine, receipts, ESC/POS)
```

Database lives at `data/kiosk.db` (SQLite) — back that file up; it contains
menu, settings, orders, print queue.
