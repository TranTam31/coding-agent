import type { ModelMessage } from "../model/ModelClient";
import type { SessionEvent } from "./types";

const DEFAULT_RECENT_MESSAGES = 8;
const DEFAULT_MAX_SUMMARY_CHARS = 6_000;
const DEFAULT_MESSAGE_SNIPPET_CHARS = 700;

export type HistoryProjectorOptions = {
  recentMessages?: number;
  maxSummaryChars?: number;
  messageSnippetChars?: number;
};

type ConversationMessage = ModelMessage & {
  sourceEventId: string;
  timestamp: string;
};

type FileFact = {
  path: string;
  reason: string;
};

export type ContextProjection = {
  messages: ModelMessage[];
  metadata: {
    hasPersistedCompaction: boolean;
    compactionSummary?: string;
    compactionCutoffEventId?: string;
    compactionTimestamp?: string;
    projectedChars: number;
    estimatedTokens: number;
    recentRawMessageCount: number;
  };
};

export class HistoryProjector {
  constructor(private readonly options: HistoryProjectorOptions = {}) {}

  project(events: SessionEvent[], currentInputId: string): ModelMessage[] {
    return this.inspect(events, currentInputId).messages;
  }

  inspect(events: SessionEvent[], currentInputId: string): ContextProjection {
    const conversation = this.projectConversation(events, currentInputId);
    const recentCount = this.options.recentMessages ?? DEFAULT_RECENT_MESSAGES;
    const latestCompaction = findLatestCompaction(events);

    if (latestCompaction) {
      const cutoffIndex = conversation.findIndex((message) => message.sourceEventId === latestCompaction.cutoffEventId);
      const afterCutoff = cutoffIndex >= 0 ? conversation.slice(cutoffIndex + 1) : conversation;
      const recentMessages = afterCutoff.slice(-recentCount);
      const overflowMessages = afterCutoff.slice(0, -recentCount);
      const summary = overflowMessages.length > 0
        ? this.mergeSummaryWithOverflow(events, latestCompaction.summary, overflowMessages)
        : latestCompaction.summary;
      const messages = [
        {
          role: "system" as const,
          content: this.formatPersistedSummary(summary)
        },
        ...recentMessages.map(stripTimestamp)
      ];

      return {
        messages,
        metadata: buildProjectionMetadata(messages, {
          hasPersistedCompaction: true,
          compactionSummary: latestCompaction.summary,
          compactionCutoffEventId: latestCompaction.cutoffEventId,
          compactionTimestamp: latestCompaction.timestamp,
          recentRawMessageCount: recentMessages.length
        })
      };
    }

    if (conversation.length <= recentCount) {
      const messages = conversation.map(stripTimestamp);

      return {
        messages,
        metadata: buildProjectionMetadata(messages, {
          hasPersistedCompaction: false,
          recentRawMessageCount: messages.length
        })
      };
    }

    const oldMessages = conversation.slice(0, -recentCount);
    const recentMessages = conversation.slice(-recentCount);
    const summary = this.buildAnchoredSummary(events, oldMessages);
    const messages = [
      {
        role: "system" as const,
        content: summary
      },
      ...recentMessages.map(stripTimestamp)
    ];

    return {
      messages,
      metadata: buildProjectionMetadata(messages, {
        hasPersistedCompaction: false,
        recentRawMessageCount: recentMessages.length
      })
    };
  }

