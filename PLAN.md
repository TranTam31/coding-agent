# Project Plan

This file tracks implementation progress for the Coding Agent VS Code Extension. Keep it updated after every meaningful implementation step so future coding-agent sessions can resume without rediscovering the project state.

`AGENT.md` is the architectural source of truth. `PLAN.md` is the execution tracker.

## Current Status

- Project phase: Milestone 6 in progress.
- Repository state: TypeScript VS Code extension shell with durable session/event foundations, session history projection, fake agent loop, real model provider layer, basic multi-session UI, read-oriented tool registry, and React/Tailwind prompt file context UI.
- Implemented code: command activation, webview panel, React webview, Tailwind styling, prompt input, session store, session input inbox, event log, event replay, history projector, persistent context compactor, fake model client, dynamic selected model client, Gemini provider, Groq provider, VS Code SecretStorage API key handling, model settings dialog, model selector, session runner, visibly streamed assistant text, single icon submit/interrupt action, fixed-bottom composer, basic session creation/switching, `@file` context resolution with selector, open/preview-tab context file chips, read/list/glob/grep/todo tools, mutation tools, permission service/store, approval UI, tool call/result events.
- Next recommended step: validate provider-native tool calling with real Gemini and Groq models, then harden patch partial-failure reporting and add tests.

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

- [x] Add settings for provider and model.
- [x] Add secure API key storage or documented environment-variable loading.
- [x] Implement `GeminiClient`.
- [ ] Optionally implement `OpenAICompatibleClient`.
- [ ] Optionally implement `OpenRouterClient`.
- [x] Optionally implement `GroqClient`.
- [x] Convert provider streaming events into the common `ModelEvent` stream.
- [x] Convert tool definitions into provider-specific tool/function declarations.
- [x] Verify a real model can answer without tools.
- [x] Verify the runtime can still call a read tool before invoking real providers when context-file reading is requested.

Expected outcome:

- The extension can use at least one real model provider.
- The agent loop remains provider-independent.

## Milestone 5.5: Durable Context Compaction

Goal: make context handling closer to OpenCode-style agent runtimes by compacting older session history into a durable summary while preserving recent raw turns.

Checklist:

- [x] Add durable `session.compaction.started` and `session.compaction.ended` events.
- [x] Add a `ContextCompactor` service separate from `SessionRunner`.
- [x] Trigger compaction before provider turns when session history crosses a size threshold.
- [x] Use the selected model to merge older transcript segments into a dense context summary.
- [x] Store `summary`, `cutoffEventId`, source message count, estimated input size, and summary size on the compaction event.
- [x] Fall back to a deterministic summary if model compaction fails or returns unusable output.
- [x] Update `HistoryProjector` so persisted summaries are combined with recent raw messages after the cutoff.
- [x] Keep the full event log intact rather than deleting old events.
- [x] Update `Show context` to display projection metadata, including persisted compaction status, cutoff event, recent raw message count, chars, and estimated tokens.
- [ ] Validate behavior with a long real Gemini session.

Expected outcome:

- The model no longer receives an ever-growing raw transcript.
- Older context is represented by a durable summary event.
- Recent turns remain raw and take precedence over the summary.
- Developers can inspect the projected context with `Show context` without polluting future context.

## Milestone 6: Permission And File Mutation

Goal: allow code changes with explicit user approval.

Checklist:

