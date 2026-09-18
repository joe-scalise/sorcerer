# Desktop updates

Sorcerer should keep users informed about upgrades without interrupting terminal or agent work. The current GitHub release link requires a manual installer download and hides check failures. Agent Orchestrator demonstrates a clearer lifecycle with shared status, progress, release notes, and an explicit restart decision.

## Approach

Three options were considered: improve the release link only; use electron-updater for the existing NSIS/AppImage packages; or build a custom cross-platform installer. Use electron-updater for Windows and Linux, with manual release downloads on unsigned macOS and development builds. This delivers managed updates without duplicating installer or integrity verification machinery. Mac managed updates need signing and ZIP release payloads before enabling them.

Automatic checks retain the existing setting and startup/two-hour schedule. Background downloads have a separate preference, initially enabled; installation always requires an explicit action and native confirmation. Never install on ordinary quit. A failed check must be shown as an error, not as an up-to-date result. Staged updates remain visible while subsequent checks run or fail.

## Interface

A compact titlebar button shows update availability, download progress, or readiness. It opens an update dialog with installed and target versions, readable release notes, progress, check/retry/download actions, and a restart action only when the payload is ready. Settings exposes the same state and a Check now button plus separate check/download preferences. Keep the existing dark theme, typography, spacing, and dialog focus behavior. Remote browser clients cannot control desktop updates.

## Architecture and restart safety

The main process owns update state, polling, download operations, and installation. A revisioned typed IPC snapshot and subscription keep every renderer consistent. Subscribe before requesting a snapshot and discard stale revisions. Serialize operations and use only the stable GitHub desktop feed; no downgrade, prerelease, Android release, or arbitrary renderer URL may become an installer source.

Before installer handoff, confirm the restart and flush note drafts in every window through verified request/acknowledgement IPC. Reject on failed saves, missing acknowledgements, or timeout. Stop agent orchestration and PTYs and await session exit persistence before calling quitAndInstall. No update may silently interrupt running work.

## Distribution and validation

Publish Windows latest.yml and installer blockmap, and Linux latest-linux.yml alongside the four existing installers. Verify every feed version, referenced filename, size, and SHA-512 hash before drafting a release; include all payloads and metadata in SHA256SUMS.txt. Checksums are integrity checks, not publisher identity verification; Windows remains unsigned until signing is configured.

Test state transitions, concurrent requests, download/check failures, staged-state retention, renderer revision races, restart cancellation, failed note persistence, and malformed feed metadata. Run production build, regression tests, native/package smoke, and packaging rehearsal. Actual installed-version upgrade testing remains required before publishing the updater-enabled version. Existing v1.8.0 and older installs need one manual upgrade to acquire the updater.

Reference: https://github.com/Untrivial-ai/agent-orchestrator/tree/6d3ad8c7ca8dca475c140d2ec96d7e8ba703e18b/frontend/src
