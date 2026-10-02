# App Kiosk

This folder is the phone-hosted kiosk setup you described:

- Phone runs the backend server
- iPad connects to that server and opens the customer kiosk UI
- Phone also opens the admin panel
- The kiosk and admin pages are separate frontend screens served by the same backend

## Architecture

Phone (host):
- Node.js server
- SQLite or in-memory data store
- admin dashboard
- public kiosk page for the iPad

iPad (client):
- loads the kiosk front-end from the phone
- creates orders
- shows payment flow
- prints to Bluetooth/USB receipt device if supported

## Run locally

```bash
npm install
npm start
```

Then:
- Phone admin: http://localhost:4242/admin.html
- iPad kiosk: http://<phone-ip>:4242/

## Important note

This is for a local network setup. It is not a standalone offline app. It is for a phone-hosted server + iPad client architecture.
