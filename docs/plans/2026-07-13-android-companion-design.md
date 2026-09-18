# Android Companion Design

**Date:** 2026-07-13

**Status:** Approved for implementation

## Scope and architecture

Sorcerer Remote is a companion for a running Sorcerer desktop host. It does not
spawn providers, manage git worktrees, or copy the desktop database to Android.
The first sideloadable release supports the existing remote-control workflow:
view sessions and agents, inspect terminal output, type into active terminals,
and resume or restart idle work. Project creation, desktop settings, filesystem
operations, popouts, and full desktop administration are out of scope.

The desktop remains authoritative. A small Kotlin application stores one host
connection and loads the host-served `/rc` interface in a hardened WebView. The
mobile page talks to a dedicated, versioned mobile HTTP/WebSocket surface. It
does not receive the unrestricted Electron or browser-remote API. Existing
Electron IPC remains unchanged, and remote access remains disabled by default.

Implementation starts from current `main`. The stale `sorcerer/android-app`
worktree remains untouched as a reference. Useful connection, settings, icon,
and WebView lifecycle ideas may be ported, but its old desktop diffs, lockfile,
and build scaffold are not merged.

## Pairing, authentication, and data flow

Desktop Settings creates a short-lived, single-use pairing code and renders a
QR deep link containing only the reachable host, port, scheme, and pairing
code. It never embeds the long-lived remote credential. The Android app shows
the decoded connection for confirmation, exchanges the code for a random
per-device token, and stores that token using Android Keystore-backed
encryption. Pairing codes expire quickly and cannot be replayed.
The QR uses a package-bound Android intent so another installed custom-scheme
handler cannot intercept and redeem it.

The host stores only a hash of each device token together with a device ID,
display name, creation time, and last-used time. A device can be revoked without
rotating every other connection. Regenerating the legacy browser token updates
the running server immediately and invalidates the previous token.

Mobile tokens can access only a narrow allowlist: protocol information, theme,
project/session/agent summaries, session or agent resume/restart, terminal
subscribe/write/resize, and terminal exit/data events. Arbitrary settings,
provider secrets, destructive project operations, filesystem paths, and
desktop-shell APIs are unavailable. The HTTP surface uses named request objects,
typed error codes, a body-size limit, and a protocol version. WebSocket
authentication applies the same scope checks.

The supported network threat model for the first release is a trusted LAN or an
encrypted VPN. Direct exposure of port 7437 to the public internet is explicitly
unsupported. HTTP remains available for private-address hosts, while HTTPS is
supported for users providing a trusted reverse proxy or tunnel.

## Android behavior and error handling

The Android project uses a current stable Android toolchain, targets API 37,
and keeps API 26 as the minimum. It requests Android's local-network permission
before connecting to private network addresses and provides actionable states
for denial or later revocation. The connection editor validates HTTP/HTTPS,
IPv4, IPv6, DNS names, and port ranges before saving.

The WebView may navigate only within the configured origin. File access,
content access, mixed content, unnecessary database storage, and third-party
cookies are disabled. Safe Browsing remains enabled. External links open in the
system browser without forwarding credentials. Credentials are excluded from
backup, and importing a QR connection never silently replaces an existing
connection.

The app distinguishes missing configuration, unreachable host, authentication
failure, incompatible protocol, local-network permission denial, and transient
disconnects. Retry and Edit Connection actions are always available. Android
15+ window insets, predictive back, rotation, process recreation, soft-keyboard
resizing, and foreground reconnection are handled explicitly. The server page
removes credentials from visible URLs after bootstrap and resubscribes terminal
channels after reconnect.

## Verification and release

Host tests cover pairing expiry and replay, device-token hashing and revocation,
mobile RPC allowlisting, secret-setting denial, token rotation, WebSocket scope,
request limits, and protocol negotiation. Android unit tests cover URL parsing,
IPv6, invalid inputs, pairing payloads, token persistence, and origin checks.
Instrumentation tests cover cold-start pairing, new intents, permission denial,
WebView navigation, and lifecycle restoration.

CI runs the existing desktop verification plus Android wrapper validation,
lint, unit tests, and debug assembly. Emulator instrumentation may run in a
separate non-blocking job initially, but the release checklist requires a real
device pass over Wi-Fi or VPN. Acceptance includes terminal input and
scrollback, resume/restart, keyboard behavior, rotation, background/foreground,
network loss, desktop restart, revocation, token rotation, fresh installation,
and upgrade installation.

Android uses independent `android-v*` tags. The release workflow imports a
long-lived signing key from protected secrets, derives a monotonic version
code, builds and tests an unsigned APK in a read-only job, and signs it in a
separate protected job. It then verifies the APK with `apksigner`, records
package metadata, and publishes the renamed APK plus a SHA-256 checksum. The
package ID and signing certificate are selected before the first distributed
release and registered for Android developer verification when distribution
expands beyond personal ADB installs.
