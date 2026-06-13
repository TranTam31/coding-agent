# Coding Agent VS Code Extension

## Project Goal

This project builds a VS Code extension that behaves like a real coding agent. The user enters a natural-language request describing a feature, bug fix, refactor, or programming task. The extension should plan the work, inspect the codebase, edit files, request approval for commands or other side effects, run verification when appropriate, and produce working code.

The architecture is intentionally modeled after OpenCode's agent loop and runtime boundaries. This is a prototype for learning and experimentation, but it must not be a throwaway demo. The implementation should stay small enough to understand, while still being structured enough to grow into a serious product.

The core requirements are:

- A real agent loop, not a single chat completion.
- Durable session state.
- A tool registry with schema-validated tool calls.
- A permission and approval layer for side effects.
- An event log for replay, debugging, and UI state.
- Task tracking through a model-facing todo tool.
- Model provider adapters instead of hardcoding one API.
- Clear boundaries between VS Code UI, agent core, model client, and side-effect tools.

The goal is not to copy OpenCode line-by-line. The goal is to clone the important architecture ideas in a smaller form that is easier to study, test, and extend.

## Product Direction

The extension should provide a coding-agent experience inside VS Code:

- The user opens a chat or agent panel.
- The user submits a natural-language programming request.
- The agent creates a plan, updates todo state, and shows current progress.
- The agent can read files, search code, create files, edit files, and apply patches.
- The agent can propose terminal commands for tests, linting, builds, or project inspection.
- Any meaningful side effect requires user approval.
- The agent continues after tool results until the task is complete, blocked, interrupted, or requires user clarification.
- The user can interrupt and later resume a session.
- Session history and durable events can be replayed after VS Code reloads.

The final output of a successful run should be actual code changes in the workspace, plus a concise summary of what changed and how it was verified.

## Architecture Principles From OpenCode

OpenCode separates the coding agent into explicit runtime boundaries. This project should preserve that shape:

- `Session`: owns one user-agent work session.
- `SessionInput`: durable inbox for newly submitted prompts before they become model-visible history.
- `SessionRunner`: the main agent loop; runs provider turns, settles tools, and decides whether to continue.
- `EventLog`: append-only events for prompts, steps, text, reasoning summaries, tool calls, tool results, permissions, interrupts, and compaction.
- `Agent`: configuration for mode, system prompt, permissions, and model preferences.
- `ToolRegistry`: registers tools and materializes model-facing tool definitions.
- `PermissionService`: evaluates `allow`, `ask`, and `deny`; manages `once`, `always`, and `reject` replies.
- `ModelClient`: provider adapter for streaming and tool calling.
- `WorkspaceTools`: file system, terminal, git, and search tools.
- `ContextBuilder`: builds request context from `AGENT.md`, project facts, selected files, summaries, and session history.
- `Compaction`: compresses active model history when context gets too large.

The agent loop should not become one large function that owns everything. Treat it as an orchestration layer over smaller services.

## Target Agent Loop

The intended loop is:

```text
user input
-> admit input into SessionInput
-> wake SessionRunner
-> promote input at a safe boundary
-> build context
-> select agent + model
-> materialize tools according to permissions
-> stream model response
-> persist assistant events
-> when a tool call appears:
   -> record the tool call
   -> authorize it
   -> execute it
   -> persist the tool result
-> if there is a tool result or new steering input:
   -> rebuild history
   -> call the model again
-> stop when:
   -> the model returns a final answer without tool calls
   -> the step limit is reached
   -> the user interrupts
   -> a permission is rejected
   -> the agent needs user clarification
```

Default limits:

- `maxProviderTurnsPerActivity`: `25`.
- `maxToolCallsPerTurn`: `10` for the prototype.
- `maxTerminalTimeoutMs`: `120000`.
- `maxCapturedOutputBytes`: `1048576`.
- `maxPatchBytes`: define a practical limit before implementing patch application.

If the step limit is reached, the agent must stop and clearly report that the task is incomplete. It must not loop indefinitely.

## Session Model

`Session` is the main aggregate. Each session should include:

- `id`
- `workspaceUri`
- `title`
- `createdAt`
- `updatedAt`
- `agentId`
- `modelRef`
- `status`: `idle | running | waiting_approval | waiting_user | interrupted | failed | completed`
- `cost/tokens`, if the provider returns them
- `summary`, if compaction has happened

