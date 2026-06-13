import type { ModelClient, ModelMessage } from "../model/ModelClient";
import { EventLog } from "./EventLog";
import type { SessionEvent } from "./types";

const DEFAULT_RECENT_MESSAGES = 8;
const DEFAULT_TRIGGER_CHARS = 12_000;
const DEFAULT_MAX_SUMMARY_CHARS = 6_000;
const MIN_MODEL_SUMMARY_CHARS = 120;

export type ContextCompactorOptions = {
  recentMessages?: number;
  triggerChars?: number;
  maxSummaryChars?: number;
};

type CompactableMessage = ModelMessage & {
  sourceEventId: string;
  timestamp: string;
};

export class ContextCompactor {
  constructor(
    private readonly eventLog: EventLog,
    private readonly modelClient: ModelClient,
    private readonly options: ContextCompactorOptions = {}
  ) {}

  async compactIfNeeded(sessionId: string, currentInputId: string, signal: AbortSignal) {
    const events = this.eventLog.allForSession(sessionId);
    const conversation = projectConversation(events, currentInputId);
    const recentCount = this.options.recentMessages ?? DEFAULT_RECENT_MESSAGES;

    if (conversation.length <= recentCount) {
      return;
    }

    const latestCompaction = findLatestCompaction(events);
    const latestCutoffIndex = latestCompaction
      ? conversation.findIndex((message) => message.sourceEventId === latestCompaction.cutoffEventId)
      : -1;
    const compactableMessages = conversation.slice(Math.max(0, latestCutoffIndex + 1), -recentCount);

    if (compactableMessages.length === 0) {
      return;
    }

    const estimatedChars = estimateConversationChars(conversation, latestCompaction?.summary);
    const triggerChars = this.options.triggerChars ?? DEFAULT_TRIGGER_CHARS;

    if (estimatedChars < triggerChars) {
      return;
    }

    const cutoffEventId = compactableMessages[compactableMessages.length - 1]?.sourceEventId;

    if (!cutoffEventId || latestCompaction?.cutoffEventId === cutoffEventId) {
      return;
    }

    await this.eventLog.append(sessionId, "session.compaction.started", {
      inputId: currentInputId,
      previousCutoffEventId: latestCompaction?.cutoffEventId,
      targetCutoffEventId: cutoffEventId,
      sourceMessageCount: compactableMessages.length,
      estimatedInputChars: estimatedChars
    });

    const { summary, method } = await this.createSummary({
      sessionId,
      currentInputId,
      previousSummary: latestCompaction?.summary,
      messages: compactableMessages,
      signal
    });

    await this.eventLog.append(sessionId, "session.compaction.ended", {
      inputId: currentInputId,
      cutoffEventId,
      previousCutoffEventId: latestCompaction?.cutoffEventId,
      summary,
      method,
      sourceMessageCount: compactableMessages.length,
      estimatedInputChars: estimatedChars,
      summaryChars: summary.length,
      estimatedSummaryTokens: Math.ceil(summary.length / 4)
    });
  }

  private async createSummary(input: {
    sessionId: string;
    currentInputId: string;
    previousSummary?: string;
    messages: CompactableMessage[];
    signal: AbortSignal;
  }) {
    try {
      const summary = await this.createModelSummary(input);

      if (summary.length >= MIN_MODEL_SUMMARY_CHARS) {
        return {
          summary: truncate(summary, this.options.maxSummaryChars ?? DEFAULT_MAX_SUMMARY_CHARS),
          method: "model"
        };
      }
    } catch {
      // Compaction should improve context quality, not block the user request.
    }

    return {
      summary: this.createFallbackSummary(input.previousSummary, input.messages),
      method: "fallback"
    };
  }

