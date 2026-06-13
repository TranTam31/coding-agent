import * as vscode from "vscode";

export interface ModelDebugLogger {
  log(title: string, data: unknown): void;
}

export class VsCodeModelDebugLogger implements ModelDebugLogger, vscode.Disposable {
  private readonly output = vscode.window.createOutputChannel("Coding Agent Model Debug");
  private hasShown = false;

  log(title: string, data: unknown) {
    if (!this.hasShown) {
      this.output.show(true);
      this.hasShown = true;
    }

    this.output.appendLine("");
    this.output.appendLine(`===== ${new Date().toISOString()} ${title} =====`);
    this.output.appendLine(stringify(data));
  }

  dispose() {
    this.output.dispose();
  }
}

function stringify(data: unknown) {
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}