Do not add user prompts directly to model-visible history as soon as they are submitted. Use an inbox first:

```text
SessionInput:
  id
  sessionId
  kind: steer | queue
  prompt
  createdAt
  status: admitted | promoted | cancelled
```

`steer` inputs join the current activity at the next safe boundary. `queue` inputs open a future activity after the current one settles.

## Event Log

Use an event log for debugging and UI replay. The prototype can start with SQLite or JSONL. Prefer SQLite if the project is expected to grow.

Minimum events:

- `session.created`
- `session.input.admitted`
- `session.input.promoted`
- `session.step.started`
- `session.step.ended`
- `session.step.failed`
- `assistant.text.delta`
- `assistant.text.ended`
- `assistant.reasoning_summary.delta`
- `assistant.reasoning_summary.ended`
- `tool.input.started`
- `tool.input.ended`
- `tool.called`
- `tool.progress`
- `tool.success`
- `tool.failed`
- `permission.asked`
- `permission.replied`
- `session.interrupt.requested`
- `session.compaction.started`
- `session.compaction.ended`

Distinguish between:

- Durable events: replayable after VS Code reloads.
- Live-only deltas: useful for streaming UI, but not necessarily replayed token-by-token.

For the prototype, persist the full value at `*.ended` events and send deltas only through webview messages.

## Agent Configuration

Provide at least two default agents.

### `build`

Default agent for code modification.

- Can edit, write, and apply patches.
- Can run terminal commands, but commands require approval.
- Can read and search code.
- Can update todo state.
- Can ask the user questions.

### `plan`

Read-only agent for analysis.

- Can read and search code.
- Denies edit, write, and apply patch by default.
- Bash defaults to `ask`.
- Used when the user wants explanation, review, or planning before edits.

Target config shape:

```ts
type AgentConfig = {
  id: string
  description: string
  mode: "primary" | "subagent" | "all"
  systemPrompt?: string
  model?: ModelRef
  maxSteps?: number
  permissions: PermissionRule[]
}
```

## Permission Model

Permission handling is one of the most important parts of a coding agent. Tools must not perform side effects directly.

Rule shape:

```ts
type PermissionEffect = "allow" | "ask" | "deny"

type PermissionRule = {
  action: string
  resource: string
  effect: PermissionEffect
}
```

If no rule matches, the default should be `ask`, not `allow`.

Actions should include:

- `read`
- `edit`
- `write`
- `apply_patch`
- `bash`
- `external_directory`
- `network`
- `git`

Approval replies:

- `once`: allow this request only.
- `always`: allow this request and save a rule for the workspace/project.
- `reject`: deny this request and return a tool failure that the model can see.

Terminal commands require separate approval. Later, command-prefix approvals can be added, such as allowing `npm test` or `npm run lint`. The prototype can approve by full command string.

Terminal execution is implemented through `run_command` and `bash` tools. Commands must run inside the workspace, require approval, open a visible VS Code terminal, capture stdout/stderr with output limits, and enforce timeouts. The current implementation shows the original command in a visible VS Code terminal and runs a hidden duplicate process to capture output because the VS Code Terminal API does not expose stdout directly. Stronger destructive-command detection is still required before treating terminal access as production safe.

Terminal guardrails must reject obviously destructive commands before approval, including recursive force deletion, destructive git reset/clean commands, disk formatting/partitioning, raw disk writes, and shutdown/reboot commands. User approval is not enough for these commands in the prototype.

## Tool Registry

The tool registry is the boundary between the model and side effects.

Target interface:

```ts
type ToolDefinition<Input, Output> = {
  name: string
  description: string
  inputSchema: JSONSchema
  outputSchema: JSONSchema
  permissionAction?: string
  execute(input: Input, context: ToolContext): Promise<ToolOutput<Output>>
}

type ToolContext = {
  sessionId: string
  agentId: string
  assistantMessageId: string
  toolCallId: string
  workspaceUri: vscode.Uri
  cancellationToken: vscode.CancellationToken
}
```

Every tool must:

