import type { ModelEvent, ModelRequest } from "./ModelClient";

export function hasToolResultMessages(request: ModelRequest) {
  return request.messages.some((message) => message.role === "tool");
}

export function shouldReadContextFiles(request: ModelRequest) {
  const userPrompt = findLastUserMessage(request).toLowerCase();

  return (
    request.contextFiles.length > 0 &&
    !hasToolResultMessages(request) &&
    (userPrompt.includes("read file") || userPrompt.includes("doc file") || userPrompt.includes("đọc file"))
  );
}

export function* createReadFileToolCalls(request: ModelRequest): Iterable<ModelEvent> {
  for (const contextFile of request.contextFiles) {
    yield {
      type: "tool_call",
      id: `read_${contextFile.path}`,
      name: "read_file",
      input: {
        path: contextFile.path
      }
    };
  }
}

export function findLastUserMessage(request: ModelRequest) {
  for (let index = request.messages.length - 1; index >= 0; index -= 1) {
    const message = request.messages[index];

    if (message?.role === "user") {
      return message.content;
    }
  }

  return "";
}

export async function* streamText(text: string, signal: AbortSignal, chunkSize = 8, delayMs = 20): AsyncIterable<ModelEvent> {
  for (let index = 0; index < text.length; index += chunkSize) {
    if (signal.aborted) {
      yield {
        type: "finish",
        reason: "cancelled"
      };
      return;
    }

    await delay(delayMs, signal);

    if (signal.aborted) {
      yield {
        type: "finish",
        reason: "cancelled"
      };
      return;
    }

    yield {
      type: "text_delta",
      delta: text.slice(index, index + chunkSize)
    };
  }

  yield {
    type: "finish",
    reason: "stop"
  };
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
