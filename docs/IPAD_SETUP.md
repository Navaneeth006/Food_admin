# iPad Air 2 Setup (Kiosk)

## 1. Put the server on the truck's Wi-Fi

- Run the server on any always-on machine (laptop/mini-PC) on the same network
  as the iPad: `npm start`.
- Find its LAN IP (`ipconfig` on Windows, `ifconfig`/`ip a` on Mac/Linux).
- From the iPad Safari, open `http://<SERVER-IP>:4242/` — you should see the menu.
- Give the server machine a **static IP** (or DHCP reservation in the router) so
  the URL never changes.

## 2. Install as a Home-Screen app (fullscreen kiosk)

1. In **Safari**, open `http://<SERVER-IP>:4242/`
2. Tap the **Share** button (square with ↑)
3. Scroll → tap **Add to Home Screen**
4. Name it `Kiosk` → **Add**

Open it from the Home Screen: it launches **fullscreen, landscape, no browser
bars**. (Do not open it from Settings app search or bookmarks — always the
Home-Screen icon.)

> iPadOS ≥ 12 ignores `user-scalable=no` sometimes; the app also blocks pinch,
> double-tap and text selection in JS. If you still see a zoom: Settings →
> Accessibility → Zoom → OFF.

## 3. Keep the screen on

Settings → Display & Brightness → Auto-Lock → **Never**.
(Enclosure keeps the tablet plugged in; screen stays wake-ready for customers.)

## 4. Guided Access (recommended for public kiosks)

Locks the iPad to the Kiosk app and blocks the Home button:

1. Settings → Accessibility → Guided Access → ON
2. Passcode Settings → set a staff passcode
3. Open the Kiosk app → triple-click the Home button → **Start**

Exit (staff only): triple-click Home → passcode → End.

## 5. Auto-reset behaviour

After the success screen the kiosk returns to a fresh menu automatically
(`auto_reset_seconds`, default 20 — configurable in Admin → Settings). The
previous customer's cart is always wiped; nothing carries over.

## 6. Offline behaviour

- Short Wi-Fi drops: the menu keeps loading from the service worker cache;
  the cart survives reloads (localStorage).
- If the menu can't load: a "CONNECTING…" screen with a RETRY button appears.
- Payment (once integrated) requires connectivity — orders are never marked
  paid without the gateway confirming server-side.

## 7. Updating the app after deployment

Just change files on the server — the iPad fetches the newest shell on next
launch (service worker is network-first). If something looks stale: close the
Kiosk app (swipe away) and reopen once.
