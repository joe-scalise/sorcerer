# Provider Backend Architecture Plan

**Date:** 2026-04-20
**Status:** Proposed
**Priority:** High

**Implementation update (2026-10-15):** Copilot introduces the incremental `ProviderSessionBackend` facet alongside existing runners. It returns session plans and owns identity validation/import metadata; host code owns persistence and PTYs. See [the current provider guide](../providers.md) and [Copilot implementation design](2026-10-15-copilot-cli-design.md). The complete migration described below remains proposed.

## Summary

Sorcerer should not optimize for a purely provider-agnostic "spawn any CLI the same way" architecture.

That model fits tools whose core job is terminal/worktree orchestration, but it does not fit Sorcerer's product direction. Sorcerer is deliberately additive. It layers resume safety, import, diagnostics, trust bootstrap, remote control, and provider-aware lifecycle management on top of external CLIs. Those features depend on real provider semantics.

The correct target is:

- a **generic orchestration substrate**
- plus **explicit provider backends**
- plus **additive Sorcerer features** built on top of those backends

The problem in the current codebase is not that Sorcerer is provider-aware. The problem is that provider-aware behavior is distributed and ad hoc instead of being encapsulated behind a real backend contract.

## Why This Matters

Recent session resume bugs exposed the architectural gap directly.

Sorcerer already knows provider-specific facts that materially change behavior:

- how to launch a fresh session
- how to resume an existing session
- how to validate provider-native identity
- how to discover or import external sessions
- how to compute whether a stored session is safe to resume
- how to label diagnostics with provider-native metadata
- how to bootstrap workspace trust before launch

Today, those decisions are not owned by a single abstraction. They are spread across startup code, IPC handlers, and narrow runner helpers. That makes resume/import/reconciliation logic brittle and duplicates behavior across sessions, agents, and scheduled runs.

## Competitive Context

### Agent of Empires

`agent-of-empires` appears to scale agent count largely because each agent is backed by a persistent `tmux` session. The app coordinates and observes sessions rather than owning the full terminal lifecycle directly. Its agent support is broad, but the adapter layer is relatively thin.

That is an effective model for managing many agents at once, but it is a different product posture. It does not need the same level of provider-native identity, recovery, and import fidelity Sorcerer is trying to provide.

### Superset

`superset` positions itself as working with many CLI agents and orchestrating swarms across local worktrees. The posture appears intentionally broad and generic: strong workspace shell, weaker provider lifecycle specialization.

### Supacode

`supacode` looks closer to a terminal/worktree control center with rich app-owned terminal state. It still contains explicit provider handling, but not as a first-class generalized provider lifecycle contract.

### Implication for Sorcerer

The differentiation is real:

- those tools bias toward broad orchestration across agents
- Sorcerer biases toward layered product features on top of providers

That means Sorcerer should become **more disciplined about provider boundaries**, not less provider-aware overall.

## Current Codebase Read

Sorcerer already has a meaningful generic substrate:

- PTY lifecycle and streaming in `src/main/services/pty-service.ts`
- project/worktree coordination
- autonomous scheduling in `src/main/services/agent-orchestrator.ts`
- initial provider launch metadata in `src/main/services/provider-runners.ts`
- provider registration in `src/main/services/provider-registry.ts`

The architectural problem is that real provider lifecycle logic is still concentrated in places like:

- `src/main/ipc/shared-handlers.ts`
- `src/main/index.ts`

That is where provider-specific behavior has accumulated for:

- resume health
- identity capture and reconciliation
- startup and exit recovery
- import and discovery
- diagnostics labeling
- trust bootstrap
- duplicated create/resume/restart paths for sessions and agents

## Target Architecture

Sorcerer should move to a three-layer model.

### 1. Generic Substrate

This layer owns Sorcerer-wide mechanics that should not care which provider is running:

- PTY process lifecycle
- terminal streaming and scrollback buffering
- worktree and project resolution
- generic session and agent state transitions
- scheduler timing and retries
- IPC and preload exposure
- persistence of generic runtime facts

Examples of generic persisted facts:

- provider name
- cwd
- pid
- timestamps
- exit summary
- last output summary
- generic run status

### 2. Provider Backend Contract

This layer owns provider-native lifecycle semantics:

- launch planning
- fresh vs resume vs restart semantics
- identity extraction and reconciliation
- resume safety and health decisions
- import/discovery support
- diagnostics metadata
- trust/bootstrap behavior
- capability policy

### 3. Additive Product Features

These are Sorcerer features that should consume the backend contract instead of branching on provider names directly:

- safe resume UX
- external session import
- diagnostics panels
- provider-aware remote control
- unattended mode mapping
- child-session or sub-agent discovery

## Design Principle

Provider-aware is acceptable.

Provider-shaped leakage across the entire application is not.

Sorcerer should treat provider semantics as a strict systems boundary. The host runtime stays generic. Provider backends provide plans, capabilities, diagnostics, and identity logic. Product features consume those abstractions instead of special-casing `"codex"` or `"claude"` in arbitrary places.

## Backend Contract Shape

Do not create one giant `ProviderBackend` interface with a large set of optional methods.

Use facet-based contracts instead.

### ProviderDefinition

Owns static metadata and detection:

- `id`
- `displayName`
- declared capabilities
- default labels
- CLI detection or probing rules

### LaunchBackend

Owns lifecycle planning:

- fresh launch plan
- resume launch plan
- restart launch plan
- model normalization
- mapping Sorcerer toggles to concrete provider CLI behavior

### IdentityBackend

Owns provider-native identity and resume safety:

- initialize identity state
- inspect terminal output for identity signals
- reconcile identity on startup and exit
- validate stored identity
- compute resume health/confidence

### ImportBackend