  private projectConversation(events: SessionEvent[], currentInputId: string): ConversationMessage[] {
    const messages: ConversationMessage[] = [];

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

  private buildAnchoredSummary(events: SessionEvent[], oldMessages: ConversationMessage[]) {
    const maxSummaryChars = this.options.maxSummaryChars ?? DEFAULT_MAX_SUMMARY_CHARS;
    const messageSnippetChars = this.options.messageSnippetChars ?? DEFAULT_MESSAGE_SNIPPET_CHARS;
    const firstUser = oldMessages.find((message) => message.role === "user");
    const fileFacts = this.extractFileFacts(events);
    const decisions = this.extractDecisionLikeLines(oldMessages, messageSnippetChars);
    const olderTimeline = oldMessages.slice(-6).map((message) => {
      const speaker = message.role === "assistant" ? "Assistant" : "User";
      return `- ${speaker}: ${truncate(cleanText(message.content), messageSnippetChars)}`;
    });

    const sections = [
      "Session context summary:",
      "",
      "## Goal",
      `- ${firstUser ? truncate(cleanText(firstUser.content), 500) : "(unknown)"}`,
      "",
      "## Constraints & Preferences",
      "- Preserve user-stated requirements from recent messages.",
      "- Treat exact file paths, command names, errors, and model/provider choices as important.",
      "",
      "## Progress So Far",
      ...olderTimeline,
      "",
      "## Key Decisions / Facts",
      ...(decisions.length > 0 ? decisions : ["- (none extracted)"]),
      "",
      "## Relevant Files",
      ...(fileFacts.length > 0 ? fileFacts.map((fact) => `- ${fact.path}: ${fact.reason}`) : ["- (none recorded)"]),
      "",
      "## How To Use This Context",
      "- Use this summary as durable background for the next user request.",
      "- Prefer the recent raw messages below when they conflict with this summary.",
      "- Do not mention this summary unless the user asks about context handling."
    ];

    return truncate(sections.join("\n"), maxSummaryChars);
  }

  private mergeSummaryWithOverflow(events: SessionEvent[], previousSummary: string, overflowMessages: ConversationMessage[]) {
    const overflowSummary = this.buildAnchoredSummary(events, overflowMessages);

    return truncate(
      [
        "Session context summary:",
        "",
        "## Persisted Summary",
        previousSummary,
        "",
        "## Additional Older Messages Not Yet Persistently Compacted",
        overflowSummary
      ].join("\n"),
      this.options.maxSummaryChars ?? DEFAULT_MAX_SUMMARY_CHARS
    );
  }

  private formatPersistedSummary(summary: string) {
    return [
      "Persisted session context summary:",
      "",
      summary,
      "",
      "Use this summary as durable background. Prefer recent raw messages below when they conflict with this summary."
    ].join("\n");
  }

  private extractFileFacts(events: SessionEvent[]): FileFact[] {
    const facts = new Map<string, FileFact>();

    for (const event of events) {
      if (event.type !== "tool.success") {
        continue;
      }

      const path = asString(event.data.data && typeof event.data.data === "object" ? (event.data.data as Record<string, unknown>).path : undefined);

      if (!path || facts.has(path)) {
        continue;
      }

      facts.set(path, {
        path,
        reason: `read by ${asString(event.data.name) ?? "tool"}`
      });
    }

    return [...facts.values()].slice(-20);
  }

  private extractDecisionLikeLines(messages: ConversationMessage[], snippetChars: number) {
    const candidates: string[] = [];
    const patterns = [/must/i, /should/i, /need/i, /decid/i, /important/i, /api key/i, /provider/i, /model/i, /milestone/i];

    for (const message of messages) {
      const lines = cleanText(message.content)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      for (const line of lines) {
        if (patterns.some((pattern) => pattern.test(line))) {
          candidates.push(`- ${truncate(line, snippetChars)}`);
        }
      }
    }

    return [...new Set(candidates)].slice(-12);
  }
}

function stripTimestamp(message: ConversationMessage): ModelMessage {
  return {
    role: message.role,
    content: message.content
  };
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
      cutoffEventId,
      timestamp: event.timestamp
    };
  }

  return undefined;
}

function buildProjectionMetadata(
  messages: ModelMessage[],
  metadata: Omit<ContextProjection["metadata"], "projectedChars" | "estimatedTokens">
): ContextProjection["metadata"] {
  const projectedChars = messages.reduce((total, message) => total + message.content.length, 0);

  return {
    ...metadata,
    projectedChars,
    estimatedTokens: Math.ceil(projectedChars / 4)
  };
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