- [x] Add `PermissionService`.
- [x] Add permission request events.
- [x] Add approval UI for `once`, `always`, and `reject`.
- [x] Add `PermissionStore`.
- [x] Add `edit_file`.
- [x] Add `write_file`.
- [x] Add `apply_patch`.
- [x] Require approval for file mutation tools.
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
- Started Milestone 5 by adding provider/model separation: providers are API services, models are provider-specific model IDs.
- Added `ModelService` backed by VS Code `SecretStorage` for provider API keys and workspace state for selected model/model cache.
- Added Gemini and Groq providers. Gemini model discovery uses the Gemini `models.list` API; Groq model discovery uses its OpenAI-compatible `/models` endpoint.
- Added dynamic model selection so `SessionRunner` uses the currently selected model through a `DynamicModelClient`.
- Added React model selector beside the submit button and a model settings dialog for saving API keys and fetching available models.
- Updated `AGENT.md` to state that API keys must be stored through secure extension storage, not `.env` or workspace files.
- Verified the project compiles with `npm run compile`.
- Fixed Groq API key handling by stripping an accidental `Bearer ` prefix before storing/sending the key and surfacing a clearer 401 invalid-key message.
- Replaced the native model select plus separate Set button with a compact custom dropdown; `Model settings` is now the first dropdown item and uses a settings icon.
- Verified the project compiles with `npm run compile`.
- Confirmed through manual user testing that Gemini can answer through the real provider adapter.
- Added Markdown rendering for model responses in the React webview using `react-markdown` and `remark-gfm`, including code blocks, inline code, lists, tables, blockquotes, and links.
- Verified the project compiles with `npm run compile`.
- Added `HistoryProjector` so each new provider turn receives prior user prompts and assistant responses from the current session event log.
- Updated `SessionRunner` to prepend projected session history before the current prompt, fixing the previous behavior where models only saw the latest message.
- Kept history bounded to recent messages for now; full compaction remains a later robustness task.
- Verified the project compiles with `npm run compile`.
- Reworked `HistoryProjector` into a bounded context pack instead of plain transcript replay: older turns are summarized into a synthetic system context, recent turns remain raw, and relevant file/tool facts are retained.
- Updated provider adapters to support `system` model messages so the context pack can be passed explicitly to Groq and as system-context text for Gemini.
- This mirrors the OpenCode-style direction: project durable session history into model messages, compact when needed, and keep event log as the source of truth.
- Verified the project compiles with `npm run compile`.
- Added a live-only `Show context` debug command. Typing exactly `Show context` renders the projected context pack in the UI without admitting the prompt, creating model output events, or adding the debug result back into future context.
- Current context packs are derived from the durable session event log at run time; they are not persisted as separate summary records yet. Persisted compaction summaries remain a future robustness task.
- Verified the project compiles with `npm run compile`.
- Started Milestone 5.5 by adding durable context compaction modeled after OpenCode's compaction boundary.
- Added `ContextCompactor`, which runs before provider turns, detects oversized session history, asks the selected model to merge older transcript segments into a compact summary, and falls back to a deterministic summary if model compaction fails.
- Added `session.compaction.started` and `session.compaction.ended` events with summary, cutoff event ID, source message count, estimated input size, summary size, and compaction method.
- Updated `HistoryProjector` to use persisted compaction summaries plus recent raw messages after the cutoff, instead of rebuilding only an in-memory summary every time.
- Expanded `Show context` to display projection metadata including persisted compaction status, cutoff event, recent raw message count, projected chars, and estimated tokens.
- Updated `FakeModelClient` with a deterministic compaction response so Milestone 5.5 can be tested without a real provider.
- Updated `AGENT.md` with durable compaction requirements and verified the project compiles with `npm run compile`.
- Started Milestone 6 by adding `PermissionStore` and `PermissionService` with `once`, `always`, and `reject` replies.
- Added durable `permission.asked` and `permission.replied` events, and wired permission requests from the extension host to the React webview.
- Added a `PermissionPrompt` UI above the composer so mutation tools pause until the user approves or rejects the side effect.
- Extended `ToolRegistry` with declarative permission metadata and enforced authorization before executing tools.
- Added `write_file`, `edit_file`, and basic unified-diff `apply_patch` tools. All mutation tools stay inside the workspace resolver and require approval.
- Updated `FakeModelClient` with deterministic test syntax for mutation tools: `write_file {...}`, `edit_file {...}`, and `apply_patch {...}`.
- Verified the project compiles with `npm run compile`.
- Added model-facing tool schemas to every registered tool and exposed them through `ToolRegistry.toModelTools()`.
- Updated `SessionRunner` to pass registered tool definitions into each provider turn.
- Added provider-native tool/function declarations for Gemini and Groq. Gemini receives `tools[].functionDeclarations[]` and Groq receives OpenAI-compatible `tools`.
- Updated Gemini and Groq adapters to parse provider tool-call responses into the common `ModelEvent.tool_call` stream so real models can use the same `SessionRunner` and permission path as the fake model.
- Verified the project compiles with `npm run compile`.
- Fixed Gemini tool schema conversion by stripping JSON Schema fields that Gemini's function declaration schema rejects, such as `additionalProperties`, while keeping those fields available for OpenAI-compatible providers like Groq.
- Added `Coding Agent Model Debug` VS Code output channel. Each model call logs provider request payloads, tool declarations, raw provider responses, and normalized text/tool-call results with API keys redacted.

## Next Step

Validate provider-native tool calling with real Gemini and Groq models, then harden patch partial-failure reporting and add tests for `edit_file`.
