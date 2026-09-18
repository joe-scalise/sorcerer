# Agent Instructions

This file is for coding agents working in the Sorcerer repository.

## Out-of-Scope Bugs And Follow-Ups

If you discover a legitimate bug, product gap, or operational risk that is **not** the main focus of your current task, do not let it disappear.

You should:

1. Check whether a matching GitHub issue already exists.
2. If no good existing issue exists, open a new issue at:
   `https://github.com/joe-scalise/sorcerer/issues`
3. Keep the current task moving unless the discovered issue is a blocker or a security problem.

## When To Open An Issue

Open an issue when the discovered item is:

- a real bug with user-visible impact
- a data-loss or state-consistency risk
- a workflow regression
- an architectural limitation likely to cause repeated defects
- a meaningful UX trap that will keep resurfacing

Do **not** open public issues for security vulnerabilities. Follow the security guidance in `CONTRIBUTING.md` instead.

## Issue Quality Bar

Every issue should include:

- a clear title
- a concise problem statement
- why it matters
- reproduction steps when possible
- expected behavior
- actual behavior
- file references or implementation references when known

## Release Notes

If your task touches release notes, follow `docs/releases/README.md`.
Every release note must include:

- `## Highlights`
- `## Fixes and polish`
- `## Notes`