- Validate input.
- Check permission when needed.
- Execute the operation.
- Bound output size.
- Return structured output.
- Convert output into concise model-facing text.
- Persist success or failure events.

Mutation tools must declare permission metadata and must not execute if `PermissionService` is unavailable. Provider adapters should expose registered tools through native tool/function declarations so real models can call the same registry path as the fake model.

Provider-native tool/function declarations mean each model adapter must translate the internal `ToolDefinition` contract into the provider's request format. Gemini uses `tools[].functionDeclarations[]`; OpenAI-compatible providers such as Groq use `tools: [{ type: "function", function: ... }]`. Provider responses must be normalized back into `ModelEvent.tool_call` so `SessionRunner` remains provider-independent.

Built-in tools for the prototype:

- `read_file`: read text files, with pagination.
- `list_dir`: list directory entries.
- `grep`: search text with ripgrep when available.
- `glob`: find files by pattern.
- `write_file`: create or overwrite files, requires approval.
- `edit_file`: exact-string replacement, requires approval.
- `apply_patch`: apply unified patches, requires approval.
- `bash`: run terminal commands, requires approval.
- `todo_write`: update task state.
- `ask_user`: ask the user for clarification.

Do not let the model call arbitrary VS Code APIs. The model should only call schema-defined tools.

## File Mutation Strategy

Prefer `apply_patch` and `edit_file` over `write_file` when possible.

`edit_file` should require an exact old string:

- If `oldString` is not found, fail and ask the model to read the file again.
- If there are multiple matches, fail unless `replaceAll = true`.
- Before writing, detect whether the file changed since it was read if snapshots or cached reads are available.

`apply_patch` should:

- Parse the patch.
- Resolve all paths inside the workspace.
- Require `external_directory` approval for paths outside the workspace.
- Preflight targets.
- Apply operations sequentially.
- If partial failure happens, report exactly which files were applied and which failed.

Atomic rollback is not required for the prototype, but partial application must be reported clearly.

## VS Code Extension Architecture

Suggested folder structure:

```text
src/
  extension.ts
  ui/
    AgentPanelProvider.ts
    webview/
  core/
    session/
      SessionService.ts
      SessionStore.ts
      SessionRunner.ts
      SessionInput.ts
      EventLog.ts
      HistoryProjector.ts
    agent/
      AgentRegistry.ts
      defaultAgents.ts
    model/
      ModelClient.ts
      OpenAICompatibleClient.ts
      GeminiClient.ts
      OpenRouterClient.ts
      GroqClient.ts
    context/
      ContextBuilder.ts
      InstructionLoader.ts
      Compactor.ts
    permission/
      PermissionService.ts
      PermissionStore.ts
    tools/
      ToolRegistry.ts
      readFile.ts
      listDir.ts
      grep.ts
      glob.ts
      writeFile.ts
      editFile.ts
      applyPatch.ts
      bash.ts
      todoWrite.ts
      askUser.ts
    workspace/
      WorkspaceResolver.ts
      FileMutation.ts
      TerminalRunner.ts
```

The VS Code UI should call the service layer. The UI must not contain the agent loop.

## Model/API Strategy

This section was checked on 2026-06-12. Free tiers change frequently, so provider support must be implemented as adapters. Do not hardcode the core runtime to one provider.

Provider and model are separate concepts:

- A provider is an API service, such as Google Gemini or Groq.
- A model is a concrete model ID exposed by that provider.
- For self-hosting, `Ollama` is the provider and the hosted endpoint URL is provider configuration; models are names returned by Ollama, such as `qwen2.5-coder:7b`.
- An API key belongs to a provider account/project; it does not by itself select a model.
- The extension should fetch available models from the provider when possible, then let the user choose one from the model selector.
- API keys must not be stored in `.env` files or workspace files. This is a user-facing extension, so keys must be stored through VS Code `SecretStorage` or an equivalent secure credential store.
- Provider endpoint URLs may be stored in workspace state. Optional bearer tokens for private tunnels must be stored through VS Code `SecretStorage`.
- Provider settings are for entering API keys and refreshing available models. Model selection should happen in the main composer UI.

### Default for the prototype: Google Gemini API

Google Gemini API has an official free usage tier and official rate-limit documentation. Rate limits are measured using dimensions such as RPM, TPM, and RPD, and depend on model and project tier. Google states that rate limits can be viewed in AI Studio.

