# Sorcerer promotion readiness review

Reviewed the desktop app with three independent reviewers covering security, workflow reliability, and UI/UX. The direction is to preserve the existing warm, compact workbench design and prioritize trustworthy actions, recoverable failures, and keyboard behavior over adding features.

Implemented in this pass:

- Sanitize briefing and mission Markdown at display time, including archived output. Permit document formatting and HTTP(S) links; exclude executable markup, embedded media, styling, and native-protocol links. Use DOMPurify rather than a custom HTML sanitizer.
- Guard all Electron app windows, including popouts, against renderer navigation, redirects, and child-window creation. Validate browser-opening IPC and Git remote links. Handle malformed remote HTTP request targets without unhandled rejections.
- Refuse worktree-name collisions and preserve existing branches when attachment fails. Landing now requires a clean main/master checkout, including no untracked files. Failures before the squash begins cannot reset pre-existing user changes.
- Keep quick-note drafts outside editor components, flush pending edits on close/blur, serialize saves, reuse persisted note identity, and order deletion after in-flight saves. Show save status and retryable failures.
- Add modal naming, focus containment/restoration, nested-select Escape handling, accessible notification dismissal, and useful labels. Preserve action names while busy. Escape in a terminal or editor no longer closes its session.
- Prevent stale Git checks from changing creation options, refuse unknown landing health, keep custom model entry stable, and keep pending creation dialogs open. Failed destructive actions remain visible. Clarify immediate folder addition and the consequences of unattended mode.
- Prevent repeat context-menu actions and prevent an old action from closing a newly opened menu.
- Refresh compatible dependencies. Production-dependency audit reports zero findings; the full audit retains the Electron advisory below.

Validation: 166 tests across 18 files pass, including real temporary Git repositories, note persistence, malformed requests, navigation policies, untrusted Markdown, dialog races, and keyboard boundaries. TypeScript and production build pass. An isolated Electron render of the shared dialog controls was visually inspected; this is not a full installed-app/platform smoke test. No release was published.

Remaining priorities:

1. Make database file replacement atomic. A crash or interrupted direct write can corrupt the SQLite file. Tracked in [issue #26](https://github.com/joe-scalise/sorcerer/issues/26).
2. Upgrade Electron with native PTY, popout, packaging, and supported-platform smoke tests. Electron 40 remains flagged by [GHSA-9f4c-93c8-jc8g](https://github.com/electron/electron/security/advisories/GHSA-9f4c-93c8-jc8g). This pass applies the advisory's documented mitigation by denying window creation, but does not claim the runtime package is patched.
3. Improve first-run provider setup: show detected CLIs and a direct route to configure a missing provider before creating the first session. This is the highest-value next onboarding improvement.

Known limitation: failed note drafts are retained in the current window's memory for retry; they do not survive quitting that window/application. The changes protect panel/overlay closure and concurrent save ordering, not crash recovery of unsaved drafts.

Security findings were kept out of public issues and no security email was sent. The existing repository URL redirects to joe-scalise/sorcerer for issue tracking.
