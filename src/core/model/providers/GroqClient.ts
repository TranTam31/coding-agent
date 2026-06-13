import type {
  AvailableModel,
  JsonSchema,
  ModelClient,
  ModelMessage,
  ModelRequest,
  ModelToolDefinition,
} from "../ModelClient";
import type { ModelDebugLogger } from "../ModelDebugLogger";
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
      tool_calls?: Array<{
        id?: string;
        type?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
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
    private readonly debugLogger?: ModelDebugLogger,
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

    const result = await this.generate(request);

    for (const toolCall of result.toolCalls) {
      yield {
        type: "tool_call" as const,
        id: toolCall.id,
        name: toolCall.name,
        input: toolCall.input,
      };
    }

    if (result.text) {
      yield* streamText(result.text, request.signal);
      return;
    }

    yield {
      type: "finish" as const,
      reason: "stop" as const,
    };
  }

  private async generate(request: ModelRequest) {
    const body = {
      model: this.modelId,
      messages: toGroqMessages(request.messages),
      tools: toGroqTools(request.tools),
    };

    this.debugLogger?.log("Groq provider request", {
      url: `${GROQ_BASE_URL}/chat/completions`,
      model: this.modelId,
      sessionId: request.sessionId,
      inputId: request.inputId,
      body,
    });

    const response = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: toAuthorizationHeader(this.apiKey),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: request.signal,
    });

    const json = (await response.json()) as GroqChatResponse;

    this.debugLogger?.log("Groq raw response", {
      status: response.status,
      ok: response.ok,
      body: json,
    });

    if (!response.ok) {
      throw new Error(
        json.error?.message ?? `Groq generation failed: ${response.status}`,
      );
    }

    const message = json.choices?.[0]?.message;

    const result = {
      text: message?.content ?? "",
      toolCalls: (message?.tool_calls ?? [])
        .map((toolCall, index) => toModelToolCall(toolCall, index))
        .filter((toolCall): toolCall is NonNullable<typeof toolCall> => toolCall !== undefined),
    };

    this.debugLogger?.log("Groq normalized response", result);
    return result;
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

function toGroqTools(tools: ModelToolDefinition[] | undefined) {
  if (!tools || tools.length === 0) {
    return undefined;
  }

  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: toOpenAiSchema(tool.inputSchema),
    },
  }));
}

function toOpenAiSchema(schema: JsonSchema): Record<string, unknown> {
  return {
    ...schema,
    properties: schema.properties
      ? Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, toOpenAiSchema(value)]))
      : undefined,
    items: schema.items ? toOpenAiSchema(schema.items) : undefined,
  };
}

function toModelToolCall(
  toolCall: {
    id?: string;
    function?: {
      name?: string;
      arguments?: string;
    };
  },
  index: number,
) {
  const name = toolCall.function?.name;

  if (!name) {
    return undefined;
  }

  return {
    id: toolCall.id ?? `groq_tool_${index}_${Date.now()}`,
    name,
    input: parseArguments(toolCall.function?.arguments),
  };
}

function parseArguments(value: string | undefined) {
  if (!value) {
    return {};
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return {};
  }
}
