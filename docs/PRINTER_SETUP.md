# Thermal Printer Setup

The printing layer is driver-based — pick one in `.env` and restart:

| `PRINTER_DRIVER` | Use when | Config |
|---|---|---|
| `simulated` | No printer yet / testing | — (writes ESC/POS to `data/prints/*.bin`) |
| `escpos-network` | WiFi/LAN thermal printer (most common: 80mm POS printers) | `PRINTER_HOST`, `PRINTER_PORT=9100` |
| `escpos-usb` | Printer plugged into the server machine | needs `npm i escpos escpos-usb` (optional deps) |
| `escpos-serial` | Serial/parallel port printers | `PRINTER_DEVICE` |
| `bluetooth` | Bluetooth printer (incl. iOS proxies) | `BT_PRINTER_URL` — a tiny HTTP bridge that POSTs raw bytes |

## What prints

Every **paid** order prints two parts on one paper run:
1. **Customer receipt** — header, order #, items + extras, tax, total, footer
2. **Cut line** (`✂ CUT HERE ✂`)
3. **Kitchen slip** — huge order # + items only

Everything is customizable in **Admin → Billing** (name, address, GSTIN, phone,
footer, thank-you line, 32/48-column width, font scale, toggles) with live
preview.

## Recommended: network driver (simplest + most reliable)

1. Printer and server on the same network; find the printer IP
   (self-test print shows it, or the router's DHCP list).
2. `.env`:
   ```
   PRINTER_DRIVER=escpos-network
   PRINTER_HOST=192.168.1.87
   PRINTER_PORT=9100
   ```
3. Restart the server → **Admin → Printer → SEND TEST PRINT**.

## Bluetooth printer via bridge

iPad can't print raw ESC/POS over Bluetooth from a web app, so route through
the server: pair the BT printer with a small bridge device (Raspberry Pi /
old Android running a serial-to-HTTP app) and set `BT_PRINTER_URL=http://<bridge>/print`.
The server POSTs raw ESC/POS bytes; the bridge writes them to the printer.

## Reliability rules built in

- Prints happen **only after** payment is confirmed server-side.
- If the printer is unreachable the order is **never lost** — the job stays
  `failed` in the queue and can be retried from **Admin → Printer** (or
  **Orders → Reprint** on the order row).
- Print queue with attempts/errors is visible in **Admin → Printer**.

## Paper tips

- 80mm thermal roll, keep the spare in a dry drawer (thermal paper fades with
  heat + sunlight — don't store rolls in a hot truck cabin).
- Set `paper_width_chars=32` (80mm) or `48` (112mm) in Billing settings to match
  the printer.
- If text looks garbled: the printer's DIP/config may expect a different
  codepage — the driver sends CP437 by default; ₹ renders as `Rs.`
