import { createId } from "./id";
import { EventLog } from "./EventLog";
import { SessionStore } from "./SessionStore";
import type { ModelClient, ModelMessage } from "../model/ModelClient";
import type { SessionInput, SessionRecord } from "./types";

const DEFAULT_MAX_PROVIDER_TURNS = 25;

export type SessionRunnerOptions = {
  maxProviderTurnsPerActivity?: number;
};

export class SessionRunner {
  private currentRun: AbortController | undefined;

  constructor(
    private readonly store: SessionStore,
    private readonly eventLog: EventLog,
    private readonly modelClient: ModelClient,
    private readonly options: SessionRunnerOptions = {}
  ) {}

  get isRunning() {
    return this.currentRun !== undefined;
  }

  async run(session: SessionRecord, input: SessionInput) {
    if (this.currentRun) {
      throw new Error("A session activity is already running.");
    }

    const abortController = new AbortController();
    this.currentRun = abortController;

    try {
      await this.store.updateSessionStatus(session.id, "running");
      await this.runActivity(session, input, abortController.signal);
    } catch (error) {
      if (abortController.signal.aborted) {
        await this.store.updateSessionStatus(session.id, "interrupted");
        return;
      }

      await this.store.updateSessionStatus(session.id, "failed");
      await this.eventLog.append(session.id, "session.step.failed", {
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

  private async runActivity(session: SessionRecord, input: SessionInput, signal: AbortSignal) {
    const maxTurns = this.options.maxProviderTurnsPerActivity ?? DEFAULT_MAX_PROVIDER_TURNS;

    for (let turn = 1; turn <= maxTurns; turn += 1) {
      if (signal.aborted) {
        await this.eventLog.append(session.id, "session.interrupt.requested", {
          inputId: input.id
        });
        await this.store.updateSessionStatus(session.id, "interrupted");
        return;
      }

      const finished = await this.runProviderTurn(session, input, turn, signal);

      if (signal.aborted) {
        await this.eventLog.append(session.id, "session.interrupt.requested", {
          inputId: input.id
        });
        await this.store.updateSessionStatus(session.id, "interrupted");
        return;
      }

      if (finished) {
        await this.store.updateSessionStatus(session.id, "completed");
        return;
      }
    }

    await this.store.updateSessionStatus(session.id, "failed");
    throw new Error(`Step limit exceeded after ${maxTurns} provider turns.`);
  }

  private async runProviderTurn(
    session: SessionRecord,
    input: SessionInput,
    turn: number,
    signal: AbortSignal
  ) {
    const stepId = createId("step");
    const textId = createId("text");
    let assistantText = "";

    await this.eventLog.append(session.id, "session.step.started", {
      stepId,
      inputId: input.id,
      turn
    });

    const messages: ModelMessage[] = [
      {
        role: "user",
        content: input.prompt
      }
    ];

    for await (const modelEvent of this.modelClient.stream({
      sessionId: session.id,
      inputId: input.id,
      messages,
      signal
    })) {
      if (modelEvent.type === "text_delta") {
        assistantText += modelEvent.delta;
        await this.eventLog.append(session.id, "assistant.text.delta", {
          stepId,
          textId,
          delta: modelEvent.delta
        });
        continue;
      }

      if (modelEvent.type === "finish") {
        await this.eventLog.append(session.id, "assistant.text.ended", {
          stepId,
          textId,
          text: assistantText
        });

        await this.eventLog.append(session.id, "session.step.ended", {
          stepId,
          inputId: input.id,
          turn,
          finishReason: modelEvent.reason
        });

        return modelEvent.reason === "stop";
      }
    }

    await this.eventLog.append(session.id, "assistant.text.ended", {
      stepId,
      textId,
      text: assistantText
    });

    await this.eventLog.append(session.id, "session.step.ended", {
      stepId,
      inputId: input.id,
      turn,
      finishReason: "stop"
    });

    return true;
  }
}
