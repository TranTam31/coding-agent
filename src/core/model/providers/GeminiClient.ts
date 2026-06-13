import type { AvailableModel, ModelClient, ModelMessage, ModelRequest } from "../ModelClient";
import { createReadFileToolCalls, shouldReadContextFiles, streamText } from "../contextTooling";
import type { ModelProvider, ProviderModelResult } from "./types";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

type GeminiModel = {
  name: string;
  baseModelId?: string;
  displayName?: string;
  description?: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  supportedGenerationMethods?: string[];
};

type GeminiListModelsResponse = {
  models?: GeminiModel[];
};

type GeminiGenerateResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
  error?: {
    message?: string;
  };
};

export class GeminiProvider implements ModelProvider {
  readonly info = {
    id: "gemini" as const,
    label: "Google Gemini",
    requiresApiKey: true
  };

  async listModels(apiKey?: string): Promise<ProviderModelResult> {
    if (!apiKey) {
      throw new Error("Gemini API key is required.");
    }

    const response = await fetch(`${GEMINI_BASE_URL}/models?key=${encodeURIComponent(apiKey)}`);

    if (!response.ok) {
      throw new Error(`Gemini models request failed: ${response.status} ${await response.text()}`);
    }

    const json = (await response.json()) as GeminiListModelsResponse;
    const models = (json.models ?? [])
      .filter((model) => model.supportedGenerationMethods?.includes("generateContent"))
      .map(toAvailableModel);

    return { models };
  }
}

export class GeminiModelClient implements ModelClient {
  constructor(
    private readonly apiKey: string,
    private readonly modelId: string
  ) {}

  async *stream(request: ModelRequest) {
    if (shouldReadContextFiles(request)) {
      for (const toolCall of createReadFileToolCalls(request)) {
        yield toolCall;
      }

      yield {
        type: "finish" as const,
        reason: "stop" as const
      };
      return;
    }

    const text = await this.generate(request);
    yield* streamText(text, request.signal);
  }

  private async generate(request: ModelRequest) {
    const modelName = this.modelId.startsWith("models/") ? this.modelId : `models/${this.modelId}`;
    const response = await fetch(`${GEMINI_BASE_URL}/${modelName}:generateContent?key=${encodeURIComponent(this.apiKey)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        contents: toGeminiContents(request.messages)
      }),
      signal: request.signal
    });

    const json = (await response.json()) as GeminiGenerateResponse;

    if (!response.ok) {
      throw new Error(json.error?.message ?? `Gemini generation failed: ${response.status}`);
    }

    return json.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
  }
}

function toAvailableModel(model: GeminiModel): AvailableModel {
  return {
    providerId: "gemini",
    id: model.name.replace(/^models\//, ""),
    label: model.displayName ?? model.baseModelId ?? model.name,
    description: model.description,
    inputTokenLimit: model.inputTokenLimit,
    outputTokenLimit: model.outputTokenLimit
  };
}

function toGeminiContents(messages: ModelMessage[]) {
  const contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> = [];

  for (const message of messages) {
    contents.push({
      role: message.role === "assistant" ? "model" : "user",
      parts: [
        {
          text: message.role === "tool" ? `Tool result:\n${message.content}` : message.content
        }
      ]
    });
  }

  return contents;
}
