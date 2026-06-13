export type CommandSafetyResult =
  | {
      safe: true;
    }
  | {
      safe: false;
      reason: string;
    };

const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\brm\s+(-[A-Za-z]*[rR][A-Za-z]*[fF]?|-[A-Za-z]*[fF][A-Za-z]*[rR])\b/,
    reason: "recursive force deletion with rm"
  },
  {
    pattern: /\bRemove-Item\b[\s\S]*\s-Recurse\b[\s\S]*\s-Force\b/i,
    reason: "recursive force deletion with Remove-Item"
  },
  {
    pattern: /\brmdir\b[\s\S]*(\/s\b|\/q\b)/i,
    reason: "recursive directory deletion with rmdir"
  },
  {
    pattern: /\bdel\b[\s\S]*(\/s\b|\/q\b)/i,
    reason: "recursive or quiet deletion with del"
  },
  {
    pattern: /\bgit\s+reset\s+--hard\b/i,
    reason: "destructive git reset"
  },
  {
    pattern: /\bgit\s+clean\b[\s\S]*-[A-Za-z]*[fdx]/i,
    reason: "destructive git clean"
  },
  {
    pattern: /\bformat\b\s+[A-Za-z]:/i,
    reason: "disk formatting command"
  },
  {
    pattern: /\bdiskpart\b/i,
    reason: "disk partitioning command"
  },
  {
    pattern: /\bdd\b[\s\S]*\bof=\/dev\//i,
    reason: "raw disk write with dd"
  },
  {
    pattern: /\bmkfs(\.[A-Za-z0-9]+)?\b/i,
    reason: "filesystem creation command"
  },
  {
    pattern: /\bshutdown\b|\breboot\b/i,
    reason: "system shutdown or reboot command"
  }
];

export function assessCommandSafety(command: string): CommandSafetyResult {
  const normalized = command.trim();

  for (const rule of DANGEROUS_PATTERNS) {
    if (rule.pattern.test(normalized)) {
      return {
        safe: false,
        reason: rule.reason
      };
    }
  }

  return {
    safe: true
  };
}
