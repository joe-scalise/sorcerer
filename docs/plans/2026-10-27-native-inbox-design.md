# Native inbox

The inbox is a small human-owned capture surface docked at the far right of the main window, opposite project/session navigation. It inherits Sorcerer's typography, theme tokens, borders, and compact controls. The user approved this direction in the feature discussion.

## Scope

Capture a title, optional details/links, and an optional project. Users can edit, pin, manually mark done, archive, restore, and permanently delete captures after confirmation. The default view shows open captures, pinned first; users can reorder items within each pin group. Done and archived items remain available in separate views. A project filter supports reviewing related thoughts, and the current view can be exported as CSV. The dock and capture area collapse independently; Ctrl+Shift+I opens capture. Settings can hide the dock, and its width can be resized.

All records belong to the user. There are no session references, agent/provider events, automatic task generation, execution controls, inferred states, or prompt insertion. Capture works with no sessions running. Project removal clears the association rather than deleting captures.

## Persistence and boundaries

A dedicated SQLite table stores captures with an optional project foreign key using ON DELETE SET NULL. Typed create/update/list handlers serve Electron IPC and the existing authenticated browser RPC. Validate user fields before writing; surface errors without clearing drafts. Existing notes and session restoration remain separate. Panel preferences and unfinished local drafts use renderer persistence; saved captures use the database.

## Interaction

The expanded dock uses a quiet header, compact capture form, project filter, Open/Done/Archived views, and a scrollable list. Details are optional. Capture and edit use explicit save actions. Pin, reorder, delete, and manual status actions are accessible from each item. Archive is reversible; permanent deletion requires confirmation. Loading, empty, failed load/save, long text, collapsed, and narrow-window states are part of the implementation. Inbox keyboard interactions must not operate on terminals or close sessions.

## Validation

Verify database persistence through reopen, state transitions, input validation, safe project removal, and write failures. Verify UI capture/edit/error recovery, collapse, project filtering, shortcut behavior, and independence from sessions. Run typecheck, build, relevant regression tests, and visually inspect an isolated browser preview at desktop and narrow widths. Do not run development against the user's normal database. No version bump or release.
