import type { PermissionReply, PermissionRequest } from "../types";

type PermissionPromptProps = {
  request?: PermissionRequest;
  onReply(reply: PermissionReply): void;
};

export function PermissionPrompt({ request, onReply }: PermissionPromptProps) {
  if (!request) {
    return null;
  }

  return (
    <section className="mx-4 mb-2 rounded-lg border border-agent bg-[var(--vscode-editorWidget-background)] p-3 shadow-lg">
      <div className="mb-2 text-xs uppercase tracking-wide text-muted">Permission Required</div>
      <div className="mb-1 text-sm font-medium">{request.description}</div>
      <div className="mb-3 break-all text-xs text-muted">
        {request.action}: {request.resource}
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="rounded-md border border-agent px-3 py-1.5 text-sm hover:bg-[var(--vscode-toolbar-hoverBackground)]" onClick={() => onReply("once")}>
          Allow once
        </button>
        <button className="rounded-md border border-agent px-3 py-1.5 text-sm hover:bg-[var(--vscode-toolbar-hoverBackground)]" onClick={() => onReply("always")}>
          Always allow
        </button>
        <button className="rounded-md border border-[var(--vscode-errorForeground)] px-3 py-1.5 text-sm text-[var(--vscode-errorForeground)] hover:bg-[var(--vscode-toolbar-hoverBackground)]" onClick={() => onReply("reject")}>
          Reject
        </button>
      </div>
    </section>
  );
}
