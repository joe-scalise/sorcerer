# Background downloads and sidebar update notice

The live Windows 1.8.1 → 1.8.2 upgrade succeeded, as reported by the user. The next improvement makes background updates discoverable beside the profile and settings controls.

Automatic checks and downloads already default to enabled on supported installations. Keep the five-second startup check, two-hour polling interval, and existing opt-outs. Installation continues to require the native confirmation and safe note/session shutdown.

Use a persistent row inside the sidebar footer above the profile. Show version and download progress, then a Restart and install button when the package is ready. Clicking the status opens existing update details; clicking install uses the existing main-process confirmation. Errors stay visible and expose retry through details. The collapsed sidebar keeps an accessible update icon. Hide the notice when up to date and in remote web clients.

A transient popup could be missed, and a titlebar-only badge is too far from settings. Retain the existing titlebar entry for continuity, with the footer providing the persistent action the user requested. Reuse existing theme tokens and the shared revisioned update store; add no updater engine or dependencies.

Verify progress, ready, installing, errors, manual-update platforms, compact/collapsed layouts, and the existing automatic-download and restart-confirmation regressions. Preview only in an isolated profile so the installed application and its data remain untouched.
