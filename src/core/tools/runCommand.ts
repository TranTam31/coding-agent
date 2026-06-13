import { spawn } from "node:child_process";
import * as path from "node:path";
import type { ToolDefinition } from "./ToolRegistry";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 1024 * 1024;

type RunCommandInput = {
  command: string;
  cwd?: string;
  timeoutMs?: number;
  reason?: string;
};

export const runCommandTool = createRunCommandTool("run_command");
export const bashTool = createRunCommandTool("bash");

function createRunCommandTool(name: "run_command" | "bash"): ToolDefinition {
  return {
    name,
    description: "Run a terminal command in the current workspace after explicit user approval.",
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Command to execute. Use the project's normal shell command syntax."
        },
        cwd: {
          type: "string",
          description: "Optional workspace-relative working directory. Defaults to workspace root."
        },
        timeoutMs: {
          type: "number",
          description: "Optional timeout in milliseconds. Maximum is 120000."
        },
        reason: {
          type: "string",
          description: "Short reason why this command needs to run."
        }
      },
      required: ["command"],
      additionalProperties: false
    },
    permission: {
      action: "bash",
      resource: (input) => parseInput(input).command,
      description: (input) => {
        const parsed = parseInput(input);
        return `Run command${parsed.cwd ? ` in ${parsed.cwd}` : ""}: ${parsed.command}${parsed.reason ? `\nReason: ${parsed.reason}` : ""}`;
      }
    },
    execute: async (input, context) => {
      const parsed = parseInput(input);
      const cwd = resolveCwd(context.workspaceFolder.uri.fsPath, parsed.cwd);
      const result = await runCommand(parsed.command, cwd, parsed.timeoutMs ?? DEFAULT_TIMEOUT_MS, context.signal);

      return {
        content: [
          `Command: ${parsed.command}`,
          `CWD: ${cwd}`,
          `Exit code: ${result.exitCode ?? "terminated"}`,
          `Timed out: ${result.timedOut ? "yes" : "no"}`,
          "",
          "STDOUT:",
          result.stdout || "(empty)",
          "",
          "STDERR:",
          result.stderr || "(empty)",
          result.truncated ? "\n[output truncated]" : ""
        ].join("\n"),
        data: {
          command: parsed.command,
          cwd,
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          stdout: result.stdout,
          stderr: result.stderr,
          truncated: result.truncated
        }
      };
    }
  };
}

function parseInput(input: unknown): RunCommandInput {
  if (!isObject(input) || typeof input.command !== "string" || input.command.trim() === "") {
    throw new Error("run_command input must be { command: string }.");
  }

  if (input.cwd !== undefined && typeof input.cwd !== "string") {
    throw new Error("run_command cwd must be a string.");
  }

  if (input.timeoutMs !== undefined && (typeof input.timeoutMs !== "number" || input.timeoutMs < 1)) {
    throw new Error("run_command timeoutMs must be a positive number.");
  }

  if (input.reason !== undefined && typeof input.reason !== "string") {
    throw new Error("run_command reason must be a string.");
  }

  return {
    command: input.command.trim(),
    cwd: input.cwd,
    timeoutMs: input.timeoutMs === undefined ? undefined : Math.min(input.timeoutMs, MAX_TIMEOUT_MS),
    reason: input.reason
  };
}

function resolveCwd(workspaceRoot: string, cwd: string | undefined) {
  if (!cwd) {
    return workspaceRoot;
  }

  const resolved = path.resolve(workspaceRoot, cwd);
  const root = path.resolve(workspaceRoot);

  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`Command cwd escapes workspace: ${cwd}`);
  }

  return resolved;
}

function runCommand(command: string, cwd: string, timeoutMs: number, signal: AbortSignal) {
  return new Promise<{
    exitCode?: number | null;
    timedOut: boolean;
    stdout: string;
    stderr: string;
    truncated: boolean;
  }>((resolve) => {
    const child = spawn(getShell(), getShellArgs(command), {
      cwd,
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let truncated = false;
    let settled = false;
    let timedOut = false;

    const append = (stream: "stdout" | "stderr", chunk: Buffer) => {
      if (outputBytes >= MAX_OUTPUT_BYTES) {
        truncated = true;
        return;
      }

      const remaining = MAX_OUTPUT_BYTES - outputBytes;
      const slice = chunk.byteLength > remaining ? chunk.subarray(0, remaining) : chunk;
      const text = slice.toString("utf8");
      outputBytes += slice.byteLength;

      if (chunk.byteLength > remaining) {
        truncated = true;
      }

      if (stream === "stdout") {
        stdout += text;
      } else {
        stderr += text;
      }
    };

    const finish = (exitCode?: number | null) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      resolve({ exitCode, timedOut, stdout, stderr, truncated });
    };

    const abort = () => {
      child.kill();
      finish(null);
    };

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
      finish(null);
    }, timeoutMs);

    signal.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => append("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => append("stderr", chunk));
    child.on("error", (error) => {
      stderr += error.message;
      finish(null);
    });
    child.on("close", (code) => finish(code));
  });
}

function getShell() {
  return process.platform === "win32" ? "powershell.exe" : "/bin/sh";
}

function getShellArgs(command: string) {
  return process.platform === "win32"
    ? ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command]
    : ["-lc", command];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
