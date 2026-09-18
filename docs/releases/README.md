# Release Notes Guide

`docs/releases/` is the source of truth for Sorcerer's curated release notes.

Every tagged release should have a matching file named:

- `vX.Y.Z.md`

## Required format

Every release note file must include all of the following:

1. Title
   `# Sorcerer vX.Y.Z`
2. Release date
   `Released: YYYY-MM-DD`
3. `## Highlights`
4. `## Fixes and polish`
5. `## Notes`

Do not omit any of the three section headers, even for small releases.

## Content rules

### Highlights

- Major features
- User-visible workflow changes
- Important platform or architecture upgrades

### Fixes and polish

- Bug fixes
- UI cleanup
- Behavior hardening
- Reliability improvements

### Notes

- Release lineage, such as "includes all commits since `v1.7.14`"
- Packaging or CI caveats
- Supersession notes when one tag replaces another

## Authoring flow

1. Copy [TEMPLATE.md](./TEMPLATE.md).
2. Fill in all three required sections.
3. Save the file as `docs/releases/vX.Y.Z.md`.
4. Set the same version in `package.json` and `package-lock.json`; run `npm run release:check`, `npm test`, `node --test scripts/release-checks.cjs`, and `npm run verify`.
5. Open the release preparation PR. Run the **Release** workflow manually on its branch for a packaging rehearsal. Manual runs upload downloadable workflow artifacts and do not create or publish a release.
6. Verify all four installers, Windows blockmap, both updater manifests, native/app smoke checks, and `SHA256SUMS.txt`. Perform interactive install/upgrade checks on the supported platforms, including terminal input, popouts, restart, and clean shutdown. Confirm signing status and document unsigned builds honestly.
7. Merge the reviewed release commit, then create and push its matching tag. The tag workflow stages a **draft** GitHub release with the curated body; it refuses to modify an already published release.
8. Review the draft's version, source commit, notes, complete asset set, and checksum file before explicitly publishing it as the desktop Latest release. If the intended release date changed during review, update the note before tagging.

## Release candidate assets

Each desktop release requires Windows x64 `.exe`, macOS x64 and arm64 `.dmg`, and Linux x64 `.AppImage` installers. Filenames include the version and architecture; AppImage uses `x86_64`. It also requires the Windows `.exe.blockmap`, `latest.yml` for Windows, and `latest-linux.yml` for Linux. The final workflow artifact is named `Sorcerer-vX.Y.Z-release-candidate` and includes `SHA256SUMS.txt` covering all seven assets.

The release validator checks each updater manifest's version, installer filename, file size, and SHA512 against the packaged artifact. It rejects missing assets, extra files, paths outside the release, and external download URLs. Upload the complete validated set together: an installer alone does not provide a working managed update.

Verify downloaded installers with `sha256sum -c SHA256SUMS.txt` on Linux, `shasum -a 256 -c SHA256SUMS.txt` on macOS, or `Get-FileHash -Algorithm SHA256` on Windows and compare each value to the manifest.

Native checks use the same Electron runtime as packaging. `node scripts/smoke-native.cjs --packaged` loads the PTY and SQLite WASM from packaged resources. `node scripts/smoke-app.cjs --packaged` boots the packaged app code and preload twice in a disposable profile to verify persistence and shutdown. Linux app checks need an X display (CI uses `xvfb-run`). These automated checks do not replace installer/upgrade QA.

For local Windows builds from PowerShell, use `npm.cmd run build:win -- --x64 --publish never` so npm's PowerShell wrapper does not consume the builder flags. A source rebuild of node-pty requires Visual Studio's matching Spectre-mitigated C++ libraries. The node-pty package also supplies native prebuilds; validate any packaged build with the smoke commands above.

Android uses its own `android-v*` release flow and must not replace the desktop release marked Latest.

## Desktop update rollout

Existing v1.8.0 installations require one manual download and installation of the first version that includes the updater. Managed updates then support the Windows NSIS installation and Linux AppImage. Linux users must launch the installed AppImage; unpacked development builds are not managed update targets.

macOS continues to use manual DMG downloads. Managed macOS updates require a separately validated signing/notarization and ZIP update path; this release pipeline does not publish a macOS updater manifest or ZIP.

electron-builder is configured for the stable `latest` channel on `joe-scalise/sorcerer`. Packaging always uses `--publish never`; the workflow validates metadata before staging a draft. Drafts and packaging rehearsals must not be offered to installed clients. Publish the reviewed desktop release as Latest only after installer and update QA, keeping its matching manifests and blockmap attached. Never replace assets on an already published version.

Before shipping the updater's first version, test Windows and Linux against a newer candidate version in a controlled update feed: check availability, download, restart/install, preservation of sessions/settings, offline failure, and retry. For later releases, repeat an upgrade from the previously published updater-enabled version. GitHub downloads and hash verification do not replace operating-system code signing; record the signing status independently.

## GitHub release rule

GitHub releases should not be left with autogenerated changelog bodies when a curated note exists here.
If `docs/releases/vX.Y.Z.md` exists, the GitHub release body should match it closely.
