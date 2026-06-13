import type { ModelClient, ModelEvent, ModelRequest } from "./ModelClient";

const STREAM_DELAY_MS = 55;

export class FakeModelClient implements ModelClient {
  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    const userPrompt = findLastUserMessage(request.messages);
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

    for (const delta of chunkText(response, 4)) {
      if (request.signal.aborted) {
        yield {
          type: "finish",
          reason: "cancelled"
        };
        return;
      }

      await delay(STREAM_DELAY_MS, request.signal);

      if (request.signal.aborted) {
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
