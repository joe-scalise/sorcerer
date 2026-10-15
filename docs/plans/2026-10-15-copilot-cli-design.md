# GitHub Copilot CLI integration

This implements the incremental backend direction in the April provider architecture proposal. Existing Claude/Codex lifecycle code stays compatible; new provider-native behavior lives in `copilot-backend.ts` and the `ProviderSessionBackend` facet. The host applies plans to SQLite and PTYs.

Copilot's definition owns executable discovery, help-based flag detection, native model defaults, unattended permissions, and MCP arguments. Native WinGet/Homebrew/npm installations are supported. Windows npm launches the loader using Electron's Node mode rather than passing arbitrary user arguments through a command shell.

Each Project session and experimental Agent gets an independently allocated UUID. Fresh launches use `--session-id` when advertised by the CLI; older CLI versions such as 1.0.24 use their documented `--resume=<new UUID>` behavior. Resume validates an exact saved identity and matching working directory before launching `--resume=<UUID>`. Restart allocates a new UUID. No provider-global `--continue` is used.

Identity validation and import read the bounded beginning of `session-state/<UUID>/events.jsonl` and optional `workspace.yaml`, under `COPILOT_HOME` or `~/.copilot`. A matching `session.start` record and working directory are required; conflicting metadata, path traversal and symlinked records are rejected. Discovery does not read full transcripts. Imported IDs are revalidated and deduplicated.

Standalone Agent identity is persisted in an additive nullable `agents.provider_session_id` column. Scheduled runs resume their own saved conversation and pass each mission through `-p`. Scheduled launch failures are caught and logged without choosing another conversation.

Models remain under the CLI/account default unless overridden. Account-specific model availability is obtained through Copilot's `/model` UI, not guessed from a bundled static list. Sorcerer does not create or copy credentials, rewrite trust settings, or manage Copilot updates. The CLI handles folder trust and sign-in. The unattended toggle passes `--allow-all`; turning it off omits that flag and leaves permissions to Copilot's own configuration.

Unsupported facets are explicit: appended system prompts, Claude teams/tasks and Claude native remote control are unavailable for Copilot. Sorcerer's own terminal streaming and pop-outs still work.

Validation covers real temporary session fixtures, fresh/resume/restart/import host flows, per-Agent identity, legacy/current flags, permissions, model defaults, upgrade cache refresh, native and app smoke checks in packaging, and isolated live CLI startup/resume. Interactive model responses depend on the user's Copilot account and service availability.
