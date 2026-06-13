import * as vscode from "vscode";
import { createId } from "../session/id";
import { EventLog } from "../session/EventLog";
import { PermissionStore } from "./PermissionStore";
import type { PermissionReply, PermissionRequest } from "./types";

type PendingPermission = {
  request: PermissionRequest;
  resolve(reply: PermissionReply): void;
};

export class PermissionService implements vscode.Disposable {
  private readonly onDidRequestEmitter = new vscode.EventEmitter<PermissionRequest>();
  private readonly pending = new Map<string, PendingPermission>();
  readonly onDidRequest = this.onDidRequestEmitter.event;

  constructor(
    private readonly store: PermissionStore,
    private readonly eventLog: EventLog
  ) {}

  async authorize(input: {
    sessionId: string;
    action: string;
    resource: string;
    description: string;
    signal: AbortSignal;
  }) {
    if (this.store.isAllowed(input.action, input.resource)) {
      return;
    }

    if (input.signal.aborted) {
      throw new Error("Permission request cancelled.");
    }

    const request: PermissionRequest = {
      id: createId("permission"),
      sessionId: input.sessionId,
      action: input.action,
      resource: input.resource,
      description: input.description
    };

    await this.eventLog.append(input.sessionId, "permission.asked", {
      permissionId: request.id,
      action: request.action,
      resource: request.resource,
      description: request.description
    });

    const reply = await this.waitForReply(request, input.signal);

    await this.eventLog.append(input.sessionId, "permission.replied", {
      permissionId: request.id,
      action: request.action,
      resource: request.resource,
      reply
    });

    if (reply === "reject") {
      throw new Error(`Permission rejected for ${input.action}: ${input.resource}`);
    }

    if (reply === "always") {
      await this.store.allow(input.action, input.resource);
    }
  }

  reply(permissionId: string, reply: PermissionReply) {
    const pending = this.pending.get(permissionId);

    if (!pending) {
      return false;
    }

    this.pending.delete(permissionId);
    pending.resolve(reply);
    return true;
  }

  dispose() {
    for (const pending of this.pending.values()) {
      pending.resolve("reject");
    }

    this.pending.clear();
    this.onDidRequestEmitter.dispose();
  }

  private waitForReply(request: PermissionRequest, signal: AbortSignal) {
    return new Promise<PermissionReply>((resolve) => {
      const abort = () => {
        this.pending.delete(request.id);
        resolve("reject");
      };

      signal.addEventListener("abort", abort, { once: true });

      this.pending.set(request.id, {
        request,
        resolve: (reply) => {
          signal.removeEventListener("abort", abort);
          resolve(reply);
        }
      });

      this.onDidRequestEmitter.fire(request);
    });
  }
}
