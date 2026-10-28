# Codex question keyboard routing

## Problem and evidence

Codex question controls must remain usable inside Sorcerer's terminal. The reported shortcut was Shift+Right or a similar combination. An isolated Electron harness with real xterm and the actual main/pop-out React components confirmed Shift+Left/Right already emit their modified arrow sequences. A native Windows node-pty probe also preserved Shift+Left/Right and Shift+Tab modifiers.

There is a confirmed conflict with Alt+Up/Down: TerminalView deliberately bypasses xterm for those keys, and useKeyboardShortcuts switches sessions. [Codex 0.163.0's keymap](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/tui/src/keymap.rs) binds Shift+Left or Alt+Up to its forward/edit action, and Shift+Right or Alt+Down to its backward action. The shortcut shown by the CLI determines the intended action. The precise reported Shift+Right failure remains unconfirmed pending the user's exact prompt/context.

## Decision

Move Sorcerer's session navigation to Ctrl+Alt+Up/Down, matching exact modifiers. Let xterm encode Codex's question keys normally in every terminal, without synthesizing extra input or parsing prompt text. Update the Settings shortcut reference and provider guide.

Alternatives considered: provider-specific interception would make keyboard behavior inconsistent between sessions; a separate question UI would require a structured provider protocol and duplicate Codex's interface. Neither is necessary for the confirmed shortcut conflict.

## Validation and scope

Test both terminal handlers and global shortcuts, preserving Shift arrows, Alt arrows, Tab/Shift+Tab, Enter and Escape. Check that app navigation still works and additional modifiers are not intercepted. Exercise real Electron/xterm input and Windows PTY modifiers in an isolated profile without reading or modifying live session data. Run typecheck, relevant tests and build.

No CLI configuration or permissions changes. No version bump or publication; batch this fix for the next requested release. Installed application and a live Codex question still need user confirmation.

Validation completed: 18 targeted regression tests, TypeScript checking and production build passed. An isolated Electron harness using the actual main/pop-out components and real xterm passed nine keystrokes per surface without drops or duplicate input. A native Windows ReadConsoleInputW probe through node-pty confirmed Shift and Alt modifiers on the arrow keys, plus Shift+Tab, Down and Enter. A preliminary Console.ReadKey probe filtered Alt-arrow events, so the raw Windows console event probe was used to validate those keys.
