# Projects first; standalone Agents opt-in

Projects become the default inner-app organization. Keep standalone Agents behind **Settings → General → Experimental features → Enable standalone Agents**, disabled unless explicitly opted in. Provider coding sessions, subagents, teams, terminals, and briefings within Projects remain available.

## Runtime boundary

The main process reads `featureStandaloneAgents` once after database initialization. Only the string `true` enables it. Expose the effective capability through `system:features` to desktop and remote renderers before they mount. Saving a different preference takes effect only after quitting and reopening Sorcerer; current work stays visible and running until normal shutdown.

When disabled, omit Agent trees, creation controls, menus, search/navigation entries, orphan recovery, run notifications, and Agent content in briefings. Return empty Agent lists to remote clients so their project-loading requests still work. Reject disabled mutations and launches centrally. Do not start the scheduler or auto-start Agents; do not reopen Agent popouts from stale layouts.

## Preservation

No deletion or conversion migration. Retain Agent definitions, groups, notes, run history, directories, and scheduling preferences. Re-enabling reveals the same data and resumes configured startup/scheduled runs. Disabled Agent panels are removed from the active restored workspace; this is not deletion of their underlying data. Keep existing Agent implementation files so the experiment can evolve independently.

A UI-only flag would leave invisible background activity. Removing the implementation would simplify the source further but add substantial restoration/integration work later. A single runtime capability and centralized execution gates provide a reversible boundary with a small maintenance footprint. Avoid per-window toggles and live deactivation, which could strand running terminals.

## Verification

Test default-off, explicit opt-in, restart-required preference changes, preserved definitions/notes/schedules, blocked background/manual/remote launches, and project operations with Agents off. Verify expanded/collapsed/search navigation, Settings feedback, stale Agent layouts/popouts, and Projects with provider subagents. Use isolated profiles rather than launching development against the user's running installation.
