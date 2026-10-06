# GitHub APK build

GitHub Actions builds the Android APK for this phone-hosted kiosk when changes
are pushed to `app_kiosk/`, and also on a manual workflow run.

## Files included

- `app_kiosk/public/connect.html` — phone connect page
- `app_kiosk/public/kiosk.html` — iPad kiosk page
- `app_kiosk/public/index.html` — in-app admin and server settings
- `app_kiosk/server/app.js` — backend server
- `app_kiosk/android` — Capacitor Android project
- `.github/workflows/android-apk.yml` — GitHub Actions build workflow

Admin controls are available only inside the Android app; no web admin page is
served to devices on the shared Wi-Fi network.

## Download the phone-hosted kiosk APK

1. Open the repository on GitHub and select **Actions**.
2. Open the successful **Build Android APK** workflow run.
3. Download the **`app-kiosk-debug-apk`** artifact and extract `app-debug.apk`.

The local build output is:

`app_kiosk/android/app/build/outputs/apk/debug/app-debug.apk`

The same workflow also builds the separate legacy project in `foodtruck-apk/`;
its artifact has a different name.

## Notes

- This is a debug APK for testing.
- For production, use a release signing configuration.
- The app is designed for a phone-hosted server + iPad kiosk flow.
