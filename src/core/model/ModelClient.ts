export type ModelMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
};

export type JsonSchema = {
  type: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  enum?: string[];
  additionalProperties?: boolean;
};

export type ModelToolDefinition = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
};

export type PromptContextFile = {
  path: string;
  source: "mention" | "attached";
};

export type ModelProviderId = "fake" | "gemini" | "groq";

export type ModelRef = {
  providerId: ModelProviderId;
  modelId: string;
};

export type AvailableModel = {
  providerId: ModelProviderId;
  id: string;
  label: string;
  description?: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
};

export type ModelRequest = {
  sessionId: string;
  inputId: string;
  messages: ModelMessage[];
  tools?: ModelToolDefinition[];
  contextFiles: PromptContextFile[];
  signal: AbortSignal;
};

export type ModelEvent =
  | {
      type: "text_delta";
      delta: string;
    }
  | {
      type: "tool_call";
      id: string;
      name: string;
      input: unknown;
    }
  | {
      type: "finish";
      reason: "stop" | "cancelled";
    };

export interface ModelClient {
  stream(request: ModelRequest): AsyncIterable<ModelEvent>;
}
