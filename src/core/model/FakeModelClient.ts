import type { ModelClient, ModelEvent, ModelRequest } from "./ModelClient";
import { createReadFileToolCalls, findLastUserMessage, hasToolResultMessages, shouldReadContextFiles, streamText } from "./contextTooling";

const STREAM_DELAY_MS = 55;

export class FakeModelClient implements ModelClient {
  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    const userPrompt = findLastUserMessage(request);
    const toolResults = request.messages.filter((message) => message.role === "tool");

    if (hasToolResultMessages(request)) {
      yield* streamText(formatReadFileAnswer(toolResults), request.signal);
      return;
    }

    if (shouldReadContextFiles(request)) {
      for (const toolCall of createReadFileToolCalls(request)) {
        yield toolCall;
      }

      yield {
        type: "finish",
        reason: "stop"
      };
      return;
    }

    const response = [
      "Fake agent loop started.\n\n",
      `I can see ${Math.max(0, request.messages.length - 1)} prior message${request.messages.length - 1 === 1 ? "" : "s"} in this session before the current prompt.\n\n`,
      "This response is intentionally longer and chunked into small deltas so the webview can prove that streaming is real. ",
      "The current runtime is already following the same path a real coding model will use later: the prompt enters the durable session inbox, ",
      "the service promotes it at a safe boundary, the runner starts a provider turn, the model client emits deltas, and each delta is appended to the event log before the UI receives it.\n\n",
      "Your request was:\n\n",
      userPrompt,
      "\n\n",
      "Next milestones will replace this fake client with tool calls, read-only workspace tools, and then real model adapters. For now, this long fake answer exists to make timing, cancellation, and event replay visible."
    ].join("");

    yield* streamText(response, request.signal, 4, STREAM_DELAY_MS);
  }
}

function formatReadFileAnswer(toolResults: ModelRequest["messages"]) {
  const files = toolResults.map((message) => parseToolMessage(message.content));
  const lines = [`I read ${files.length} file${files.length === 1 ? "" : "s"}.\n`];

  files.forEach((file, index) => {
    lines.push(`\nFile ${index + 1}: ${file.path}\n`);
    lines.push("```text\n");
    lines.push(file.content);
    if (!file.content.endsWith("\n")) {
      lines.push("\n");
    }
    lines.push("```\n");
  });

  return lines.join("");
}

function parseToolMessage(content: string) {
  try {
    const parsed = JSON.parse(content) as { path?: unknown; content?: unknown };

    return {
      path: typeof parsed.path === "string" ? parsed.path : "unknown",
      content: typeof parsed.content === "string" ? parsed.content : content
    };
  } catch {
    return {
      path: "unknown",
      content
    };
  }
}
