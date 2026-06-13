import { PlusIcon } from "./Icons";
import type { WebviewSession } from "../types";

type HeaderProps = {
  sessions: WebviewSession[];
  currentSessionId?: string;
  isRunning: boolean;
  onNewSession(): void;
  onSwitchSession(sessionId: string): void;
};

export function Header({ sessions, currentSessionId, isRunning, onNewSession, onSwitchSession }: HeaderProps) {
  return (
    <header className="grid gap-2.5 border-b border-agent bg-agent-soft px-4 py-3">
      <div>
        <h1 className="m-0 text-[15px] font-semibold">Coding Agent</h1>
        <p className="mt-1 text-xs leading-5 text-muted">React + Tailwind webview with durable runtime events.</p>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_32px] items-center gap-2">
        <select
          className="h-[30px] min-w-0 rounded border border-agent bg-[var(--vscode-dropdown-background)] px-2 text-[var(--vscode-dropdown-foreground)]"
          aria-label="Session"
          value={currentSessionId ?? ""}
          disabled={isRunning || sessions.length === 0}
          onChange={(event) => onSwitchSession(event.target.value)}
        >
          {sessions.length === 0 ? (
            <option value="">No session yet</option>
          ) : (
            sessions.map((session) => (
              <option key={session.id} value={session.id}>
                {session.label}
              </option>
            ))
          )}
        </select>

        <button className="icon-button" type="button" title="New session" aria-label="New session" disabled={isRunning} onClick={onNewSession}>
          <PlusIcon />
        </button>
      </div>
    </header>
  );
}
