import type { ModelClient } from "../model/ModelClient";

export type SessionNameResult = {
  title: string;
  summary: string;
};

const MAX_TITLE_CHARS = 56;
const MAX_SUMMARY_CHARS = 220;

export class SessionNamer {
  constructor(private readonly modelClient: ModelClient) {}

  async generate(input: { sessionId: string; inputId: string; prompt: string; signal: AbortSignal }): Promise<SessionNameResult> {
    let text = "";

    try {
      for await (const event of this.modelClient.stream({
        sessionId: input.sessionId,
        inputId: `${input.inputId}:session-name`,
        contextFiles: [],
        messages: [
          {
            role: "system",
            content: [
              "You generate concise session metadata for a coding-agent chat.",
              "Return only valid JSON. Do not wrap in Markdown.",
              `title must be ${MAX_TITLE_CHARS} characters or less.`,
              `summary must be ${MAX_SUMMARY_CHARS} characters or less.`,
              "JSON shape: {\"title\":\"...\",\"summary\":\"...\"}"
            ].join("\n")
          },
          {
            role: "user",
            content: input.prompt
          }
        ],
        signal: input.signal
      })) {
        if (event.type === "text_delta") {
          text += event.delta;
        }
      }

      return normalizeNameResult(parseModelResult(text), input.prompt);
    } catch {
      return fallbackName(input.prompt);
    }
  }
}

function parseModelResult(text: string): Partial<SessionNameResult> {
  const trimmed = text.trim();
  const jsonText = trimmed.match(/\{[\s\S]*\}/)?.[0] ?? trimmed;

  try {
    const parsed = JSON.parse(jsonText) as { title?: unknown; summary?: unknown };

    return {
      title: typeof parsed.title === "string" ? parsed.title : undefined,
      summary: typeof parsed.summary === "string" ? parsed.summary : undefined
    };
  } catch {
    const [firstLine, ...rest] = trimmed.split(/\r?\n/).filter(Boolean);

    return {
      title: firstLine,
      summary: rest.join(" ")
    };
  }
}

function normalizeNameResult(result: Partial<SessionNameResult>, prompt: string): SessionNameResult {
  const fallback = fallbackName(prompt);
  const title = cleanTitle(result.title ?? fallback.title);
  const summary = cleanSummary(result.summary ?? fallback.summary);

  return {
    title: title || fallback.title,
    summary: summary || fallback.summary
  };
}

function fallbackName(prompt: string): SessionNameResult {
  const clean = prompt.replace(/\s+/g, " ").trim();

  return {
    title: truncate(clean || "New coding task", MAX_TITLE_CHARS),
    summary: truncate(clean || "No prompt summary available.", MAX_SUMMARY_CHARS)
  };
}

function cleanTitle(value: string) {
  return truncate(value.replace(/^[#*\-\s"]+|["\s]+$/g, "").replace(/\s+/g, " ").trim(), MAX_TITLE_CHARS);
}

function cleanSummary(value: string) {
  return truncate(value.replace(/\s+/g, " ").trim(), MAX_SUMMARY_CHARS);
}

function truncate(value: string, maxChars: number) {
  if (value.length <= maxChars) {
    return value;
  }

  return value.slice(0, maxChars - 1).trimEnd() + "…";
}
