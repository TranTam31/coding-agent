# Project Plan

This file tracks implementation progress for the Coding Agent VS Code Extension. Keep it updated after every meaningful implementation step so future coding-agent sessions can resume without rediscovering the project state.

`AGENT.md` is the architectural source of truth. `PLAN.md` is the execution tracker.

## Current Status

- Project phase: Milestone 3 complete.
- Repository state: TypeScript VS Code extension shell with durable session/event foundations and a fake agent loop.
- Implemented code: command activation, webview panel, prompt input, session store, session input inbox, event log, event replay, fake model client, session runner, streamed assistant text, basic interrupt.
- Next recommended step: Milestone 4, add tool registry and safe read-oriented workspace tools.

## Progress Rules

Every implementation session must update this file before finishing.

When updating progress:

- Mark completed checklist items with `[x]`.
- Add short notes under "Implementation Log" with the date and what changed.
- Update "Current Status" and "Next Step".
- If a milestone is partially complete, leave unfinished items unchecked and add a short blocker or remaining-work note.
- If architectural decisions change, update `AGENT.md` as well as this file.

## Milestone 1: Extension Shell

Goal: create a minimal VS Code extension that can open an agent panel and accept user input, without real AI behavior yet.

Checklist:

- [x] Initialize a TypeScript VS Code extension project.
- [x] Add `package.json` commands and extension activation metadata.
- [x] Add `tsconfig.json`.
- [x] Add `src/extension.ts`.
- [x] Add a command such as `codingAgent.openPanel`.
- [x] Add a webview panel or sidebar view for the agent UI.
- [x] Add a text input for user prompts.
- [x] Add a simple message/event display area.
- [x] Add basic build script.
- [x] Verify the extension compiles.

Expected outcome:

- User can run the extension in VS Code.
- User can open the agent panel.
- User can type and submit a prompt.
- The UI can display a local placeholder response or event.

## Milestone 2: Session And Event Log

Goal: introduce durable session concepts before adding model intelligence.

Checklist:

- [x] Add `SessionService`.
- [x] Add `SessionStore`.
- [x] Add `SessionInput`.
- [x] Add `EventLog`.
- [x] Create a session when the first prompt is submitted.
- [x] Record `session.created`.
- [x] Record `session.input.admitted`.
- [x] Record `session.input.promoted` when the runner starts processing.
- [x] Render session events in the UI.
- [x] Persist sessions and events using the first storage backend.

Expected outcome:

- Prompt submission creates durable state.
- Reloading the extension can show previous session history or at least the recorded event log.

## Milestone 3: Fake Agent Loop

Goal: implement the real runtime loop shape with a fake model before integrating external AI APIs.

Checklist:

- [x] Add `SessionRunner`.
- [x] Add `ModelClient` interface.
- [x] Add `FakeModelClient`.
- [x] Stream fake text deltas through the event system.
- [x] Record `session.step.started`.
- [x] Record `assistant.text.delta` as live UI events.
- [x] Record `assistant.text.ended`.
- [x] Record `session.step.ended`.
- [x] Enforce `maxProviderTurnsPerActivity`.
- [x] Support interrupt at a basic level.

Expected outcome:

- The extension shows an agent-like stream from a fake model.
- The runtime shape can be tested without a real API key.

## Milestone 4: Tool Registry And Read Tools

Goal: let the model interact with safe, read-oriented workspace tools.

Checklist:

- [ ] Add `ToolRegistry`.
- [ ] Add tool input/output schema validation.
- [ ] Add `read_file`.
- [ ] Add `list_dir`.
- [ ] Add `grep`.
- [ ] Add `glob`.
- [ ] Add `todo_write`.
- [ ] Add tool call/result events.
- [ ] Teach `FakeModelClient` to emit a tool call for testing.
- [ ] Continue the agent loop after a tool result.

Expected outcome:

- The fake model can request a read tool.
- The runner executes it, records the result, and continues to the next model turn.

## Milestone 5: Real Model Adapter

Goal: connect the runtime to a real model provider while keeping provider logic isolated.

Checklist:

- [ ] Add settings for provider and model.
- [ ] Add secure API key storage or documented environment-variable loading.
- [ ] Implement `GeminiClient`.
- [ ] Optionally implement `OpenAICompatibleClient`.
- [ ] Optionally implement `OpenRouterClient`.
- [ ] Optionally implement `GroqClient`.
- [ ] Convert provider streaming events into the common `ModelEvent` stream.
- [ ] Convert tool definitions into provider-specific tool/function declarations.
- [ ] Verify a real model can answer without tools.
- [ ] Verify a real model can call a read tool.

Expected outcome:

- The extension can use at least one real model provider.
- The agent loop remains provider-independent.

## Milestone 6: Permission And File Mutation

Goal: allow code changes with explicit user approval.

Checklist:

- [ ] Add `PermissionService`.
- [ ] Add permission request events.
- [ ] Add approval UI for `once`, `always`, and `reject`.
- [ ] Add `PermissionStore`.
- [ ] Add `edit_file`.
- [ ] Add `write_file`.
- [ ] Add `apply_patch`.
- [ ] Require approval for file mutation tools.
- [ ] Report partial patch failures clearly.
- [ ] Add tests for exact-edit behavior.

Expected outcome:

- The agent can propose file edits.
- The user can approve or reject them.
- Approved edits are applied to the workspace and recorded in the event log.

## Milestone 7: Terminal And Verification

Goal: let the agent run verification commands safely.

Checklist:

- [ ] Add `bash` or `run_command` tool.
- [ ] Require approval for every command.
- [ ] Display command, working directory, and reason before approval.
- [ ] Capture stdout and stderr with size limits.
- [ ] Add timeout handling.
- [ ] Persist command result events.
- [ ] Let the agent continue after command output.
- [ ] Add guardrails for destructive commands.

Expected outcome:

- The agent can propose tests, lint, or build commands.
- The user can approve execution.
- The agent can read the result and decide whether the task is complete.

## Milestone 8: Robustness

Goal: make the prototype durable enough for continued development.

Checklist:

- [ ] Add full interrupt/resume behavior.
- [ ] Add compaction.
- [ ] Add session replay after reload.
- [ ] Add error recovery paths.
- [ ] Add fake-model integration tests for loop scenarios.
- [ ] Add tool unit tests.
- [ ] Add basic telemetry/logging hooks for debugging local runs.

Expected outcome:

- The agent runtime is stable enough to use for small real coding tasks and to continue evolving.

## Implementation Log

### 2026-06-12

- Created `AGENT.md` with the project goal, OpenCode-inspired architecture, model strategy, safety boundaries, and milestone direction.
- Created `PLAN.md` as the persistent progress tracker.
- Completed Milestone 1 by scaffolding a TypeScript VS Code extension with `package.json`, `tsconfig.json`, `.gitignore`, and `src/extension.ts`.
- Added command `codingAgent.openPanel`, a webview panel, prompt submission, and local placeholder events.
- Installed npm dependencies and verified the project compiles with `npm run compile`.

### 2026-06-13

- Completed Milestone 2 by adding `SessionService`, `SessionStore`, `SessionInput` types, and `EventLog`.
- Persisted sessions, inputs, and events through VS Code `workspaceState` as the first storage backend.
- Changed prompt submission to create a session on first use, record `session.created`, admit input, promote input, and replay session events in the webview.
- Verified the project compiles with `npm run compile`.
- Completed Milestone 3 by adding `ModelClient`, `FakeModelClient`, and `SessionRunner`.
- Added durable events for `session.step.started`, `assistant.text.delta`, `assistant.text.ended`, `session.step.ended`, `session.step.failed`, and `session.interrupt.requested`.
- Connected prompt submission to the fake agent loop so assistant text streams through the event system and replays from `assistant.text.ended`.
- Added a basic Interrupt button that cancels the active fake model stream.
- Verified the project compiles with `npm run compile`.

## Next Step

Implement Milestone 4: add `ToolRegistry`, schema validation, and safe read tools such as `read_file`, `list_dir`, `grep`, `glob`, and `todo_write`; teach the fake model to emit a tool call and continue after the tool result.