Reasons to use it as the default:

- Easy API key setup.
- Official free tier.
- Flash models are usually fast enough and capable enough for a prototype coding agent.
- Supports streaming and function/tool calling.
- Usually provides a larger context window than many free APIs.

Suggested model:

- Use `gemini-2.5-flash` or the latest Flash model with available free quota in AI Studio.
- Use Pro models only when available and needed; do not treat Pro as the default free option.

Reference: https://ai.google.dev/gemini-api/docs/rate-limits

### Secondary option: Groq

Groq provides a free plan and an OpenAI-compatible API. Groq's rate-limit docs describe RPM, RPD, TPM, and TPD limits, with exact limits visible in the account dashboard.

Reasons to support it:

- Very fast inference.
- OpenAI-compatible adapter is straightforward.
- Useful for agent loops with many short turns.

Caveats:

- Strong coding models available through Groq may change over time.
- Context length and tool-calling behavior should be tested per model.

Reference: https://console.groq.com/docs/rate-limits

### Secondary option: OpenRouter free models

OpenRouter exposes many free or zero-price models through a unified API. Support it as an adapter so users can choose whichever free coding model is strongest at the time.

Reasons to support it:

- Lets the project test many models without changing core code.
- Can expose open-weight coder models such as Qwen Coder, DeepSeek variants, or newer free models.
- Useful for research and benchmarking.

Caveats:

- Free models, quotas, and quality change frequently.
- Expose the model ID in settings instead of hardcoding it.

Reference: https://openrouter.ai/docs/api/reference/overview

### Local model fallback

Design an adapter for local OpenAI-compatible endpoints. This is valuable for understanding agent architecture without depending on paid APIs.

Possible local runtimes:

- Ollama
- LM Studio
- llama.cpp server
- vLLM local or remote server

Candidate model families:

- Qwen Coder family.
- DeepSeek Coder, V3, R1 distilled variants, if the user's machine can run them.
- Codestral or Mistral coder variants when license and availability fit the project.

Local models are not a free API, but they can be free in token cost if the user has the hardware.

## Model Abstraction

The core must not depend directly on one provider SDK. Use an interface like:

```ts
type ModelRequest = {
  model: ModelRef
  system: string[]
  messages: ModelMessage[]
  tools: ModelToolDefinition[]
  maxOutputTokens?: number
  temperature?: number
}

type ModelEvent =
  | { type: "text_delta"; id: string; delta: string }
  | { type: "reasoning_delta"; id: string; delta: string }
  | { type: "tool_call"; id: string; name: string; input: unknown }
  | { type: "usage"; inputTokens: number; outputTokens: number; reasoningTokens?: number }
  | { type: "finish"; reason: string }
  | { type: "error"; message: string; retryable?: boolean }

interface ModelClient {
  stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent>
}
```

Each provider adapter must translate provider-specific events into this common stream.

## Context Builder

The context sent to the model should include:

- The selected agent system prompt.
- Instructions from `AGENT.md`.
- Workspace facts: root path, active editor, selected text if any, and open files when useful.
- Project facts: package manager, framework, scripts, and git branch.
- Compacted session history.
- Recent tool results.
- Current todo state.

Do not put the whole repository into context. Use tools so the model can read and search only what it needs.

Do not blindly send the entire session transcript forever. Session context should be projected from durable events into a bounded context pack:

- A synthetic session summary for older turns.
- Recent raw user/assistant turns.
- Relevant files and tool facts.
- Current prompt context files.
- Current todo state when implemented.

The summary should preserve goals, constraints, progress, decisions, blockers, exact file paths, command names, error strings, and open questions. Recent raw turns should take precedence over the summary when they conflict.

Compaction should:

- Create a durable summary when history gets too large.
- Preserve recent turns and todo state.
- Keep the original event log intact.
- Store a cutoff event ID so the context projector can combine the durable summary with only the raw messages after that cutoff.
- Prefer model-generated summaries, but fall back to deterministic summaries when the selected provider fails so the agent run is not blocked by compaction.
- Expose a live-only debug command such as `Show context` so developers can inspect the projected context without adding that inspection back into the session history.

## Task Tracking

