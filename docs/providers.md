# AI CLI providers

Sorcerer launches your installed CLI in a native terminal. Sign in using that CLI's documented authentication flow. Detection in **Settings → Providers** checks CLI availability, not account entitlement. Refresh providers after installing or updating a CLI.

## Codex question controls

Click inside the terminal to focus it, then use the question shortcuts shown by your Codex version. Sorcerer passes **Shift+Left/Right**, **Alt+Up/Down**, **Tab/Shift+Tab**, arrows, Enter and Escape through to the CLI in main and pop-out terminals. Questions and answers stay inside Codex's own interface.

Sorcerer's session navigation uses **Ctrl+Alt+Up/Down**. Older Sorcerer versions intercepted Alt+Up/Down for session navigation, conflicting with Codex's question and queued-message controls. Shift+Left/Right are separate forward/backward actions in Codex; use the direction displayed by the prompt.

## GitHub Copilot CLI

Install the standalone [`copilot` CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli), then run `copilot login` or use `/login` in Copilot. The retired `gh copilot` extension is not this provider. Keep Copilot current with its own updater/package manager.

In Sorcerer, open **Settings → Providers**, refresh, and choose **GitHub Copilot CLI** when creating a Project session. You can set it as the default provider. Leave the model empty to use Copilot's default, or enter a model ID available in your account. Run `/model` in the terminal to see your available models. An unsupported-model response is a provider/account error; update the CLI and select an available model.

Fresh sessions receive separate Copilot UUIDs, including sessions sharing a project folder. Resume opens that saved UUID after checking its folder. New Session/restart creates a new UUID. Existing conversations can be imported through Sorcerer's session import dialog. If the conversation files are missing or moved, resume is blocked; import the intended conversation or start fresh rather than selecting another conversation automatically.

Copilot history is read from `~/.copilot/session-state`, honoring `COPILOT_HOME` when configured in the environment inherited by Sorcerer. Only metadata and the beginning of the event log are inspected. Sorcerer does not change Copilot's stored credentials or trust preferences. Folder trust and authentication prompts appear inside the terminal when needed.

The unattended toggle passes `--allow-all`, allowing tools, paths and URLs according to Copilot's policy. With the toggle off, Copilot's native permission configuration applies. MCP configuration uses `--additional-mcp-config` and accepts a JSON object or file path. Copilot instruction files remain the way to configure instructions; Sorcerer's appended System Prompt field is unavailable.

Experimental standalone Agents support Copilot interactive sessions and scheduled missions. Missions require unattended mode because they run without a permission-prompt interface. Each Agent persists its own conversation UUID. A missing saved conversation blocks resume instead of continuing another Agent's history. Restart gives the Agent a new conversation.

Sorcerer pop-outs and browser/Android terminal streaming use the same PTY and work with Copilot. Claude-specific team/task data and Claude's native remote-control feature are not provided by this integration.

Reference: [GitHub CLI command reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference). Sorcerer inspects help to support both legacy UUID creation (tested with 1.0.24) and current `--session-id` creation (tested with 1.0.98).

## Adding another provider

The [backend architecture proposal](plans/2026-04-20-provider-backend-architecture.md) describes the long-term direction. The current extension points are:

1. Implement a `ProviderRunner` for metadata, executable resolution, argument construction, environment and model suggestions. Register it in `provider-runners.ts`.
2. If safe native resume/import is supported, attach a `ProviderSessionBackend`. Return fresh/resume plans and implement exact identity/folder validation and normalized external discovery. Keep database writes and process spawning in host orchestration.
3. Declare unsupported capabilities honestly. Do not emulate resume by selecting the provider's globally most recent conversation.
4. Check Project create/restart/resume, diagnostics, import, experimental Agent start/resume/restart and scheduled missions. Verify executable discovery and quoted paths on each supported OS. Exercise upgrade from an existing cached registry.
5. Test malformed/missing/mismatched identities and independent histories sharing one directory. Verify actual installed CLI flags and storage metadata against current official documentation. Update this guide and curated release notes.

Copilot is the first implementation of this session-backend facet. Older providers still use compatibility paths; a full migration is not implied.
