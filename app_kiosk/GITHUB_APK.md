# GitHub APK build

This folder is ready to build an Android APK from GitHub Actions.

## Files included

- `app_kiosk/public/connect.html` — phone connect page
- `app_kiosk/public/kiosk.html` — iPad kiosk page
- `app_kiosk/public/admin.html` — phone admin page
- `app_kiosk/server/app.js` — backend server
- `app_kiosk/android` — Capacitor Android project
- `.github/workflows/android-apk.yml` — GitHub Actions build workflow

## How to generate APK

1. Push this project to GitHub.
2. Open the repository on GitHub.
3. Go to Actions.
4. Run the workflow named `Build Android APK`.
5. Download the generated APK from the artifact.

The APK output is produced at:

`app_kiosk/android/app/build/outputs/apk/debug/app-debug.apk`

## Notes

- This is a debug APK for testing.
- For production, use a release signing configuration.
- The app is designed for a phone-hosted server + iPad kiosk flow.
