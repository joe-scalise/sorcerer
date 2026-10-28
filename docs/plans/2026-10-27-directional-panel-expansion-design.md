# Directional panel expansion

## Agreed behavior

Keep three panels visible when expanding one across a neighboring split. With panels 1 and 2 side by side above panel 3, expanding panel 2 vertically produces a full-height right column, with panels 1 and 3 stacked on the left. The user confirmed this diagram and behavior. Horizontal expansion is the transposed operation.

## Implementation

At a T junction, promote the selected leaf's parent split above its perpendicular parent. Keep each split's ratio on its original axis, and keep all branch IDs, leaf IDs and session/content assignments. This works on either side and within nested layout regions; unrelated regions stay untouched. It supports session, quick-terminal, experimental Agent, notes and empty panels.

Panel menus and sidebar context menus offer Expand horizontally and Expand vertically. A direction is disabled if the panel has no adjacent perpendicular split to expand across. This does not add a panel, close a neighbor, or maximize the entire workspace. Expansion keeps the chosen panel focused, exits maximized mode, and persists through the existing layout storage.

The earlier interpretation of adding vertical split buttons was discarded after clarification. New terminals and notes retain their existing creation behavior. Expansion operates on panels already in the layout.

## Validation

Cover the three-panel example, both axes and all four relative positions, unequal ratios, nested neighboring groups, unavailable actions and immutable input trees. Verify panel IDs/content and total area are preserved, plus focus, maximized-state recovery and persistence. Exercise the actual panel menu for all five content types.

Inspect the rendered result in an isolated Electron profile with actual xterm instances and verify the same terminal DOM nodes survive rearrangement. Test reduced window sizes and divider ratios. Nested flex containers need min-width: 0 so terminal content can shrink with its new column instead of clipping panel controls.

No version bump or release; batch with the Codex question-key fix for the next requested release.

Completed validation: 321 tests passed, including 18 new expansion tests; TypeScript checking and the production build passed. Isolated Electron rendering verified both axes, original xterm DOM identity, all three panels retained, dragging both dividers after expansion, and a reduced-width window. The mechanical design scan reported only existing accent-border/easing rules outside this change.