Optional facet for providers that support external discovery:

- scan for external sessions
- validate imported sessions
- normalize imported metadata

### DiagnosticsBackend

Optional facet for provider-specific diagnostics:

- build provider-native labels
- enrich diagnostics view models
- expose child-session or sub-agent information when available

### TrustBackend

Optional facet for provider-specific bootstrap behavior:

- workspace preflight
- trust/bootstrap steps required before launch

## Operational Guardrails

The backend layer should be powerful, but constrained.

### Backends return plans, not side effects

Provider code should not directly mutate the database or spawn PTYs.

Instead, it should return:

- launch plans
- state patches
- validation results
- diagnostics payloads

The host applies database writes and process actions.

This keeps orchestration observable, testable, and consistent across providers.

### Unsupported is explicit

If a provider does not support import, trust bootstrap, identity validation, or diagnostics enrichment, that should be returned explicitly.

Do not silently fall back to weak heuristics unless the backend says it is doing so.

### Identity confidence must be first-class

Resume and recovery logic should operate on explicit confidence states:

- `validated`
- `heuristic`
- `missing`
- `unsupported`

Host orchestration should gate resume behavior based on those states, not on provider-name branches.

### Capabilities are declared, not inferred ad hoc

Examples:

- `supportsResumeIdentity`
- `supportsImportValidation`
- `supportsTrustBootstrap`
- `supportsDiagnosticsThreadId`

Product code should ask the backend or capability layer, not inspect provider ids directly.

## Concrete Migration Plan

### Phase 1: Introduce Backend Facets Alongside the Existing Runner Model

- keep `provider-registry.ts` as the central lookup point
- add a backend definition per provider
- preserve the current runner path as a temporary compatibility layer
- move new lifecycle work to the backend contract first

Goal: stop adding more provider logic to `shared-handlers.ts` and `index.ts`.

### Phase 2: Build One Generic Launch Orchestrator

Create one host-side launch orchestrator that handles:

- session create
- session resume
- session restart
- agent start
- agent resume
- agent restart
- scheduled agent runs

That orchestrator should:

- resolve the provider backend
- request the correct launch plan
- run generic preflight
- allocate the PTY
- attach stream listeners
- persist generic state updates
- forward provider output to identity/diagnostics hooks

This removes the current duplication between sessions and agents.

### Phase 3: Move Identity and Resume Logic Out of Startup Glue

Refactor Codex and Claude identity handling out of `src/main/index.ts` and `src/main/ipc/shared-handlers.ts` into `IdentityBackend` implementations.

That should include:

- startup reconciliation
- output-driven identity capture
- exit reconciliation
- resume-health computation
- mismatch detection

### Phase 4: Move Import and Discovery Behind Optional Backends

Any provider-specific import or session discovery should live behind `ImportBackend`.

The generic UI should consume:

- `supported`
- `scan results`
- `validation results`
- normalized provider metadata

### Phase 5: Normalize Persistence Around Generic Provider Identity

Move away from schema bias toward one provider's identity fields.

Preferred direction:

- `provider`
- `provider_primary_id`
- `provider_identity_confidence`
- `provider_state` JSON/blob
- `resume_status`
- `resume_reason`

Keep fields like `claude_session_id` only as compatibility shims during migration.

### Phase 6: Route Diagnostics Through Backends

Provider-native labels, thread ids, session ids, and child-session discovery should be backend-owned.

The diagnostics UI should render generic sections plus backend-supplied enrichments.

## What Should Stay Generic

The following should remain substrate concerns even after the refactor:

- PTY creation and teardown
- terminal buffering
- generic session/agent state machine transitions
- scheduler timers and retry timing
- DB transactions
- IPC transport
- renderer-facing view model assembly where provider specifics are already normalized

This is how Sorcerer stays maintainable while still supporting richer provider-native behavior.

## What Should Become Provider-Owned

The following should move behind backend facets:

- deciding whether a stored session id is trustworthy
- deciding how to resume a provider session
- translating Sorcerer launch options into provider CLI flags
- deciding whether import is supported and how validation works
- reconciling identity from terminal output
- enriching diagnostics with provider-native concepts
- trust/bootstrap steps that are prerequisites for successful launch

## Risks

### Risk: Replacing one ad hoc system with one giant abstract interface

Mitigation:

- use facet-based contracts
- keep unsupported explicit
- avoid massive optional interfaces

### Risk: Provider behavior still leaks into generic orchestration

Mitigation:

- route all provider lifecycle logic through the backend registry
- prohibit new provider-name branching outside backend modules
- review launch/resume code for host/provider boundary violations

### Risk: Schema migration becomes too disruptive

Mitigation:

- add generic fields first
- dual-write while migrating
- keep legacy provider-specific fields temporarily
- switch readers after validation

### Risk: Reduced feature fidelity in the name of abstraction

Mitigation:

- treat provider fidelity as a requirement
- abstract only at the boundary where the host can remain generic
- let backends expose richer semantics when the provider supports them

## Immediate Next Steps

1. Define the backend facet types and registry shape.
2. Introduce a generic launch orchestrator used by both sessions and agents.
3. Move Codex resume and identity reconciliation behind the new backend contract first.
4. Move Claude resume/import logic behind the same contract.
5. Add explicit capability and identity-confidence plumbing to the host and diagnostics models.
6. Plan the persistence migration from provider-specific identity columns to generic provider identity state.

## Decision

Sorcerer is not failing because it is too provider-aware.

It is failing where provider-aware behavior exists without a strong architectural boundary.

The right move is to make provider semantics explicit, modular, and testable while keeping the host runtime generic. That preserves Sorcerer's differentiation and creates a path to support more providers without turning the codebase into uncontrolled provider-specific branching.
