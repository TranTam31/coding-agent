import { useEffect, useRef } from "react";
import type { WebviewEvent } from "../types";
import { MarkdownMessage } from "./MarkdownMessage";

type EventListProps = {
  events: WebviewEvent[];
};

export function EventList({ events }: EventListProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;

    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [events]);

  return (
    <section ref={containerRef} className="min-h-0 overflow-y-auto px-4 py-3.5" aria-live="polite">
      {events.map((event) => (
        <article key={event.id} className="mb-2.5 rounded-md border border-agent bg-[var(--vscode-editorWidget-background)] px-3 py-2.5">
          <div className="mb-1.5 flex items-center gap-2 text-[11px] uppercase text-muted">
            <span>{event.kind}</span>
            <span>-</span>
            <span>{new Date(event.timestamp).toLocaleTimeString()}</span>
          </div>
          <MarkdownMessage text={event.text} />
        </article>
      ))}
    </section>
  );
}
