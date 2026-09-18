# Compact sidebar header

The large accent button and permanent search field compete with the Projects
tree. Match the footer's quieter controls and give the project list more room.

- Use one compact row: a neutral, labeled New session action and a search icon.
- Keep Add project beside the Projects heading, including during an unmatched
  search. The first-project empty state and collapsed sidebar retain creation.
- Reveal search on click or Ctrl+K. The shortcut expands a collapsed or hidden
  sidebar and focuses the field after it mounts.
- Keep active filters visible. Escape clears the query first, then dismisses
  search; the field's clear/close button follows the same behavior.
- Preserve opt-in standalone Agent creation, keyboard shortcuts, theme colors,
  window dragging, sidebar resizing, and the existing footer.
- Search visibility is transient, not saved across app restarts.

Validate search focus and dismissal, creation entry points, and narrow/collapsed
layouts in an isolated Electron profile. Queue this polish for a later release;
do not change the version or publish a release for this task.
