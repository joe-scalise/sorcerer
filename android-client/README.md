# Sorcerer Android Client

This is a first-pass sideloadable Android wrapper for Sorcerer's existing mobile
remote-control surface at `/rc`.

## Scope

- Native Android shell
- Saved connection settings for host, port, scheme, and auth token
- Embedded `WebView` that loads `http(s)://HOST:PORT/rc?token=...`
- Custom `sorcerer-remote://connect?...` deep link for QR pairing from the desktop app
- Designed for testing against a desktop Sorcerer instance with Remote Access enabled

## Current limitations

- This app does not run Sorcerer locally on Android
- It depends on a desktop Sorcerer host running on the same network or otherwise reachable
- This workspace does not currently have Java/Gradle installed, so the Gradle wrapper was not generated here

## Expected next step

Open this folder in Android Studio and generate the Gradle wrapper there, or run:

```bash
gradle wrapper
```

Then build and sideload the debug APK.

## Desktop setup

From the main Sorcerer desktop app:

1. Open `Settings -> Remote`
2. Enable remote desktop
3. Copy the `Remote Control` URL or the auth token/host/port values
4. Enter those values into the Android client settings screen

Or, after the app is installed, scan the QR code shown in desktop Sorcerer under
`Settings -> Remote -> Android Pairing` and let Android open the app via the custom
`sorcerer-remote://` link.

## Repo placement

The Android client lives in `android-client/` so it can evolve independently from
the Electron desktop app while reusing the existing `/rc` transport surface.
