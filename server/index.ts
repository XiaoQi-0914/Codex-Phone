import express from "express";
import path from "node:path";
import { createServer as createViteServer } from "vite";
import { WebSocketServer, type WebSocket } from "ws";
import { cancelActiveCodexRun, collectGitSummary, runCodex } from "./codexRunner.js";
import { loadConfig } from "./projectConfig.js";
import {
  addMessage,
  archiveSession,
  createRun,
  createSession,
  ensureProject,
  finishRun,
  getOrCreateActiveSession,
  getActiveProjectId,
  getSession,
  listMessages,
  listSessions,
  renameSession,
  setActiveSessionId,
  setActiveProjectId,
  updateSessionThreadId,
  updateSessionTitleFromMessage
} from "./sessionStore.js";
import type { ClientMessage, PermissionMode, RunStatus, ServerMessage } from "./types.js";

let config = await loadConfig();
let projects = config.projects;
for (const project of projects) {
  ensureProject(project);
}
const app = express();
const codexCommand = config.codexCommand ?? (process.platform === "win32" ? "codex.cmd" : "codex");
let projectById = new Map(projects.map((project) => [project.id, project]));
const baseDir = path.resolve(process.env.CODEX_PHONE_BASE_DIR ?? process.cwd());

const webRoot = path.resolve(baseDir, "web");
const isProduction = process.env.NODE_ENV === "production";

if (isProduction) {
  const distRoot = path.resolve(baseDir, "dist/web");
  app.use(express.static(distRoot));
  app.use((_req, res) => {
    res.sendFile(path.join(distRoot, "index.html"));
  });
} else {
  const vite = await createViteServer({
    root: webRoot,
    server: {
      middlewareMode: true
    },
    appType: "spa"
  });
  app.use(vite.middlewares);
}

const server = app.listen(config.server.port, config.server.host, () => {
  console.log(`Codex Phone is running at http://${config.server.host}:${config.server.port}`);
  console.log(`Projects: ${projects.map((project) => `${project.name} (${project.path})`).join(", ")}`);
  console.log(`Codex command: ${codexCommand}`);
});

const wss = new WebSocketServer({ server, path: "/ws" });

const runLongNoticeMs = 5 * 60 * 1000;
let status: RunStatus = "idle";
let currentRunId = 0;
let activeProjectId = getActiveProjectId() ?? projects[0].id;
if (!projectById.has(activeProjectId)) {
  activeProjectId = projects[0].id;
}
setActiveProjectId(activeProjectId);
let activeSessionId = getOrCreateActiveSession(activeProjectId).id;

function now() {
  return new Date().toISOString();
}

function getActiveProject() {
  return projectById.get(activeProjectId) ?? projects[0];
}

