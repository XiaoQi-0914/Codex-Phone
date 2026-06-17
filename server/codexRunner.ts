import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import readline from "node:readline";
import type { PermissionMode, RunCallbacks } from "./types.js";

export type RunCodexOptions = {
  codexCommand: string;
  projectPath: string;
  message: string;
  threadId: string | null;
  permissionMode: PermissionMode;
  callbacks: RunCallbacks;
};

export type CommandResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

let activeCodexProcess: ChildProcess | null = null;

export function cancelActiveCodexRun() {
  if (!activeCodexProcess || activeCodexProcess.killed) {
    return false;
  }

  activeCodexProcess.kill();
  return true;
}

function isNoisyCodexText(text: string) {
  return (
    text.includes("fatal: not a git repository") ||
    text.includes("codex_core::tools::router") ||
    text.includes("Reading additional input from stdin")
  );
}

function getPermissionArgs(mode: PermissionMode) {
  if (mode === "bypass") {
    return ["--dangerously-bypass-approvals-and-sandbox"];
  }

  return ["--sandbox", mode];
}

function getResumePermissionArgs(mode: PermissionMode) {
  if (mode === "bypass") {
    return ["--dangerously-bypass-approvals-and-sandbox"];
  }

  return ["-c", `sandbox_mode="${mode}"`];
}

export async function runCodex(options: RunCodexOptions): Promise<number | null> {
  const args = options.threadId
    ? [
        "exec",
        "resume",
        options.threadId,
        "--json",
        "--skip-git-repo-check",
        ...getResumePermissionArgs(options.permissionMode),
        options.message
      ]
    : [
        "exec",
        "--json",
        "--skip-git-repo-check",
        ...getPermissionArgs(options.permissionMode),
        "-C",
        options.projectPath,
        options.message
      ];

  const child = spawn(options.codexCommand, args, {
    cwd: options.projectPath,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  activeCodexProcess = child;

  const stdout = readline.createInterface({
    input: child.stdout,
    crlfDelay: Infinity
  });

  let resolveRun: ((exitCode: number | null) => void) | null = null;
  let rejectRun: ((error: Error) => void) | null = null;
  let finished = false;
  let turnCompleted = false;
  let completionTimer: NodeJS.Timeout | null = null;
  const hardTimeout = setTimeout(() => {
    finish(124);
  }, 10 * 60 * 1000);

  function finish(exitCode: number | null) {
    if (finished) {
      return;
    }

    finished = true;
    clearTimeout(hardTimeout);
    if (completionTimer) {
      clearTimeout(completionTimer);
    }
    stdout.close();

    if (!child.killed) {
      child.kill();
    }

    if (activeCodexProcess === child) {
      activeCodexProcess = null;
    }
    resolveRun?.(exitCode);
  }

  stdout.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    try {
      const event = JSON.parse(trimmed) as { type?: string };
      options.callbacks.onEvent(event, trimmed);

      if (
        event.type === "thread.started" &&
        "thread_id" in event &&
        typeof event.thread_id === "string"
      ) {
        options.callbacks.onThreadStarted(event.thread_id);
      }

      if (event.type === "turn.completed") {
        turnCompleted = true;
        completionTimer = setTimeout(() => finish(0), 500);
      }
    } catch {
      options.callbacks.onText(line);
    }
  });

  child.stderr.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8").trim();
    if (text && !isNoisyCodexText(text)) {
      options.callbacks.onText(text);
    }
  });

  return new Promise((resolve, reject) => {
    resolveRun = resolve;
    rejectRun = reject;

    child.on("error", (error) => {
      if (finished) {
        return;
      }
      clearTimeout(hardTimeout);
      rejectRun?.(new Error(`Failed to start ${options.codexCommand}: ${error.message}`));
    });
    child.on("close", (code) => {
      if (activeCodexProcess === child) {
        activeCodexProcess = null;
      }

      if (finished) {
        return;
      }

      if (turnCompleted && (code === null || code === 0)) {
        finish(0);
        return;
      }

      finish(code);
    });
  });
}

export async function runCommand(command: string, args: string[], cwd: string): Promise<CommandResult> {
  const child = spawn(command, args, {
    cwd,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });

  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });

  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });

  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}

export async function collectGitSummary(projectPath: string): Promise<{
  gitStatus: string;
  gitDiffStat: string;
}> {
  try {
    const repoCheck = await runCommand("git", ["rev-parse", "--is-inside-work-tree"], projectPath);
    if (repoCheck.exitCode !== 0 || repoCheck.stdout.trim() !== "true") {
      return {
        gitStatus: "当前目录不是 Git 仓库，已跳过 git 摘要。",
        gitDiffStat: "无 Git diff。"
      };
    }

    const [status, diffStat] = await Promise.all([
      runCommand("git", ["status", "--short"], projectPath),
      runCommand("git", ["diff", "--stat"], projectPath)
    ]);

    return {
      gitStatus: status.stdout.trim() || status.stderr.trim(),
      gitDiffStat: diffStat.stdout.trim() || diffStat.stderr.trim()
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      gitStatus: `Unable to collect git status: ${message}`,
      gitDiffStat: ""
    };
  }
}
