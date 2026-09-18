# Sorcerer Remote for Android

Sorcerer Remote is a companion for a running Sorcerer desktop app. The desktop
continues to own provider processes, terminals, git worktrees, and data. The
Android app provides the focused remote-control workflow: monitor sessions and
agents, view terminal output, type into active terminals, and resume or restart
idle work.

It does not run provider CLIs or git worktrees directly on Android.

## Requirements

- Android 8.0 (API 26) or newer
- A Sorcerer desktop host with Remote Access enabled
- A trusted LAN or an encrypted VPN between the phone and desktop

Do not expose Sorcerer's remote-access port directly to the public internet.
The first Android release supports plain HTTP for private LAN hosts and HTTPS
when a trusted reverse proxy or tunnel is available.

## Install a release APK

Android releases use independent tags such as `android-v0.1.0`. Each release
contains a signed APK and a matching `.sha256` checksum.

After verifying the checksum, install through Android's package installer or
with ADB:

```bash
adb install Sorcerer-Remote-0.1.0.apk
```

Install a newer version without clearing the saved connection:

```bash
adb install -r Sorcerer-Remote-0.1.1.apk
```

Normal updates require the same package ID and signing certificate as the
installed build. Do not mix locally debug-signed builds with release builds.

## Pair with the desktop app

1. Open Sorcerer desktop Settings and select **Remote**.
2. Choose a LAN-reachable bind address and enable Remote Access.
3. Under **Android pairing**, create a pairing QR code.
4. Scan the QR with the phone's camera and open it in Sorcerer Remote.
5. Confirm the desktop address shown by Android.
6. Grant local-network access when Android requests it.

The QR contains a short-lived, single-use pairing code, not the permanent
device credential. Pairing creates a separate token for that phone. The host
stores only its hash, and Android protects its copy with Android Keystore.
The QR is also bound to the production package ID so another installed app
cannot claim the custom link and race to redeem the code. Developers using the
separate `.debug` package should enter the displayed host, port, and code
manually.

If the QR expires, create a new one. Reusing an already accepted QR is rejected.

## Manage paired devices

Desktop Settings lists paired Android devices and their last-use times. Revoke
a lost or retired device there. Revocation takes effect immediately without
disconnecting other paired devices.

Changing the desktop address requires pairing or editing the connection again.
Sorcerer Remote never silently replaces an existing saved connection from a
deep link.

## Troubleshooting

### The phone cannot reach the desktop

- Confirm Remote Access is running.
- Do not use `127.0.0.1`; that address refers to the phone when used on Android.
- Confirm both devices are on the same trusted network or VPN.
- Allow Sorcerer through the desktop firewall on the configured private-network
  port.
- On Android 17 or newer, confirm Sorcerer Remote still has Local Network
  permission.

### Pairing is unauthorized or expired

Create a new QR in desktop Settings. Pairing codes expire after two minutes and
work only once.

### A previously paired phone stopped connecting

Check that the device was not revoked, the desktop address did not change, and
the remote-access server is still enabled. Use **Edit connection** or **Retry**
from the Android error screen.

## Build locally

Install Android Studio with JDK 17 and Android SDK 37, then run:

```bash
cd android-client
./gradlew lint testDebugUnitTest assembleDebug
```

The debug APK is written under `android-client/app/build/outputs/apk/debug/`.
Release signing and CI secret setup are documented in
[Code Signing Setup](plans/code-signing-setup.md#android-setup).
