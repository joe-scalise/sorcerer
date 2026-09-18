# Code Signing Setup Guide

Desktop signing is optional in the current release pipeline. A successful build or draft release does **not** establish that an installer is signed or notarized. Verify the exact downloadable artifacts before making those claims.

- **Windows:** `scripts/sign-windows.js` is an unused helper. `package.json` does not connect it to electron-builder or configure Azure signing. Adding Azure secrets or installing the CLI extension alone does not enable signing. Treat Windows releases as unsigned until a signing integration is implemented and verified.
- **macOS:** the workflow conditionally imports a Developer ID certificate, and `build.afterSign` invokes `scripts/notarize-macos.js`. The hook skips notarization when the Apple ID or app-specific password is absent. These credentials are optional; successful packaging is not proof of Developer ID signing or notarization.
- **Android:** its independent release workflow requires signing credentials and verifies the APK signature before publication.

Signing establishes publisher identity and artifact integrity. It does not guarantee the absence of operating-system reputation prompts; see [Microsoft's SmartScreen guidance](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation).

---

## Enrollment and pricing

Check current [Apple Developer Program enrollment](https://developer.apple.com/programs/enroll/) and [Azure Artifact Signing information](https://learn.microsoft.com/en-us/azure/artifact-signing/overview) before purchasing or configuring signing services. This guide does not enable either service automatically.

---

## macOS Setup

### 1. Join the Apple Developer Program

- Go to https://developer.apple.com/programs/
- Enroll as an individual or organization ($99/year)
- Allow time for Apple's enrollment and identity checks.

### 2. Create a Developer ID Application Certificate

**Option A: Via Xcode**
1. Open Xcode → Settings → Accounts → Manage Certificates
2. Click `+` → "Developer ID Application"
3. The certificate is created and installed in your Keychain

**Option B: Via Apple Developer Portal**
1. Go to https://developer.apple.com/account/resources/certificates/list
2. Click `+` → "Developer ID Application"
3. Follow the CSR (Certificate Signing Request) flow
4. Download and install the .cer file

### 3. Export the Certificate as .p12

1. Open **Keychain Access** on your Mac
2. Find the "Developer ID Application" certificate under "My Certificates"
3. Right-click → "Export" → choose `.p12` format
4. Set a strong password (you'll need this for CI)
5. Base64-encode it for GitHub Actions:
   ```bash
   base64 -i DeveloperIDApplication.p12 | pbcopy
   ```
   This copies the base64 string to your clipboard.

### 4. Generate an App-Specific Password

1. Go to https://appleid.apple.com → Sign In
2. Navigate to "App-Specific Passwords"
3. Click "Generate" → name it "Sorcerer CI"
4. Save the generated password

### 5. Find Your Team ID

1. Go to https://developer.apple.com/account → Membership Details
2. Your Team ID is a 10-character alphanumeric string

### 6. Add GitHub Actions Secrets

Go to your repo → Settings → Secrets and variables → Actions → New repository secret:

| Secret Name | Value |
|-------------|-------|
| `MAC_CERTIFICATE_BASE64` | The base64-encoded .p12 from step 3 |
| `MAC_CERTIFICATE_PASSWORD` | The password you set when exporting the .p12 |
| `APPLE_ID` | Your Apple ID email address |
| `APPLE_APP_SPECIFIC_PASSWORD` | The app-specific password from step 4 |
| `APPLE_TEAM_ID` | Your 10-character Team ID from step 5 |

### Verification

For a release intended to be notarized, require a Developer ID signing identity and all five secrets above, then check the build logs for:
```
[notarize-macos] Notarizing: .../Sorcerer.app
[notarize-macos] Notarization complete
```

Verify the downloaded app on a Mac; log messages alone are insufficient:
```bash
spctl --assess --verbose=4 --type execute "Sorcerer.app"
# Should output: accepted, source=Notarized Developer ID

codesign --verify --deep --strict "Sorcerer.app"
# Should output: valid on disk, satisfies its Designated Requirement
```

---

## Windows Setup (future integration)

Windows signing is not currently wired into the desktop build. The existing
`scripts/sign-windows.js` helper and workflow Azure environment variables are
preparatory code, not a working signing contract. Do not add credentials expecting
that helper to run automatically.

Before enabling signing:

1. Choose a public-distribution signing service and complete its identity validation.
   Public Trust and Private Trust have different purposes; consult
   [Microsoft's trust model documentation](https://learn.microsoft.com/en-us/azure/artifact-signing/concept-trust-models).
2. Implement the integration supported by the repository's installed builder version.
   For electron-builder 26, see its [Windows signing documentation](https://www.electron.build/v26/docs/features/code-signing/code-signing-win/).
   Review the existing helper before deciding whether to use or replace it.
3. Scope signing credentials to a protected release context and make an intentionally
   signed build fail when credentials or signing are incomplete.
4. Verify both the packaged application executable and downloaded installer, including
   their expected publisher identity, before advertising a signed release.

On Windows, inspect the actual release candidate:

```powershell
Get-AuthenticodeSignature '.\Sorcerer-1.8.0-win-x64.exe' |
  Format-List Status, StatusMessage, SignerCertificate
```

`Valid` is required for a signed-release claim. `NotSigned` must be disclosed as
unsigned. Other results require investigation; a successful build is not a
substitute for signature verification. Even a valid public signature does not
promise immediate SmartScreen reputation.

---

## Android Setup

Sorcerer Remote is distributed as a directly installable APK. Android requires
the same package ID and signing certificate for every future update, so create
and back up the release key before publishing the first APK.

The permanent package ID is `com.aetherci.sorcerer.remote`.

### 1. Generate the release key

Use the JDK `keytool` command on a trusted machine:

```bash
keytool -genkeypair -v \
  -keystore sorcerer-remote.jks \
  -alias sorcerer-remote \
  -keyalg RSA \
  -keysize 4096 \
  -validity 10000
```

Use strong, unique passwords. Store the keystore and its recovery information
in at least two encrypted locations. Do not commit the keystore or passwords.
Losing this key prevents installed copies from receiving normal updates.

### 2. Encode the keystore for CI

macOS or Linux:

```bash
base64 < sorcerer-remote.jks | tr -d '\n'
```

PowerShell:

```powershell
[Convert]::ToBase64String(
  [IO.File]::ReadAllBytes((Resolve-Path .\sorcerer-remote.jks))
) | Set-Clipboard
```

### 3. Protect the signing environment

In the repository's **Settings → Environments**, create an environment named
`android-release`. Before uploading the permanent key:

- require at least one trusted reviewer and prevent self-review when available
- restrict deployments to `main` and Android release tags matching
  `android-v*`
- keep the keystore secrets environment-scoped, not available to ordinary CI

The workflow independently verifies that the release commit is contained in
`main`. It builds and tests the unsigned APK in a read-only job, then waits at
the protected environment before a separate job receives the signing secrets.

### 4. Add Android environment secrets

| Secret Name | Value |
|-------------|-------|
| `ANDROID_KEYSTORE_BASE64` | Base64-encoded keystore contents |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password |
| `ANDROID_KEY_ALIAS` | `sorcerer-remote` |
| `ANDROID_KEY_PASSWORD` | Private-key password |

Add all four values as secrets on the protected `android-release` environment.
The Android release workflow fails closed when signing credentials are absent;
it never publishes an unsigned APK.

### 5. Publish and verify

Push an independent Android tag:

```bash
git tag android-v0.1.0
git push origin android-v0.1.0
```

CI runs lint and unit tests, builds the signed APK, verifies its signature,
records package metadata, and publishes both the APK and its SHA-256 checksum.
Test both a clean install and an upgrade before announcing the release:

```bash
adb install Sorcerer-Remote-0.1.0.apk
adb install -r Sorcerer-Remote-0.1.1.apk
```

For distribution beyond personal ADB installs, register the package name and
signing certificate through the
[Android Developer Console](https://developer.android.com/developer-verification/guides/android-developer-console).

---

## How It Works in CI

The desktop workflow (`.github/workflows/release.yml`) validates the release,
rebuilds and checks native modules, packages platform installers, and collects
checksums. Manual runs produce workflow artifacts; desktop tag runs stage a
curated **draft** GitHub release for review before publication.

On macOS, certificate import runs only when its secret is configured. The
notarization hook requires Apple credentials; packaging without them may produce
an unsigned or ad-hoc-signed app that is not notarized. On Windows, the optional
Azure CLI setup does not connect the unused helper to electron-builder. Neither
platform currently guarantees signed output merely because the build passes.

Android uses a separate `android-v*` workflow and requires its signing key. Its
signing requirements do not imply desktop artifacts are signed.

### Desktop release disclosure checklist

Before publishing the draft:

- Inspect the exact downloaded Windows installer and macOS app, recording their
  signature results and publisher identity where present.
- For a notarized macOS claim, verify Gatekeeper acceptance and the notarization
  ticket on the downloaded distribution; signing alone is insufficient.
- State unsigned/not-notarized status in the curated release notes and keep the
  README download guidance consistent. Do not describe an ad-hoc signature as
  Developer ID signing.
- Explain that SmartScreen or Gatekeeper may prompt or block launch. Do not promise
  that signing removes every prompt, or tell users to disable system protection.
- Verify the published checksum file against the installers and complete fresh
  install and upgrade smoke checks before promoting the release.
- Publish only after the draft's platform artifacts and disclosures have been reviewed.

Suggested disclosure for a release verified to lack publisher signing:

> Windows installers are unsigned. macOS builds are not Developer ID signed or
> notarized. Your operating system may warn or block first launch. Download only
> from this release and verify the provided checksums before deciding whether to
> run it.

Adjust that wording to the actual results for each platform; do not infer the
signature status of one artifact from another.

## Troubleshooting

### macOS signing or notarization is missing

Check certificate import, the Developer ID identity selected by electron-builder,
and all Apple credentials. A message saying notarization was skipped means the
release must not be described as notarized. Assess the downloaded app with
`codesign --verify --deep --strict` and `spctl --assess --verbose=4 --type execute`;
verify ticket stapling separately for the distribution artifact.

### Windows installer is unsigned despite Azure secrets

This is expected with the current configuration: the helper is not wired into the
builder. Implement and verify the integration described above before expecting
signed output. Adding secrets alone is insufficient.

### Windows SmartScreen still shows a warning

First verify the signature and publisher on the downloaded installer. SmartScreen
also evaluates reputation; a valid signature is not a guarantee that a prompt
will disappear. Follow [Microsoft's developer guidance](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation).
