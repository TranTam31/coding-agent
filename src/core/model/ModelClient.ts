export type ModelMessage = {
  role: "user" | "assistant" | "tool";
  content: string;
};

export type ModelRequest = {
  sessionId: string;
  inputId: string;
  messages: ModelMessage[];
  signal: AbortSignal;
};

export type ModelEvent =
  | {
      type: "text_delta";
      delta: string;
    }
  | {
      type: "finish";
      reason: "stop" | "cancelled";
    };

export interface ModelClient {
  stream(request: ModelRequest): AsyncIterable<ModelEvent>;
}