  private async createModelSummary(input: {
    sessionId: string;
    currentInputId: string;
    previousSummary?: string;
    messages: CompactableMessage[];
    signal: AbortSignal;
  }) {
    let text = "";

    for await (const event of this.modelClient.stream({
      sessionId: input.sessionId,
      inputId: `${input.currentInputId}:compaction`,
      contextFiles: [],
      signal: input.signal,
      messages: [
        {
          role: "system",
          content: [
            "You are a coding-agent session compactor.",
            "Create a dense, durable context summary for future agent turns.",
            "Preserve goals, constraints, user preferences, progress, decisions, blockers, exact file paths, commands, error strings, model/provider choices, and open questions.",
            "Do not include filler. Do not answer the user's original task. Return only the compacted summary in Markdown."
          ].join("\n")
        },
        {
          role: "user",
          content: [
            "# Existing Persisted Summary",
            input.previousSummary ?? "(none)",
            "",
            "# New Older Transcript Segment To Merge",
            formatTranscript(input.messages),
            "",
            "# Required Output Sections",
            "## Goal",
            "## Constraints & Preferences",
            "## Progress So Far",
            "## Key Decisions / Facts",
            "## Relevant Files",
            "## Blockers / Open Questions"
          ].join("\n")
        }
      ]
    })) {
      if (event.type === "text_delta") {
        text += event.delta;
      }
    }

    return text.trim();
  }

  private createFallbackSummary(previousSummary: string | undefined, messages: CompactableMessage[]) {
    const firstUser = messages.find((message) => message.role === "user");
    const timeline = messages.slice(-10).map((message) => {
      const speaker = message.role === "assistant" ? "Assistant" : "User";
      return `- ${speaker}: ${truncate(cleanText(message.content), 700)}`;
    });
    const decisionLines = extractDecisionLikeLines(messages);

    return truncate(
      [
        "Session context summary:",
        "",
        "## Previous Summary",
        previousSummary ?? "(none)",
        "",
        "## Goal",
        `- ${firstUser ? truncate(cleanText(firstUser.content), 500) : "(unknown)"}`,
        "",
        "## Constraints & Preferences",
        "- Preserve exact user requirements, file paths, command names, provider/model choices, and errors.",
        "",
        "## Progress So Far",
        ...timeline,
        "",
        "## Key Decisions / Facts",
        ...(decisionLines.length > 0 ? decisionLines : ["- (none extracted)"]),
        "",
        "## Blockers / Open Questions",
        "- (none extracted)"
      ].join("\n"),
      this.options.maxSummaryChars ?? DEFAULT_MAX_SUMMARY_CHARS
    );
  }
}

function projectConversation(events: SessionEvent[], currentInputId: string): CompactableMessage[] {
  const messages: CompactableMessage[] = [];

  for (const event of events) {
    if (event.type === "session.input.promoted") {
      const inputId = asString(event.data.inputId);

      if (!inputId || inputId === currentInputId) {
        continue;
      }

      messages.push({
        role: "user",
        content: asString(event.data.prompt) ?? "",
        sourceEventId: event.id,
        timestamp: event.timestamp
      });
      continue;
    }

    if (event.type === "assistant.text.ended") {
      const text = asString(event.data.text);

      if (!text) {
        continue;
      }

      messages.push({
        role: "assistant",
        content: text,
        sourceEventId: event.id,
        timestamp: event.timestamp
      });
    }
  }

  return messages;
}

function findLatestCompaction(events: SessionEvent[]) {
  for (const event of [...events].reverse()) {
    if (event.type !== "session.compaction.ended") {
      continue;
    }

    const summary = asString(event.data.summary);
    const cutoffEventId = asString(event.data.cutoffEventId);

    if (!summary || !cutoffEventId) {
      continue;
    }

    return {
      summary,
      cutoffEventId
    };
  }

  return undefined;
}

function formatTranscript(messages: CompactableMessage[]) {
  return messages
    .map((message) => {
      const speaker = message.role === "assistant" ? "Assistant" : "User";
      return [`## ${speaker} (${message.timestamp})`, message.content].join("\n");
    })
    .join("\n\n");
}

function estimateConversationChars(messages: CompactableMessage[], previousSummary?: string) {
  return messages.reduce((total, message) => total + message.content.length, previousSummary?.length ?? 0);
}

function extractDecisionLikeLines(messages: CompactableMessage[]) {
  const patterns = [/must/i, /should/i, /need/i, /decid/i, /important/i, /api key/i, /provider/i, /model/i, /milestone/i, /context/i];
  const candidates: string[] = [];

  for (const message of messages) {
    const lines = cleanText(message.content)
      .split(/[.!?]\s+|\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    for (const line of lines) {
      if (patterns.some((pattern) => pattern.test(line))) {
        candidates.push(`- ${truncate(line, 700)}`);
      }
    }
  }

  return [...new Set(candidates)].slice(-16);
}

function asString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function cleanText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxChars: number) {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars)}\n[truncated]`;
}