function send(socket: WebSocket, message: ServerMessage) {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function broadcast(message: ServerMessage) {
  for (const client of wss.clients) {
    send(client, message);
  }
}

function setStatus(nextStatus: RunStatus) {
  status = nextStatus;
  broadcast({ type: "status", status });
}

async function refreshProjects() {
  const refreshedConfig = await loadConfig();
  config = refreshedConfig;
  projects = refreshedConfig.projects;
  projectById = new Map(projects.map((project) => [project.id, project]));

  for (const project of projects) {
    ensureProject(project);
  }

  if (!projectById.has(activeProjectId)) {
    activeProjectId = projects[0].id;
    setActiveProjectId(activeProjectId);
    const nextSession = getOrCreateActiveSession(activeProjectId);
    activeSessionId = nextSession.id;
    setActiveSessionId(nextSession.id);
  }
}

function getSessionPayload(sessionId: string) {
  return {
    projects,
    activeProjectId,
    sessions: listSessions(activeProjectId),
    activeSessionId: sessionId,
    messages: listMessages(sessionId)
  };
}

function normalizePermissionMode(mode: PermissionMode | undefined): PermissionMode {
  if (
    mode === "read-only" ||
    mode === "workspace-write" ||
    mode === "danger-full-access" ||
    mode === "bypass"
  ) {
    return mode;
  }

  return "workspace-write";
}

function getAgentMessage(event: unknown) {
  if (!event || typeof event !== "object") {
    return "";
  }

  const item = (event as Record<string, unknown>).item;
  if (!item || typeof item !== "object") {
    return "";
  }

  const record = item as Record<string, unknown>;
  if (record.type !== "agent_message") {
    return "";
  }

  return typeof record.text === "string" ? record.text : "";
}

function getCommandText(event: unknown) {
  if (!event || typeof event !== "object") {
    return "";
  }

  const item = (event as Record<string, unknown>).item;
  if (!item || typeof item !== "object") {
    return "";
  }

  const record = item as Record<string, unknown>;
  if (record.type !== "tool_call" && record.type !== "command_execution") {
    return "";
  }

  const command = record.command ?? record.cmd ?? record.arguments;
  return typeof command === "string" ? command : "";
}

function isUsefulRunSummary(summary: { gitStatus: string; gitDiffStat: string }, exitCode: number | null) {
  const hasUsefulGitStatus =
    summary.gitStatus &&
    !summary.gitStatus.includes("当前目录不是 Git 仓库") &&
    summary.gitStatus !== "干净";
  const hasUsefulDiff =
    summary.gitDiffStat &&
    summary.gitDiffStat !== "无 Git diff。" &&
    summary.gitDiffStat !== "没有已跟踪文件差异";
  const hasProblemExitCode = exitCode !== 0 && exitCode !== null;
  return hasProblemExitCode || hasUsefulGitStatus || hasUsefulDiff;
}

async function handleUserMessage(
  socket: WebSocket,
  sessionId: string,
  text: string,
  requestedPermissionMode?: PermissionMode
) {
  const message = text.trim();
  const permissionMode = normalizePermissionMode(requestedPermissionMode);
  if (!message) {
    return;
  }

  const session = getSession(sessionId);
  if (!session || session.projectId !== activeProjectId) {
    send(socket, {
      type: "error",
      sessionId,
      message: "会话不存在。",
      createdAt: now()
    });
    return;
  }

  if (status === "running") {
    send(socket, {
      type: "error",
      sessionId,
      message: "Codex is already running. Wait for the current run to finish.",
      createdAt: now()
    });
    return;
  }

  console.log(`User message: ${message}`);
  console.log(`Permission mode: ${permissionMode}`);
  const runId = ++currentRunId;
  activeSessionId = sessionId;
  setActiveSessionId(sessionId);
  updateSessionTitleFromMessage(sessionId, message);
  addMessage({ sessionId, role: "user", kind: "text", content: message });
  const run = createRun(sessionId, permissionMode);
  let threadId = session.threadId;
  const pendingCommands: string[] = [];
  const longRunTimer = setTimeout(() => {
    if (runId !== currentRunId || status !== "running") {
      return;
    }

    broadcast({
      type: "local_notice",
      sessionId,
      message: "当前运行已经超过 5 分钟，可能只是任务较长；如果看起来卡住了，可以点停止。",
      createdAt: now()
    });
  }, runLongNoticeMs);

  broadcast({ type: "user_message", sessionId, message, createdAt: now() });
  broadcast({ type: "sessions_updated", ...getSessionPayload(sessionId) });
  setStatus("running");

  try {
    console.log(`Starting Codex run (${threadId ? "resume" : "new"})`);
    const project = getActiveProject();
    const exitCode = await runCodex({
      codexCommand,
      projectPath: project.path,
      message,
      threadId,
      permissionMode,
      callbacks: {
        onEvent: (event, raw) => {
          const command = getCommandText(event);
          if (command) {
            pendingCommands.push(command);
          }

          const assistantText = getAgentMessage(event);
          if (assistantText) {
            if (pendingCommands.length > 0) {
              addMessage({
                sessionId,
                role: "system",
                kind: "command_group",
                content: JSON.stringify(pendingCommands)
              });
              pendingCommands.length = 0;
            }
            addMessage({ sessionId, role: "assistant", kind: "text", content: assistantText });
          }

          broadcast({ type: "codex_event", sessionId, event, raw, createdAt: now() });
        },
        onText: (textOutput) => {
          addMessage({ sessionId, role: "system", kind: "notice", content: textOutput });
          broadcast({ type: "codex_text", sessionId, text: textOutput, createdAt: now() });
        },
        onThreadStarted: (startedThreadId) => {
          threadId = startedThreadId;
          updateSessionThreadId(sessionId, startedThreadId);
        }
      }
    });
    clearTimeout(longRunTimer);

    if (runId !== currentRunId) {
      return;
    }

    if (pendingCommands.length > 0) {
      addMessage({
        sessionId,
        role: "system",
        kind: "command_group",
        content: JSON.stringify(pendingCommands)
      });
    }

    const summary = await collectGitSummary(project.path);

    if (runId !== currentRunId) {
      return;
    }

    finishRun(run.id, exitCode === 0 || exitCode === null ? "completed" : "failed", exitCode);

    if (isUsefulRunSummary(summary, exitCode)) {
      addMessage({
        sessionId,
        role: "system",
        kind: "summary",
        content: JSON.stringify({
          exitCode,
          gitStatus: summary.gitStatus,
          gitDiffStat: summary.gitDiffStat
        })
      });
    }

    broadcast({
      type: "run_complete",
      sessionId,
      exitCode,
      gitStatus: summary.gitStatus,
      gitDiffStat: summary.gitDiffStat,
      createdAt: now()
    });
    broadcast({ type: "sessions_updated", ...getSessionPayload(sessionId) });
    setStatus("idle");
  } catch (error) {
    clearTimeout(longRunTimer);
    if (runId !== currentRunId) {
      return;
    }

    const messageText = error instanceof Error ? error.message : String(error);
    finishRun(run.id, "failed", null);
    addMessage({ sessionId, role: "system", kind: "error", content: messageText });
    broadcast({ type: "error", sessionId, message: messageText, createdAt: now() });
    setStatus("error");
    setStatus("idle");
  }
}

wss.on("connection", (socket) => {
  void refreshProjects()
    .catch((error) => {
      send(socket, {
        type: "error",
        message: error instanceof Error ? error.message : String(error),
        createdAt: now()
      });
    })
    .finally(() => {
      send(socket, {
        type: "hello",
        ...getSessionPayload(activeSessionId),
        status
      });
    });

  socket.on("message", (data) => {
    let parsed: ClientMessage;

    try {
      parsed = JSON.parse(data.toString("utf8")) as ClientMessage;
    } catch {
      send(socket, {
        type: "error",
        message: "Invalid client message.",
        createdAt: now()
      });
      return;
    }

    if (parsed.type === "ping") {
      send(socket, { type: "status", status });
      return;
    }

    if (parsed.type === "refresh_projects") {
      void refreshProjects()
        .then(() => {
          broadcast({ type: "sessions_updated", ...getSessionPayload(activeSessionId) });
        })
        .catch((error) => {
          send(socket, {
            type: "error",
            message: error instanceof Error ? error.message : String(error),
            createdAt: now()
          });
        });
      return;
    }

    if (parsed.type === "select_project") {
      void (async () => {
        await refreshProjects();
        if (!projectById.has(parsed.projectId)) {
          send(socket, {
            type: "error",
            message: "项目不存在。",
            createdAt: now()
          });
          return;
        }

        activeProjectId = parsed.projectId;
        setActiveProjectId(activeProjectId);
        const nextSession = getOrCreateActiveSession(activeProjectId);
        activeSessionId = nextSession.id;
        setActiveSessionId(nextSession.id);
        broadcast({ type: "sessions_updated", ...getSessionPayload(nextSession.id) });
        send(socket, {
          type: "session_selected",
          sessionId: nextSession.id,
          projectId: activeProjectId,
          messages: listMessages(nextSession.id)
        });
      })().catch((error) => {
        send(socket, {
          type: "error",
          message: error instanceof Error ? error.message : String(error),
          createdAt: now()
        });
      });
      return;
    }

    if (parsed.type === "create_session") {
      void (async () => {
        await refreshProjects();
        const session = createSession(activeProjectId);
        activeSessionId = session.id;
        broadcast({ type: "sessions_updated", ...getSessionPayload(session.id) });
        send(socket, { type: "session_selected", sessionId: session.id, projectId: activeProjectId, messages: [] });
      })().catch((error) => {
        send(socket, {
          type: "error",
          message: error instanceof Error ? error.message : String(error),
          createdAt: now()
        });
      });
      return;
    }

    if (parsed.type === "select_session") {
      const session = getSession(parsed.sessionId);
      if (!session || session.projectId !== activeProjectId) {
        send(socket, {
          type: "error",
          sessionId: parsed.sessionId,
          message: "会话不存在。",
          createdAt: now()
        });
        return;
      }

      activeSessionId = session.id;
      setActiveSessionId(session.id);
      broadcast({ type: "sessions_updated", ...getSessionPayload(session.id) });
      send(socket, {
        type: "session_selected",
        sessionId: session.id,
        projectId: activeProjectId,
        messages: listMessages(session.id)
      });
      return;
    }

    if (parsed.type === "rename_session") {
      if (status === "running") {
        send(socket, {
          type: "error",
          sessionId: parsed.sessionId,
          message: "运行中不能重命名会话。",
          createdAt: now()
        });
        return;
      }

      const session = getSession(parsed.sessionId);
      if (!session || session.projectId !== activeProjectId) {
        send(socket, {
          type: "error",
          sessionId: parsed.sessionId,
          message: "会话不存在。",
          createdAt: now()
        });
        return;
      }

      const renamed = renameSession(parsed.sessionId, parsed.title);
      if (!renamed) {
        send(socket, {
          type: "error",
          sessionId: parsed.sessionId,
          message: "会话标题不能为空。",
          createdAt: now()
        });
        return;
      }

      broadcast({ type: "sessions_updated", ...getSessionPayload(activeSessionId) });
      return;
    }

    if (parsed.type === "delete_session") {
      if (status === "running") {
        send(socket, {
          type: "error",
          sessionId: parsed.sessionId,
          message: "运行中不能删除会话。",
          createdAt: now()
        });
        return;
      }

      const session = getSession(parsed.sessionId);
      if (!session || session.projectId !== activeProjectId) {
        send(socket, {
          type: "error",
          sessionId: parsed.sessionId,
          message: "会话不存在。",
          createdAt: now()
        });
        return;
      }

      void (async () => {
        await refreshProjects();
        archiveSession(parsed.sessionId);
        const nextSession = listSessions(activeProjectId)[0] ?? createSession(activeProjectId);
        activeSessionId = nextSession.id;
        setActiveSessionId(nextSession.id);
        broadcast({ type: "sessions_updated", ...getSessionPayload(nextSession.id) });
        send(socket, {
          type: "session_selected",
          sessionId: nextSession.id,
          projectId: activeProjectId,
          messages: listMessages(nextSession.id)
        });
      })().catch((error) => {
        send(socket, {
          type: "error",
          message: error instanceof Error ? error.message : String(error),
          createdAt: now()
        });
      });
      return;
    }

    if (parsed.type === "cancel_run") {
      const cancelled = cancelActiveCodexRun();
      if (cancelled) {
        currentRunId += 1;
      }
      broadcast({
        type: cancelled ? "local_notice" : "error",
        sessionId: activeSessionId,
        message: cancelled ? "已请求停止当前运行。" : "当前没有正在运行的 Codex。",
        createdAt: now()
      });
      setStatus("idle");
      return;
    }

    if (parsed.type === "user_message") {
      void handleUserMessage(socket, parsed.sessionId, parsed.message, parsed.permissionMode);
    }
  });
});
