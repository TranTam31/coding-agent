import * as vscode from "vscode";

const STORAGE_KEY = "codingAgent.permissions.v1";

type SavedPermission = {
  action: string;
  resource: string;
  effect: "allow";
  createdAt: string;
};

export class PermissionStore {
  constructor(private readonly storage: vscode.Memento) {}

  isAllowed(action: string, resource: string) {
    return this.getPermissions().some((permission) => {
      return permission.action === action && (permission.resource === resource || permission.resource === "*");
    });
  }

  async allow(action: string, resource: string) {
    const permissions = this.getPermissions();
    const exists = permissions.some((permission) => permission.action === action && permission.resource === resource);

    if (exists) {
      return;
    }

    await this.storage.update(STORAGE_KEY, [
      ...permissions,
      {
        action,
        resource,
        effect: "allow" as const,
        createdAt: new Date().toISOString()
      }
    ]);
  }

  private getPermissions() {
    return this.storage.get<SavedPermission[]>(STORAGE_KEY, []);
  }
}
