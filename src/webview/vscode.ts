import type { WebviewToHostMessage } from "./types";

type VsCodeApi = {
  postMessage(message: WebviewToHostMessage): void;
};

declare const acquireVsCodeApi: () => VsCodeApi;

export const vscode = acquireVsCodeApi();
