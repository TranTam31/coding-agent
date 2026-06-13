import type {
  AvailableModel,
  JsonSchema,
  ModelClient,
  ModelMessage,
  ModelRequest,
  ModelToolDefinition
} from "../ModelClient";
import type { ModelDebugLogger } from "../ModelDebugLogger";
import { createReadFileToolCalls, shouldReadContextFiles, streamText } from "../contextTooling";
import type { ModelProvider, ProviderConfig, ProviderModelResult } from "./types";

type OllamaTagsResponse = {
  models?: Array<{
    name?: string;
    model?: string;
    size?: number;
    details?: {
      family?: string;
      parameter_size?: string;
      quantization_level?: string;
    };
  }>;
};

type OllamaChatResponse = {
  message?: {
    content?: string;
    tool_calls?: Array<{
      function?: {
        name?: string;
        arguments?: unknown;
      };
    }>;
  };
  error?: string;
};

export class OllamaProvider implements ModelProvider {
  readonly info = {
    id: "ollama" as const,
    label: "Ollama",
    requiresApiKey: false,
    requiresBaseUrl: true
  };

  async listModels(config: ProviderConfig): Promise<ProviderModelResult> {
    const baseUrl = normalizeBaseUrl(config.baseUrl);
    const response = await fetch(`${baseUrl}/api/tags`, {
      headers: getHeaders(config.apiKey)
    });

    if (!response.ok) {
      throw new Error(`Ollama models request failed: ${response.status} ${await response.text()}`);
    }

    const json = (await response.json()) as OllamaTagsResponse;

    return {
      models: (json.models ?? []).map(toAvailableModel)
    };
  }
}

export class OllamaModelClient implements ModelClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string | undefined,
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
    const baseUrl = normalizeBaseUrl(this.baseUrl);
    const body = {
      model: this.modelId,
      messages: toOllamaMessages(request.messages),
      tools: toOllamaTools(request.tools),
      stream: false
    };

    this.debugLogger?.log("Ollama provider request", {
      url: `${baseUrl}/api/chat`,
      model: this.modelId,
      sessionId: request.sessionId,
      inputId: request.inputId,
      body
    });

    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: {
        ...getHeaders(this.apiKey),
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: request.signal
    });

    const json = (await response.json()) as OllamaChatResponse;

    this.debugLogger?.log("Ollama raw response", {
      status: response.status,
      ok: response.ok,
      body: json
    });

    if (!response.ok) {
      throw new Error(json.error ?? `Ollama generation failed: ${response.status}`);
    }

    const content = json.message?.content ?? "";
    const nativeToolCalls = (json.message?.tool_calls ?? [])
        .map((toolCall, index) => toModelToolCall(toolCall, index))
        .filter((toolCall): toolCall is NonNullable<typeof toolCall> => toolCall !== undefined);
    const fallbackToolCalls = nativeToolCalls.length === 0 ? parseTextToolCalls(content) : [];
    const result = {
      text: fallbackToolCalls.length > 0 ? stripTextToolCalls(content).trim() : content,
      toolCalls: nativeToolCalls.length > 0 ? nativeToolCalls : fallbackToolCalls
    };

    this.debugLogger?.log("Ollama normalized response", result);
    return result;
  }
}

function toAvailableModel(model: NonNullable<OllamaTagsResponse["models"]>[number]): AvailableModel {
  const id = model.name ?? model.model ?? "unknown";
  const details = model.details;

  return {
    providerId: "ollama",
    id,
    label: id,
    description: [details?.parameter_size, details?.quantization_level, details?.family].filter(Boolean).join(" / ") || undefined
  };
}

function toOllamaMessages(messages: ModelMessage[]) {
  return messages.map((message) => ({
    role: message.role,
    content:
      message.role === "system"
        ? `System context:\n${message.content}`
        : message.role === "tool"
          ? `Tool result:\n${message.content}`
          : message.content
  }));
}

function toOllamaTools(tools: ModelToolDefinition[] | undefined) {
  if (!tools || tools.length === 0) {
    return undefined;
  }

  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: toOpenAiSchema(tool.inputSchema)
    }
  }));
}

function toOpenAiSchema(schema: JsonSchema): Record<string, unknown> {
  return {
    ...schema,
    properties: schema.properties
      ? Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, toOpenAiSchema(value)]))
      : undefined,
    items: schema.items ? toOpenAiSchema(schema.items) : undefined
  };
}

function toModelToolCall(
  toolCall: {
    function?: {
      name?: string;
      arguments?: unknown;
    };
  },
  index: number
) {
  const name = toolCall.function?.name;

  if (!name) {
    return undefined;
  }

  return {
    id: `ollama_tool_${index}_${Date.now()}`,
    name,
    input: parseArguments(toolCall.function?.arguments)
  };
}

function parseArguments(value: unknown) {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return {};
    }
  }

  return value && typeof value === "object" ? value : {};
}

function parseTextToolCalls(content: string) {
  const calls: Array<{ id: string; name: string; input: Record<string, string> }> = [];
  const functionPattern = /<function=([A-Za-z0-9_.-]+)>([\s\S]*?)<\/function>/g;
  let functionMatch: RegExpExecArray | null;

  while ((functionMatch = functionPattern.exec(content)) !== null) {
    const name = functionMatch[1];
    const body = functionMatch[2];
    const input: Record<string, string> = {};
    const parameterPattern = /<parameter=([A-Za-z0-9_.-]+)>\s*([\s\S]*?)\s*<\/parameter>/g;
    let parameterMatch: RegExpExecArray | null;

    while ((parameterMatch = parameterPattern.exec(body)) !== null) {
      input[parameterMatch[1]] = parameterMatch[2];
    }

    calls.push({
      id: `ollama_text_tool_${calls.length}_${Date.now()}`,
      name,
      input
    });
  }

  return calls;
}

function stripTextToolCalls(content: string) {
  return content
    .replace(/<function=[A-Za-z0-9_.-]+>[\s\S]*?<\/function>/g, "")
    .replace(/<\/tool_call>/g, "");
}

function normalizeBaseUrl(baseUrl: string | undefined) {
  const value = baseUrl?.trim().replace(/\/+$/, "");

  if (!value) {
    throw new Error("Ollama base URL is required. Example: https://your-tunnel.trycloudflare.com");
  }

  return value;
}

function getHeaders(apiKey: string | undefined): Record<string, string> {
  return apiKey
    ? {
        Authorization: `Bearer ${apiKey.trim().replace(/^Bearer\s+/i, "")}`
      }
    : {};
}
