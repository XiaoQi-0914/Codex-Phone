import { randomUUID } from "node:crypto";
import { db } from "./db.js";
import type { PermissionMode, ProjectConfig } from "./types.js";

export type SessionRecord = {
  id: string;
  projectId: string;
  title: string;
  threadId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StoredMessage = {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  kind: "text" | "command_group" | "error" | "notice" | "summary";
  content: string;
  createdAt: string;
};

export type RunRecord = {
  id: string;
  sessionId: string;
  status: "running" | "completed" | "cancelled" | "failed";
  permissionMode: PermissionMode;
  startedAt: string;
  finishedAt: string | null;
  exitCode: number | null;
};

type SessionRow = {
  id: string;
  project_id: string;
  title: string;
  thread_id: string | null;
  created_at: string;
  updated_at: string;
};

type MessageRow = {
  id: string;
  session_id: string;
  role: StoredMessage["role"];
  kind: StoredMessage["kind"];
  content: string;
  created_at: string;
};

function now() {
  return new Date().toISOString();
}

function toSession(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    threadId: row.thread_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toMessage(row: MessageRow): StoredMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    kind: row.kind,
    content: row.content,
    createdAt: row.created_at
  };
}

export function ensureProject(project: ProjectConfig) {
  const timestamp = now();
  db.prepare(
    `
    INSERT INTO projects (id, name, path, created_at, updated_at)
    VALUES (@id, @name, @path, @createdAt, @updatedAt)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      path = excluded.path,
      updated_at = excluded.updated_at
    `
  ).run({
    id: project.id,
    name: project.name,
    path: project.path,
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

export function createSession(projectId: string, title = "新会话") {
  const timestamp = now();
  const session: SessionRecord = {
    id: randomUUID(),
    projectId,
    title,
    threadId: null,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  db.prepare(
    `
    INSERT INTO sessions (id, project_id, title, thread_id, created_at, updated_at)
    VALUES (@id, @projectId, @title, @threadId, @createdAt, @updatedAt)
    `
  ).run(session);

  setActiveSessionId(session.id);
  return session;
}

export function listSessions(projectId: string) {
  const rows = db
    .prepare(
      `
      SELECT id, project_id, title, thread_id, created_at, updated_at
      FROM sessions
      WHERE project_id = ? AND archived_at IS NULL
      ORDER BY updated_at DESC
      `
    )
    .all(projectId) as SessionRow[];

  return rows.map(toSession);
}

export function getSession(sessionId: string) {
  const row = db
    .prepare(
      `
      SELECT id, project_id, title, thread_id, created_at, updated_at
      FROM sessions
      WHERE id = ? AND archived_at IS NULL
      `
    )
    .get(sessionId) as SessionRow | undefined;

  return row ? toSession(row) : null;
}

export function getOrCreateActiveSession(projectId: string) {
  const activeId = getActiveSessionId(projectId);
  if (activeId) {
    const active = getSession(activeId);
    if (active?.projectId === projectId) {
      return active;
    }
  }

  const existing = listSessions(projectId)[0];
  if (existing) {
    setActiveSessionId(existing.id);
    return existing;
  }

  return createSession(projectId);
}

export function setActiveSessionId(sessionId: string) {
  const session = getSession(sessionId);
  if (!session) {
    return;
  }

  db.prepare(
    `
    INSERT INTO app_state (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `
  ).run(`active_session_id:${session.projectId}`, sessionId);
}

export function getActiveSessionId(projectId: string) {
  const row = db.prepare("SELECT value FROM app_state WHERE key = ?").get(`active_session_id:${projectId}`) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setActiveProjectId(projectId: string) {
  db.prepare(
    `
    INSERT INTO app_state (key, value)
    VALUES ('active_project_id', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `
  ).run(projectId);
}

export function getActiveProjectId() {
  const row = db.prepare("SELECT value FROM app_state WHERE key = 'active_project_id'").get() as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function touchSession(sessionId: string) {
  db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(now(), sessionId);
}

export function updateSessionThreadId(sessionId: string, threadId: string) {
  db.prepare("UPDATE sessions SET thread_id = ?, updated_at = ? WHERE id = ?").run(threadId, now(), sessionId);
}

export function updateSessionTitleFromMessage(sessionId: string, message: string) {
  const session = getSession(sessionId);
  if (!session || session.title !== "新会话") {
    return;
  }

  const compact = message.replace(/\s+/g, " ").trim();
  const title = compact.length > 20 ? `${compact.slice(0, 20)}...` : compact || "新会话";
  db.prepare("UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?").run(title, now(), sessionId);
}

export function renameSession(sessionId: string, title: string) {
  const compact = title.replace(/\s+/g, " ").trim();
  if (!compact) {
    return null;
  }

  const session = getSession(sessionId);
  if (!session) {
    return null;
  }

  const nextTitle = compact.length > 80 ? compact.slice(0, 80) : compact;
  const timestamp = now();
  db.prepare("UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?").run(nextTitle, timestamp, sessionId);

  return {
    ...session,
    title: nextTitle,
    updatedAt: timestamp
  };
}

export function archiveSession(sessionId: string) {
  db.prepare("UPDATE sessions SET archived_at = ?, updated_at = ? WHERE id = ?").run(now(), now(), sessionId);
}

export function addMessage(input: {
  sessionId: string;
  role: StoredMessage["role"];
  kind: StoredMessage["kind"];
  content: string;
}) {
  const message: StoredMessage = {
    id: randomUUID(),
    sessionId: input.sessionId,
    role: input.role,
    kind: input.kind,
    content: input.content,
    createdAt: now()
  };

  db.prepare(
    `
    INSERT INTO messages (id, session_id, role, kind, content, created_at)
    VALUES (@id, @sessionId, @role, @kind, @content, @createdAt)
    `
  ).run(message);
  touchSession(input.sessionId);
  return message;
}

export function listMessages(sessionId: string) {
  const rows = db
    .prepare(
      `
      SELECT id, session_id, role, kind, content, created_at
      FROM messages
      WHERE session_id = ?
      ORDER BY created_at ASC
      `
    )
    .all(sessionId) as MessageRow[];

  return rows.map(toMessage);
}

export function createRun(sessionId: string, permissionMode: PermissionMode) {
  const timestamp = now();
  const run: RunRecord = {
    id: randomUUID(),
    sessionId,
    status: "running",
    permissionMode,
    startedAt: timestamp,
    finishedAt: null,
    exitCode: null
  };

  db.prepare(
    `
    INSERT INTO runs (id, session_id, status, permission_mode, started_at, finished_at, exit_code)
    VALUES (@id, @sessionId, @status, @permissionMode, @startedAt, @finishedAt, @exitCode)
    `
  ).run(run);
  return run;
}

export function finishRun(runId: string, status: RunRecord["status"], exitCode: number | null) {
  db.prepare("UPDATE runs SET status = ?, finished_at = ?, exit_code = ? WHERE id = ?").run(
    status,
    now(),
    exitCode,
    runId
  );
}
