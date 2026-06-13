import type { AvailableModel, JsonSchema, ModelClient, ModelMessage, ModelRequest, ModelToolDefinition } from "../ModelClient";
import type { ModelDebugLogger } from "../ModelDebugLogger";
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
        functionCall?: {
          id?: string;
          name?: string;
          args?: Record<string, unknown>;
        };
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
    private readonly modelId: string,
    private readonly debugLogger?: ModelDebugLogger
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

    const result = await this.generate(request);

    for (const toolCall of result.toolCalls) {
      yield {
        type: "tool_call" as const,
        id: toolCall.id,
        name: toolCall.name,
        input: toolCall.input
      };
    }

    if (result.text) {
      yield* streamText(result.text, request.signal);
      return;
    }

    yield {
      type: "finish" as const,
      reason: "stop" as const
    };
  }

  private async generate(request: ModelRequest) {
    const modelName = this.modelId.startsWith("models/") ? this.modelId : `models/${this.modelId}`;
    const url = `${GEMINI_BASE_URL}/${modelName}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
    const body = {
      contents: toGeminiContents(request.messages),
      tools: toGeminiTools(request.tools)
    };

    this.debugLogger?.log("Gemini provider request", {
      url: `${GEMINI_BASE_URL}/${modelName}:generateContent?key=[redacted]`,
      model: this.modelId,
      sessionId: request.sessionId,
      inputId: request.inputId,
      body
    });

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: request.signal
    });

    const json = (await response.json()) as GeminiGenerateResponse;

    this.debugLogger?.log("Gemini raw response", {
      status: response.status,
      ok: response.ok,
      body: json
    });

    if (!response.ok) {
      throw new Error(json.error?.message ?? `Gemini generation failed: ${response.status}`);
    }

    const parts = json.candidates?.[0]?.content?.parts ?? [];

    const result = {
      text: parts.map((part) => part.text ?? "").join(""),
      toolCalls: parts
        .map((part, index) => part.functionCall ? toModelToolCall(part.functionCall, index) : undefined)
        .filter((toolCall): toolCall is NonNullable<typeof toolCall> => toolCall !== undefined)
    };

    this.debugLogger?.log("Gemini normalized response", result);
    return result;
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
          text:
            message.role === "system"
              ? `System context:\n${message.content}`
              : message.role === "tool"
                ? `Tool result:\n${message.content}`
                : message.content
        }
      ]
    });
  }

  return contents;
}

function toGeminiTools(tools: ModelToolDefinition[] | undefined) {
  if (!tools || tools.length === 0) {
    return undefined;
  }

  return [
    {
      functionDeclarations: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: toGeminiSchema(tool.inputSchema)
      }))
    }
  ];
}

function toGeminiSchema(schema: JsonSchema): Record<string, unknown> {
  return {
    type: schema.type.toUpperCase(),
    description: schema.description,
    required: schema.required,
    enum: schema.enum,
    properties: schema.properties
      ? Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, toGeminiSchema(value)]))
      : undefined,
    items: schema.items ? toGeminiSchema(schema.items) : undefined
  };
}

function toModelToolCall(functionCall: { id?: string; name?: string; args?: Record<string, unknown> }, index: number) {
  if (!functionCall.name) {
    return undefined;
  }

  return {
    id: functionCall.id ?? `gemini_tool_${index}_${Date.now()}`,
    name: functionCall.name,
    input: functionCall.args ?? {}
  };
}
