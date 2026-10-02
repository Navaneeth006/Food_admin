# iPad Setup — Standalone Kiosk (No Server Needed)

The file **`standalone/kiosk.html`** is the complete system in ONE file:
kiosk menu + cart + payment screen + bill printing + admin panel.
It runs entirely inside the iPad — no WiFi, no server, no installation.

> Default admin PIN: **1234** — change it in Admin → Settings → Security.

## 1. Transfer the file to the iPad (one time)

Pick whichever is easiest:

**Option A — USB cable (Finder / iTunes)**
1. Connect iPad → open **Finder** (Mac) or **iTunes** (Windows)
2. Select the iPad → **File Sharing** → **Safari** (or any Files-compatible app like Documents/Files)
3. Drag `kiosk.html` into the app's documents
4. On the iPad: **Files app** → On My iPad → <that app> → tap **kiosk.html**
   → it opens in a viewer → use **Share → Safari** (or "Open in Safari")

**Option B — just once over WiFi (still no server needed afterwards)**
1. Email/AirDrop/Google-Drive the `kiosk.html` file to yourself
2. Tap the attachment → Share → **Safari**

**Option C — Lightning/USB-C flash drive**
Copy the file to the drive → plug into iPad → Files app → tap → Share → Safari.

## 2. Install as a fullscreen kiosk app

1. In **Safari**, with `kiosk.html` open, tap the **Share** button
2. Scroll → **Add to Home Screen** → name it `Kiosk` → **Add**
3. Open it from the Home-Screen icon → runs fullscreen, landscape,
   no browser bars, **fully offline**

The file is self-contained — everything lives inside the iPad after this.
Transferring it again is only needed when you want to ship an update.

## 3. Data & settings on the device

- All data (menu, prices, orders, settings) is stored **in the iPad's local
  storage** for that Home-Screen app — private to the device.
- If you edit the menu or prices in Admin, they persist on the iPad.
- **Important:** clearing Safari website data, or deleting the Home-Screen app,
  erases the stored data. Use **Admin → Settings → Factory reset** to
  intentionally wipe.
- Orders survive Safari restarts; only a manual wipe erases them.

## 4. Printing

- Success screen → **🖨 PRINT BILL** opens the print sheet with the
  two-part receipt (customer bill + kitchen slip) laid out on one page.
- Use **AirPrint** — pick a WiFi printer from the print sheet, or
  "Save to Files" to keep a PDF copy.
- For a Bluetooth thermal printer that iOS can't see directly, print to PDF
  and send from a print-bridge app, or use the server version of this project
  (`server/` in the repo) which drives ESC/POS printers directly.

## 5. Keep it locked down (Guided Access)

1. Settings → Accessibility → Guided Access → ON, set a passcode
2. Open the Kiosk app → triple-click the Home button → **Start**
3. Also: Settings → Display & Brightness → Auto-Lock → **Never**

Staff exit the kiosk with a triple-click + passcode; customers can't leave.

## 6. Admin

- From the kiosk, tap the **⚙ button** (top right) → enter PIN (**1234** by default)
- Dashboard, Orders (reprint/cancel), Menu manager, Billing designer with live
  receipt preview, Settings (business info, GST %, order numbers, auto-reset,
  PIN change, reset tools)

## Troubleshooting

| Problem | Fix |
|---|---|
| Data wiped after clearing Safari | Expected — storage is per-app; don't clear website data for this app. |
| Print sheet doesn't open | Check Settings → Safari → Block Pop-ups → OFF for this flow, then tap PRINT again. |
| Wrong prices after an update | Admin → Settings → RESET DEMO MENU restores the demo prices (orders kept). |
| App feels stale after replacing the file | Close the Home-Screen app fully (swipe away) and reopen. |
