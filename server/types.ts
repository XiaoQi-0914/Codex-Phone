export type AppConfig = {
  codexCommand?: string;
  project: {
    id: string;
    name: string;
    path: string;
  };
  server: {
    host: string;
    port: number;
  };
};

export type ClientMessage =
  | {
      type: "user_message";
      sessionId: string;
      message: string;
      permissionMode?: PermissionMode;
    }
  | {
      type: "create_session";
    }
  | {
      type: "select_session";
      sessionId: string;
    }
  | {
      type: "delete_session";
      sessionId: string;
    }
  | {
      type: "ping";
    }
  | {
      type: "cancel_run";
    };

export type ServerMessage =
  | {
      type: "hello";
      project: AppConfig["project"];
      sessions: SessionSummary[];
      activeSessionId: string;
      messages: StoredDisplayMessage[];
      status: RunStatus;
    }
  | {
      type: "sessions_updated";
      sessions: SessionSummary[];
      activeSessionId: string;
    }
  | {
      type: "session_selected";
      sessionId: string;
      messages: StoredDisplayMessage[];
    }
  | {
      type: "status";
      status: RunStatus;
    }
  | {
      type: "user_message";
      sessionId: string;
      message: string;
      createdAt: string;
    }
  | {
      type: "codex_event";
      sessionId: string;
      event: unknown;
      raw: string;
      createdAt: string;
    }
  | {
      type: "codex_text";
      sessionId: string;
      text: string;
      createdAt: string;
    }
  | {
      type: "run_complete";
      sessionId: string;
      exitCode: number | null;
      gitStatus: string;
      gitDiffStat: string;
      createdAt: string;
    }
  | {
      type: "error";
      sessionId?: string;
      message: string;
      createdAt: string;
    }
  | {
      type: "local_notice";
      sessionId?: string;
      message: string;
      createdAt: string;
    };

export type RunStatus = "idle" | "running" | "error";

export type PermissionMode = "read-only" | "workspace-write" | "danger-full-access" | "bypass";

export type RunCallbacks = {
  onEvent: (event: unknown, raw: string) => void;
  onText: (text: string) => void;
  onThreadStarted: (threadId: string) => void;
};

export type SessionSummary = {
  id: string;
  projectId: string;
  title: string;
  threadId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StoredDisplayMessage = {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  kind: "text" | "command_group" | "error" | "notice" | "summary";
  content: string;
  createdAt: string;
};
