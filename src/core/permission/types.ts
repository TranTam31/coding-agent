export type PermissionEffect = "allow" | "ask" | "deny";
export type PermissionReply = "once" | "always" | "reject";

export type PermissionRequest = {
  id: string;
  sessionId: string;
  action: string;
  resource: string;
  description: string;
};
