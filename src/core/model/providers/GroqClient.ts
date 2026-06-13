import type {
  AvailableModel,
  ModelClient,
  ModelMessage,
  ModelRequest,
} from "../ModelClient";
import {
  createReadFileToolCalls,
  shouldReadContextFiles,
  streamText,
} from "../contextTooling";
import type { ModelProvider, ProviderModelResult } from "./types";

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

type GroqListModelsResponse = {
  data?: Array<{
    id: string;
    owned_by?: string;
    context_window?: number;
  }>;
};

type GroqChatResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
};

export class GroqProvider implements ModelProvider {
  readonly info = {
    id: "groq" as const,
    label: "Groq",
    requiresApiKey: true,
  };

  async listModels(apiKey?: string): Promise<ProviderModelResult> {
    if (!apiKey) {
      throw new Error("Groq API key is required.");
    }

    const response = await fetch(`${GROQ_BASE_URL}/models`, {
      headers: {
        Authorization: toAuthorizationHeader(apiKey),
      },
    });

    if (!response.ok) {
      throw new Error(
        `Groq models request failed: ${response.status} ${await response.text()}`,
      );
    }

    const json = (await response.json()) as GroqListModelsResponse;

    return {
      models: (json.data ?? []).map((model) => ({
        providerId: "groq",
        id: model.id,
        label: model.id,
        description: model.owned_by,
        inputTokenLimit: model.context_window,
      })),
    };
  }
}

export class GroqModelClient implements ModelClient {
  constructor(
    private readonly apiKey: string,
    private readonly modelId: string,
  ) {}

  async *stream(request: ModelRequest) {
    if (shouldReadContextFiles(request)) {
      for (const toolCall of createReadFileToolCalls(request)) {
        yield toolCall;
      }

      yield {
        type: "finish" as const,
        reason: "stop" as const,
      };
      return;
    }

    const text = await this.generate(request);
    yield* streamText(text, request.signal);
  }

  private async generate(request: ModelRequest) {
    const response = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: toAuthorizationHeader(this.apiKey),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.modelId,
        messages: toGroqMessages(request.messages),
      }),
      signal: request.signal,
    });

    const json = (await response.json()) as GroqChatResponse;

    if (!response.ok) {
      throw new Error(
        json.error?.message ?? `Groq generation failed: ${response.status}`,
      );
    }

    return json.choices?.[0]?.message?.content ?? "";
  }
}

function toAuthorizationHeader(apiKey: string) {
  return `Bearer ${apiKey
    .trim()
    .replace(/^Bearer\s+/i, "")
    .trim()}`;
}

function toGroqMessages(messages: ModelMessage[]) {
  return messages.map((message) => ({
    role: message.role === "assistant" ? "assistant" : message.role === "system" ? "system" : "user",
    content:
      message.role === "tool"
        ? `Tool result:\n${message.content}`
        : message.content,
  }));
}
