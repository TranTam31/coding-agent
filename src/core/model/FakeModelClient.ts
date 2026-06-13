import type { ModelClient, ModelEvent, ModelRequest } from "./ModelClient";

const STREAM_DELAY_MS = 55;

export class FakeModelClient implements ModelClient {
  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    const userPrompt = findLastUserMessage(request.messages);
    const toolResults = request.messages.filter((message) => message.role === "tool");

    if (toolResults.length > 0) {
      yield* streamText(formatReadFileAnswer(toolResults), request.signal);
      return;
    }

    if (shouldReadFiles(userPrompt) && request.contextFiles.length > 0) {
      for (const contextFile of request.contextFiles) {
        yield {
          type: "tool_call",
          id: `fake_read_${contextFile.path}`,
          name: "read_file",
          input: {
            path: contextFile.path
          }
        };
      }

      yield {
        type: "finish",
        reason: "stop"
      };
      return;
    }

    const response = [
      "Fake agent loop started.\n\n",
      "This response is intentionally longer and chunked into small deltas so the webview can prove that streaming is real. ",
      "The current runtime is already following the same path a real coding model will use later: the prompt enters the durable session inbox, ",
      "the service promotes it at a safe boundary, the runner starts a provider turn, the model client emits deltas, and each delta is appended to the event log before the UI receives it.\n\n",
      "Your request was:\n\n",
      userPrompt,
      "\n\n",
      "Next milestones will replace this fake client with tool calls, read-only workspace tools, and then real model adapters. For now, this long fake answer exists to make timing, cancellation, and event replay visible."
    ].join("");

    yield* streamText(response, request.signal);
  }
}

async function* streamText(text: string, signal: AbortSignal): AsyncIterable<ModelEvent> {
  for (const delta of chunkText(text, 4)) {
    if (signal.aborted) {
      yield {
        type: "finish",
        reason: "cancelled"
      };
      return;
    }

    await delay(STREAM_DELAY_MS, signal);

    if (signal.aborted) {
      yield {
        type: "finish",
        reason: "cancelled"
      };
      return;
    }

    yield {
      type: "text_delta",
      delta
    };
  }

  yield {
    type: "finish",
    reason: "stop"
  };
}

function shouldReadFiles(prompt: string) {
  const normalized = prompt.toLowerCase();
  return normalized.includes("read file") || normalized.includes("doc file") || normalized.includes("đọc file");
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

function chunkText(text: string, size: number) {
  const chunks: string[] = [];

  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size));
  }

  return chunks;
}

function findLastUserMessage(messages: ModelRequest["messages"]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      return messages[index].content;
    }
  }

  return "";
}

function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }

    const timeout = setTimeout(resolve, ms);

    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true }
    );
  });
}