Use the `todo_write` tool so the model can update task state.

Todo shape:

```ts
type TodoItem = {
  id: string
  content: string
  status: "pending" | "in_progress" | "completed"
  priority?: "low" | "medium" | "high"
}
```

Invariants:

- At most one item can be `in_progress`.
- The agent should update todo state when moving between major steps.
- Do not mark everything completed at the end unless the task was actually verified.

## Safety Boundaries

Treat the coding agent as software with dangerous authority.

The prototype must enforce at least these boundaries:

- Terminal commands require approval.
- File writes, edits, and patches require approval.
- External directory access requires separate approval.
- Network command detection does not need to be perfect initially, but command approval UI must show the command clearly.
- Do not auto-run destructive git commands.
- Do not read secret files unless necessary; add a denylist later.
- Terminal output must be truncated.
- The agent must respect the workspace root.

## Persistence

The prototype can start with SQLite in extension global storage or workspace storage.

Minimum tables:

- `sessions`
- `session_inputs`
- `events`
- `permissions_saved`
- `tool_outputs`

For a simpler first version, JSONL is acceptable:

```text
.coding-agent/
  sessions/
    <sessionId>/
      session.json
      inputs.jsonl
      events.jsonl
      tool-outputs/
```

SQLite is preferable if the project is expected to evolve.

## Milestones

### Milestone 1: Extension shell

- Create a TypeScript VS Code extension.
- Add a chat panel or webview.
- Let the user submit a prompt.
- Create and persist a session.
- Display a basic event stream.

### Milestone 2: Minimal agent loop

- Implement `SessionRunner`.
- Implement the first model adapter.
- Stream assistant text.
- Stop cleanly after a final response.

### Milestone 3: Tool calling

- Implement `ToolRegistry`.
- Add `read_file`, `list_dir`, `grep`, and `todo_write`.
- Let the model inspect and search the codebase.

### Milestone 4: File mutation

- Add `edit_file`, `write_file`, and `apply_patch`.
- Add permission approval UI.
- Persist tool call and tool result events.

### Milestone 5: Terminal

- Add `bash`.
- Require command approval.
- Capture stdout and stderr with limits.
- Run tests, lint, or builds when proposed by the agent and approved by the user.

### Milestone 6: Robustness

- Add interrupt and resume.
- Add compaction.
- Enforce step limits.
- Improve error recovery.
- Add session replay.

## Coding Standards

- Use TypeScript strict mode.
- Keep service boundaries explicit.
- Do not mix UI logic into the agent core.
- Tool input and output must have schemas.
- Side effects must go through `PermissionService`.
- Prefer patches or exact replacements for file edits.
- Important modules should have unit tests.
- The agent loop should have integration tests with a fake model client.

## Testing Strategy

Use a fake model client to test the agent loop deterministically:

- Model emits text only.
- Model emits one tool call, then final text.
- Model emits invalid tool input.
- Tool fails and the model recovers.
- Permission is rejected.
- Step limit is exceeded.
- User interrupts during tool execution.

Test tools independently:

- Read file pagination.
- Grep output limits.
- Exact-match edit.
- Multiple-match edit failure.
- Partial failure in patch application.
- Bash timeout.

## Prototype Definition of Done

The prototype is successful when:

- The user can open the VS Code extension panel.
- The user can submit a small request, such as "add a test script" or "create a utility function".
- The agent reads the necessary files.
- The agent creates todo state.
- The agent proposes an edit.
- The user approves the edit.
- The file is changed.
- The agent proposes a verification command.
- The user approves the command.
- The agent reads the result and concludes.
- The session can be reloaded with the main history still visible.

## Notes For Agents Working On This Repo

Treat this file as the source of truth for the project goal.

When making architectural decisions, prioritize:

1. Keep the agent core separate from VS Code UI.
2. Keep session, event, tool, and permission boundaries explicit.
3. Build a small prototype with a clear path to extension.
4. Do not hardcode one model provider.
5. Do not skip approval for side effects.
6. Test the agent loop with a fake model before depending on a real API.

This project is a coding-agent runtime inside VS Code, not a chat wrapper. The chat UI is only the surface. The value is in the session runner, tools, permissions, persistence, and the ability to keep working until the code runs.
