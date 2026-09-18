# Sorcerer Remote for Android

Sorcerer Remote is a thin Android companion for a running Sorcerer Desktop
host. It loads the host-served `/rc` experience in a hardened WebView; agents,
PTYs, git worktrees, and the Sorcerer database remain on the desktop.

The first release supports session and agent status, terminal interaction, and
resume/restart operations. It is not a standalone Sorcerer runtime and does not
expose desktop settings, provider secrets, filesystem operations, or arbitrary
desktop RPC.

## Pair a phone

1. In Sorcerer Desktop, enable Remote access on a LAN- or VPN-reachable address.
2. Create a one-time mobile pairing code in **Settings → Remote**.
3. Scan the QR code with the phone's camera, then confirm the decoded desktop
   origin in Sorcerer Remote. You can also enter the host, port, and code in the
   app.
4. Grant **Local network** access when Android 17 or later requests it. Ordinary
   HTTPS DNS names are resolved on a background worker, so public reverse
   proxies do not trigger the LAN permission prompt.

The QR contains a package-bound Android intent URI shaped like:

```text
intent://pair?scheme=http&host=192.168.1.10&port=7437&code=ONE_TIME_CODE&v=1#Intent;scheme=sorcerer-remote;package=com.aetherci.sorcerer.remote;end
```

Android delivers its `sorcerer-remote://pair?...` data only to the permanent
release package. It never contains a permanent credential. The app exchanges
the short-lived, single-use code at `POST /api/mobile/v1/pair`. The returned
per-device token is stored as part of an AES-GCM encrypted record whose key is
non-exportable from Android Keystore. Backups and device-to-device transfer are
disabled and explicitly exclude all app data. Re-pairing never replaces a
working connection until the user confirms and the exchange succeeds.

## Supported network model

HTTP exists for trusted private LANs and encrypted VPNs because a phone cannot
normally validate a certificate for an ad-hoc private IP address. This is the
intentional cleartext warning reported by Android lint. Do not port-forward the
Sorcerer remote port or expose it directly to the public internet.

For routed connections, use HTTPS through a trusted reverse proxy or tunnel.
The app uses the Android system trust store and always cancels certificate
errors; it has no insecure certificate bypass. The WebView accepts only the
configured HTTP(S) origin, blocks cross-origin subresources, file/content access,
mixed content, popups, downloads, Web permissions, third-party cookies, and
JavaScript bridges. External HTTP(S) links open in the system browser only after
a user gesture and after any fragment is removed.

## Build and test

Requirements:

- Android SDK Platform 37 and Build Tools 36.0.0
- JDK 17 or a current Android Studio JBR (the project emits Java 17 bytecode)
- An Android 8.0 (API 26) or newer device/emulator

From `android-client`:

```powershell
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
.\gradlew.bat lint testDebugUnitTest assembleDebug
```

The debug APK is written to:

```text
app/build/outputs/apk/debug/app-debug.apk
```

Run device tests when an emulator or phone is connected:

```powershell
.\gradlew.bat connectedDebugAndroidTest
```

Instrumentation covers Keystore persistence, cold-start deep-link confirmation,
and activity recreation. Before a release, also complete the physical-device
checks in the repository's Android release checklist: Wi-Fi/VPN pairing,
terminal input and scrollback, rotation, keyboard resizing, background/foreground,
network loss, host restart, permission denial/revocation, device revocation,
fresh install, and signed upgrade.

## Sideload a debug build

Enable USB debugging, connect the phone, then run:

```powershell
adb install -r app\build\outputs\apk\debug\app-debug.apk
```

The debug build uses package ID `com.aetherci.sorcerer.remote.debug`; the release
package ID is permanently reserved as `com.aetherci.sorcerer.remote`. Because
desktop QR codes are bound to the release package, use manual host/code entry
when testing the debug build.

## Versioning and release signing

CI supplies versions as Gradle properties:

```powershell
.\gradlew.bat assembleRelease -PversionName=0.1.0 -PversionCode=1000
```

A release is signed only when all four environment variables are present:

- `ANDROID_KEYSTORE_PATH`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

Without them, `assembleRelease` intentionally creates an unsigned local APK.
Never commit a keystore, passwords, `local.properties`, or generated APKs. Keep
the permanent release key outside the repository with an offline backup: Android
will accept upgrades only when they use the same package ID and signing identity.
