# Project Plan

This file tracks implementation progress for the Coding Agent VS Code Extension. Keep it updated after every meaningful implementation step so future coding-agent sessions can resume without rediscovering the project state.

`AGENT.md` is the architectural source of truth. `PLAN.md` is the execution tracker.

## Current Status

- Project phase: Milestone 4 complete.
- Repository state: TypeScript VS Code extension shell with durable session/event foundations, fake agent loop, basic multi-session UI, read-oriented tool registry, and React/Tailwind prompt file context UI.
- Implemented code: command activation, webview panel, React webview, Tailwind styling, prompt input, session store, session input inbox, event log, event replay, fake model client, session runner, visibly streamed assistant text, single icon submit/interrupt action, fixed-bottom composer, basic session creation/switching, `@file` context resolution with selector, open/preview-tab context file chips, read/list/glob/grep/todo tools, tool call/result events.
- Next recommended step: Milestone 5, connect the runtime to a real model adapter while keeping the fake model useful for deterministic tests.

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

- [x] Add `ToolRegistry`.
- [x] Add tool input/output schema validation.
- [x] Add `read_file`.
- [x] Add `list_dir`.
- [x] Add `grep`.
- [x] Add `glob`.
- [x] Add `todo_write`.
- [x] Add tool call/result events.
- [x] Teach `FakeModelClient` to emit a tool call for testing.
- [x] Continue the agent loop after a tool result.

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
- Refined Milestone 3 after manual UX review: made the fake model response longer and chunked into small delayed deltas so streaming is visible.
- Replaced separate Submit and Interrupt buttons with one icon action button that switches from submit to interrupt while the runner is active.
- Fixed the composer to stay at the bottom while only the conversation/event area scrolls.
- Added minimal multi-session foundation in the UI and service layer: create a new session and switch the current session from a selector.
- Verified the project compiles with `npm run compile`.
- Completed Milestone 4 by adding `ToolRegistry` and the first read-oriented workspace tools: `read_file`, `list_dir`, `grep`, `glob`, and `todo_write`.
- Extended `ModelClient` and `SessionRunner` to support model-emitted tool calls, durable `tool.called`, `tool.success`, and `tool.failed` events, and continuation turns after tool results.
- Added prompt file-context resolution for `@file` mentions, including workspace search, duplicate removal, missing-file diagnostics, and ambiguous-file diagnostics.
- Added a `+` button in the composer that attaches the active VS Code editor file as prompt context.
- Updated the fake model demo so prompts like `Đọc file @package.json @src/extension.ts` call `read_file` for each unique file and stream a response containing each file's content.
- Verified the project compiles with `npm run compile`.
- Refined context UI: open editor tabs, including preview tabs, now appear directly above the prompt with per-file `+`/`x` controls.
- Removed the separate attach-active-file button because each visible context file now owns its own add/remove control.
- Attached files remain in the context row after switching to other files, while newly opened files appear as available but unattached.
- Added `@file` autocomplete: typing `@` plus a partial path searches the workspace and shows selectable valid files.
- Verified the project compiles with `npm run compile`.
- Refactored the webview UI from inline HTML/CSS/JavaScript in `extension.ts` to a React + Tailwind webview bundle under `src/webview`.
- Added component boundaries for `Header`, `EventList`, `Composer`, `ContextFiles`, `FileSuggest`, and icons.
- Updated the build pipeline with `esbuild` for React JS and Tailwind CLI for CSS, while keeping extension-host TypeScript separate from webview code.
- Reduced `extension.ts` to a host-side webview shell plus message bridge.
- Verified the project compiles with `npm run compile`.

## Next Step

Implement Milestone 5: add provider settings and a first real model adapter, while preserving `FakeModelClient` for local deterministic testing.
