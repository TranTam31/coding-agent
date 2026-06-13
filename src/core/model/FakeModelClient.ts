import type { ModelClient, ModelEvent, ModelRequest } from "./ModelClient";

const STREAM_DELAY_MS = 35;

export class FakeModelClient implements ModelClient {
  async *stream(request: ModelRequest): AsyncIterable<ModelEvent> {
    const userPrompt = findLastUserMessage(request.messages);
    const response = [
      "Fake agent loop started.\n",
      "I received this request:\n\n",
      userPrompt,
      "\n\n",
      "Milestone 3 is now exercising the same runtime shape a real model will use: session input -> runner -> model stream -> durable assistant events."
    ];

    for (const delta of response) {
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
