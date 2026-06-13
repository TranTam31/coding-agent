import assert from "node:assert/strict";
import test from "node:test";
import { HistoryProjector } from "../core/session/HistoryProjector";
import type { SessionEvent } from "../core/session/types";

test("projects persisted compaction summary plus raw messages after cutoff", () => {
  const projector = new HistoryProjector({ recentMessages: 8 });
  const events: SessionEvent[] = [
    event("event_user_1", "session.input.promoted", {
      inputId: "input_1",
      prompt: "Original user goal"
    }),
    event("event_assistant_1", "assistant.text.ended", {
      text: "Older assistant response"
    }),
    event("event_compaction_1", "session.compaction.ended", {
      summary: "## Goal\n- Persisted compacted goal",
      cutoffEventId: "event_assistant_1"
    }),
    event("event_user_2", "session.input.promoted", {
      inputId: "input_2",
      prompt: "Recent follow-up"
    }),
    event("event_assistant_2", "assistant.text.ended", {
      text: "Recent assistant answer"
    })
  ];

  const projection = projector.inspect(events, "current_input");

  assert.equal(projection.metadata.hasPersistedCompaction, true);
  assert.equal(projection.metadata.compactionCutoffEventId, "event_assistant_1");
  assert.equal(projection.messages[0]?.role, "system");
  assert.match(projection.messages[0]?.content ?? "", /Persisted compacted goal/);
  assert.deepEqual(
    projection.messages.slice(1).map((message) => message.content),
    ["Recent follow-up", "Recent assistant answer"]
  );
});

function event(id: string, type: SessionEvent["type"], data: Record<string, unknown>): SessionEvent {
  return {
    id,
    sessionId: "session_1",
    type,
    timestamp: "2026-06-13T00:00:00.000Z",
    data
  };
}
