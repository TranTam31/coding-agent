# Project Plan

This file tracks implementation progress for the Coding Agent VS Code Extension. Keep it updated after every meaningful implementation step so future coding-agent sessions can resume without rediscovering the project state.

`AGENT.md` is the architectural source of truth. `PLAN.md` is the execution tracker.

## Current Status

- Project phase: planning.
- Repository state: only project guidance exists.
- Implemented code: none yet.
- Next recommended step: Milestone 1, create the VS Code extension shell and initial folder structure.

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

- [ ] Initialize a TypeScript VS Code extension project.
- [ ] Add `package.json` commands and extension activation metadata.
- [ ] Add `tsconfig.json`.
- [ ] Add `src/extension.ts`.
- [ ] Add a command such as `codingAgent.openPanel`.
- [ ] Add a webview panel or sidebar view for the agent UI.
- [ ] Add a text input for user prompts.
- [ ] Add a simple message/event display area.
- [ ] Add basic build script.
- [ ] Verify the extension compiles.

Expected outcome:

- User can run the extension in VS Code.
- User can open the agent panel.
- User can type and submit a prompt.
- The UI can display a local placeholder response or event.

## Milestone 2: Session And Event Log

Goal: introduce durable session concepts before adding model intelligence.

Checklist:

- [ ] Add `SessionService`.
- [ ] Add `SessionStore`.
- [ ] Add `SessionInput`.
- [ ] Add `EventLog`.
- [ ] Create a session when the first prompt is submitted.
- [ ] Record `session.created`.
- [ ] Record `session.input.admitted`.
- [ ] Record `session.input.promoted` when the runner starts processing.
- [ ] Render session events in the UI.
- [ ] Persist sessions and events using the first storage backend.

Expected outcome:

- Prompt submission creates durable state.
- Reloading the extension can show previous session history or at least the recorded event log.

## Milestone 3: Fake Agent Loop

Goal: implement the real runtime loop shape with a fake model before integrating external AI APIs.

Checklist:

- [ ] Add `SessionRunner`.
- [ ] Add `ModelClient` interface.
- [ ] Add `FakeModelClient`.
- [ ] Stream fake text deltas through the event system.
- [ ] Record `session.step.started`.
- [ ] Record `assistant.text.delta` as live UI events.
- [ ] Record `assistant.text.ended`.
- [ ] Record `session.step.ended`.
- [ ] Enforce `maxProviderTurnsPerActivity`.
- [ ] Support interrupt at a basic level.

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

## Next Step

Implement Milestone 1: scaffold the TypeScript VS Code extension shell, add an agent panel, accept a prompt, and display a placeholder event.
