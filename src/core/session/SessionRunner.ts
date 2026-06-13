import { createId } from "./id";
import { EventLog } from "./EventLog";
import { HistoryProjector } from "./HistoryProjector";
import { SessionStore } from "./SessionStore";
import type { ModelClient, ModelMessage, PromptContextFile } from "../model/ModelClient";
import type { ToolRegistry } from "../tools/ToolRegistry";
import { getPrimaryWorkspaceFolder } from "../tools/workspace";
import type { SessionInput, SessionRecord } from "./types";

const DEFAULT_MAX_PROVIDER_TURNS = 25;

export type SessionRunnerOptions = {
  maxProviderTurnsPerActivity?: number;
};

export type SessionRunRequest = {
  session: SessionRecord;
  input: SessionInput;
  contextFiles: PromptContextFile[];
};

export class SessionRunner {
  private currentRun: AbortController | undefined;

  constructor(
    private readonly store: SessionStore,
    private readonly eventLog: EventLog,
    private readonly modelClient: ModelClient,
    private readonly toolRegistry: ToolRegistry,
    private readonly historyProjector = new HistoryProjector(),
    private readonly options: SessionRunnerOptions = {}
  ) {}

  get isRunning() {
    return this.currentRun !== undefined;
  }

  async run(request: SessionRunRequest) {
    if (this.currentRun) {
      throw new Error("A session activity is already running.");
    }

    const abortController = new AbortController();
    this.currentRun = abortController;

    try {
      await this.store.updateSessionStatus(request.session.id, "running");
      await this.runActivity(request, abortController.signal);
    } catch (error) {
      if (abortController.signal.aborted) {
        await this.store.updateSessionStatus(request.session.id, "interrupted");
        return;
      }

      await this.store.updateSessionStatus(request.session.id, "failed");
      await this.eventLog.append(request.session.id, "session.step.failed", {
        message: error instanceof Error ? error.message : "Unknown runner failure"
      });
      throw error;
    } finally {
      if (this.currentRun === abortController) {
        this.currentRun = undefined;
      }
    }
  }

  async interrupt() {
    const activeRun = this.currentRun;

    if (!activeRun) {
      return false;
    }

    activeRun.abort();
    return true;
  }

  private async runActivity(request: SessionRunRequest, signal: AbortSignal) {
    const maxTurns = this.options.maxProviderTurnsPerActivity ?? DEFAULT_MAX_PROVIDER_TURNS;
    const history = this.historyProjector.project(this.eventLog.allForSession(request.session.id), request.input.id);
    const messages: ModelMessage[] = [
      ...history,
      {
        role: "user",
        content: request.input.prompt
      }
    ];

    for (let turn = 1; turn <= maxTurns; turn += 1) {
      if (signal.aborted) {
        await this.eventLog.append(request.session.id, "session.interrupt.requested", {
          inputId: request.input.id
        });
        await this.store.updateSessionStatus(request.session.id, "interrupted");
        return;
      }

      const result = await this.runProviderTurn(request, messages, turn, signal);
      messages.push(...result.messages);

      if (signal.aborted) {
        await this.eventLog.append(request.session.id, "session.interrupt.requested", {
          inputId: request.input.id
        });
        await this.store.updateSessionStatus(request.session.id, "interrupted");
        return;
      }

      if (result.finished) {
        await this.store.updateSessionStatus(request.session.id, "completed");
        return;
      }
    }

    await this.store.updateSessionStatus(request.session.id, "failed");
    throw new Error(`Step limit exceeded after ${maxTurns} provider turns.`);
  }

  private async runProviderTurn(
    request: SessionRunRequest,
    messages: ModelMessage[],
    turn: number,
    signal: AbortSignal
  ) {
    const stepId = createId("step");
    const textId = createId("text");
    let assistantText = "";
    const nextMessages: ModelMessage[] = [];
    let sawToolCall = false;

    await this.eventLog.append(request.session.id, "session.step.started", {
      stepId,
      inputId: request.input.id,
      turn
    });

    for await (const modelEvent of this.modelClient.stream({
      sessionId: request.session.id,
      inputId: request.input.id,
      messages,
      contextFiles: request.contextFiles,
      signal
    })) {
      if (modelEvent.type === "text_delta") {
        assistantText += modelEvent.delta;
        await this.eventLog.append(request.session.id, "assistant.text.delta", {
          stepId,
          textId,
          delta: modelEvent.delta
        });
        continue;
      }

      if (modelEvent.type === "tool_call") {
        sawToolCall = true;
        const toolMessage = await this.executeToolCall(request.session, stepId, modelEvent, signal);
        nextMessages.push(toolMessage);
        continue;
      }

      if (modelEvent.type === "finish") {
        await this.eventLog.append(request.session.id, "assistant.text.ended", {
          stepId,
          textId,
          text: assistantText
        });

        await this.eventLog.append(request.session.id, "session.step.ended", {
          stepId,
          inputId: request.input.id,
          turn,
          finishReason: sawToolCall ? "tool_calls" : modelEvent.reason
        });

        return {
          finished: modelEvent.reason === "stop" && !sawToolCall,
          messages: nextMessages
        };
      }
    }

    await this.eventLog.append(request.session.id, "assistant.text.ended", {
      stepId,
      textId,
      text: assistantText
    });

    await this.eventLog.append(request.session.id, "session.step.ended", {
      stepId,
      inputId: request.input.id,
      turn,
      finishReason: sawToolCall ? "tool_calls" : "stop"
    });

    return {
      finished: !sawToolCall,
      messages: nextMessages
    };
  }

  private async executeToolCall(
    session: SessionRecord,
    stepId: string,
    modelEvent: { id: string; name: string; input: unknown },
    signal: AbortSignal
  ): Promise<ModelMessage> {
    await this.eventLog.append(session.id, "tool.called", {
      stepId,
      toolCallId: modelEvent.id,
      name: modelEvent.name,
      input: modelEvent.input
    });

    const workspaceFolder = getPrimaryWorkspaceFolder();

    if (!workspaceFolder) {
      const message = "No workspace folder is open.";
      await this.eventLog.append(session.id, "tool.failed", {
        stepId,
        toolCallId: modelEvent.id,
        name: modelEvent.name,
        message
      });

      return {
        role: "tool",
        content: JSON.stringify({ error: message })
      };
    }

    try {
      const result = await this.toolRegistry.execute(modelEvent.name, modelEvent.input, {
        workspaceFolder,
        signal
      });

      await this.eventLog.append(session.id, "tool.success", {
        stepId,
        toolCallId: modelEvent.id,
        name: modelEvent.name,
        content: result.content,
        data: result.data
      });

      return {
        role: "tool",
        content: JSON.stringify({
          tool: modelEvent.name,
          path: typeof result.data?.path === "string" ? result.data.path : undefined,
          content: result.content
        })
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Tool execution failed.";
      await this.eventLog.append(session.id, "tool.failed", {
        stepId,
        toolCallId: modelEvent.id,
        name: modelEvent.name,
        message
      });

      return {
        role: "tool",
        content: JSON.stringify({
          tool: modelEvent.name,
          error: message
        })
      };
    }
  }
}
