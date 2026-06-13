import { useState } from "react";
import type { WebviewSession } from "../types";
import { PlusIcon, SidebarIcon, TrashIcon } from "./Icons";

type SessionSidebarProps = {
  sessions: WebviewSession[];
  currentSessionId?: string;
  collapsed: boolean;
  isRunning: boolean;
  onToggle(): void;
  onNewSession(): void;
  onSwitchSession(sessionId: string): void;
  onDeleteSession(sessionId: string): void;
};

export function SessionSidebar({
  sessions,
  currentSessionId,
  collapsed,
  isRunning,
  onToggle,
  onNewSession,
  onSwitchSession,
  onDeleteSession
}: SessionSidebarProps) {
  const [pendingDeleteId, setPendingDeleteId] = useState<string | undefined>();

  return (
    <aside
      className={[
        "min-h-0 border-r border-agent bg-agent-soft transition-[width] duration-200",
        collapsed ? "w-12" : "w-64"
      ].join(" ")}
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center gap-2 border-b border-agent p-2">
          <button className="icon-button h-8 w-8 shrink-0" type="button" title="Toggle sessions" aria-label="Toggle sessions" onClick={onToggle}>
            <SidebarIcon />
          </button>

          {!collapsed ? (
            <>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">Sessions</div>
                <div className="text-[11px] text-muted">{sessions.length} total</div>
              </div>
              <button className="icon-button h-8 w-8 shrink-0" type="button" title="New session" aria-label="New session" disabled={isRunning} onClick={onNewSession}>
                <PlusIcon />
              </button>
            </>
          ) : null}
        </div>

        {collapsed ? (
          <div className="grid gap-2 p-2">
            <button className="icon-button h-8 w-8" type="button" title="New session" aria-label="New session" disabled={isRunning} onClick={onNewSession}>
              <PlusIcon />
            </button>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {sessions.length === 0 ? (
              <div className="rounded border border-agent px-3 py-2 text-xs text-muted">No sessions yet.</div>
            ) : (
              <div className="grid gap-1.5">
                {sessions.map((session) => {
                  const active = session.id === currentSessionId;

                  return (
                    <div
                      key={session.id}
                      className={[
                        "group grid grid-cols-[minmax(0,1fr)_28px] items-center gap-1 rounded border px-2 py-1.5",
                        active ? "border-[var(--vscode-focusBorder)] bg-[var(--vscode-list-activeSelectionBackground)]" : "border-agent bg-[var(--vscode-editorWidget-background)]"
                      ].join(" ")}
                    >
                      <button
                        className="min-w-0 bg-transparent text-left text-xs text-[var(--vscode-foreground)] disabled:opacity-60"
                        type="button"
                        disabled={isRunning || active}
                        title={session.label}
                        onClick={() => onSwitchSession(session.id)}
                      >
                        <span className="block truncate font-medium">{session.label}</span>
                      </button>

                      <button
                        className={[
                          "icon-button h-7 w-7 opacity-80 hover:opacity-100",
                          pendingDeleteId === session.id ? "border-[var(--vscode-errorForeground)] text-[var(--vscode-errorForeground)]" : ""
                        ].join(" ")}
                        type="button"
                        title={pendingDeleteId === session.id ? "Click again to delete" : "Delete session"}
                        aria-label={pendingDeleteId === session.id ? `Confirm delete ${session.label}` : `Delete ${session.label}`}
                        disabled={isRunning}
                        onClick={() => {
                          if (pendingDeleteId === session.id) {
                            onDeleteSession(session.id);
                            setPendingDeleteId(undefined);
                            return;
                          }

                          setPendingDeleteId(session.id);
                        }}
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
