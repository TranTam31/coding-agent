export type ModelMessage = {
  role: "user" | "assistant" | "tool";
  content: string;
};

export type PromptContextFile = {
  path: string;
  source: "mention" | "attached";
};

export type ModelRequest = {
  sessionId: string;
  inputId: string;
  messages: ModelMessage[];
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
