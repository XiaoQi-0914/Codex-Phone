import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";

type RunStatus = "idle" | "running" | "error";
type PermissionMode = "read-only" | "workspace-write" | "danger-full-access" | "bypass";

type Project = {
  id: string;
  name: string;
  path: string;
};

type SessionSummary = {
  id: string;
  projectId: string;
  title: string;
  threadId: string | null;
  createdAt: string;
  updatedAt: string;
};

type StoredDisplayMessage = {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  kind: "text" | "command_group" | "error" | "notice" | "summary";
  content: string;
  createdAt: string;
};

type ServerMessage =
  | {
      type: "hello";
      project: Project;
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
      local?: boolean;
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

type ChatItem = {
  id: string;
  message: DisplayMessage;
};

type RenderItem = ChatItem;

type DisplayMessage =
  | {
      type: "display_user";
      sessionId: string;
      text: string;
      createdAt: string;
    }
  | {
      type: "display_assistant";
      sessionId: string;
      text: string;
      createdAt: string;
    }
  | {
      type: "display_command";
      sessionId: string;
      command: string;
      createdAt: string;
    }
  | {
      type: "display_command_group";
      sessionId?: string;
      commands: string[];
      createdAt?: string;
    }
  | {
      type: "display_error";
      sessionId?: string;
      text: string;
      createdAt: string;
    }
  | {
      type: "display_notice";
      sessionId?: string;
      text: string;
      createdAt: string;
    }
  | {
      type: "display_summary";
      sessionId: string;
      exitCode: number | null;
      gitStatus: string;
      gitDiffStat: string;
      createdAt: string;
    }
  | {
      type: "display_event";
      sessionId: string;
      title: string;
      event: unknown;
      raw: string;
      extractedText: string;
      createdAt: string;
    }
  | {
      type: "display_text";
      sessionId: string;
      text: string;
      createdAt: string;
    };

function makeId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toChatItem(message: DisplayMessage, id = makeId()): ChatItem {
  return { id, message };
}

function storedMessageToDisplayMessage(message: StoredDisplayMessage): DisplayMessage {
  if (message.role === "user") {
    return {
      type: "display_user",
      sessionId: message.sessionId,
      text: message.content,
      createdAt: message.createdAt
    };
  }

  if (message.kind === "command_group") {
    let commands: string[] = [];
    try {
      const parsed = JSON.parse(message.content);
      commands = Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
    } catch {
      commands = [message.content];
    }

    return {
      type: "display_command_group",
      sessionId: message.sessionId,
      commands,
      createdAt: message.createdAt
    };
  }

  if (message.kind === "error") {
    return {
      type: "display_error",
      sessionId: message.sessionId,
      text: message.content,
      createdAt: message.createdAt
    };
  }

  if (message.kind === "notice") {
    return {
      type: "display_notice",
      sessionId: message.sessionId,
      text: message.content,
      createdAt: message.createdAt
    };
  }

  if (message.kind === "summary") {
    try {
      const parsed = JSON.parse(message.content) as {
        exitCode?: number | null;
        gitStatus?: string;
        gitDiffStat?: string;
      };
      return {
        type: "display_summary",
        sessionId: message.sessionId,
        exitCode: parsed.exitCode ?? null,
        gitStatus: parsed.gitStatus ?? "",
        gitDiffStat: parsed.gitDiffStat ?? "",
        createdAt: message.createdAt
      };
    } catch {
      return {
        type: "display_notice",
        sessionId: message.sessionId,
        text: message.content,
        createdAt: message.createdAt
      };
    }
  }

  return {
    type: "display_assistant",
    sessionId: message.sessionId,
    text: message.content,
    createdAt: message.createdAt
  };
}

function storedMessagesToChatItems(messages: StoredDisplayMessage[]) {
  return messages.map((message) => toChatItem(storedMessageToDisplayMessage(message), message.id));
}

function formatEventTitle(event: unknown) {
  if (!event || typeof event !== "object") {
    return "Codex 事件";
  }

  const record = event as Record<string, unknown>;
  const type = record.type ?? record.event ?? record.kind;
  return typeof type === "string" ? type : "Codex 事件";
}

function maybeExtractText(event: unknown) {
  if (!event || typeof event !== "object") {
    return "";
  }

  const record = event as Record<string, unknown>;
  for (const key of ["message", "text", "content", "summary"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return "";
}

function getCodexItem(event: unknown) {
  if (!event || typeof event !== "object") {
    return null;
  }

  const record = event as Record<string, unknown>;
  const item = record.item;
  if (!item || typeof item !== "object") {
    return null;
  }

  return item as Record<string, unknown>;
}

function getAgentMessage(event: unknown) {
  const item = getCodexItem(event);
  if (!item || item.type !== "agent_message") {
    return "";
  }

  return typeof item.text === "string" ? item.text : "";
}

function getCommandText(event: unknown) {
  const item = getCodexItem(event);
  if (!item) {
    return "";
  }

  if (item.type === "tool_call" || item.type === "command_execution") {
    const command = item.command ?? item.cmd ?? item.arguments;
    if (typeof command === "string") {
      return command;
    }
  }

  return "";
}

function getEventItemType(event: unknown) {
  const item = getCodexItem(event);
  return typeof item?.type === "string" ? item.type : "";
}

function isQuietEvent(event: unknown) {
  if (!event || typeof event !== "object") {
    return false;
  }

  const type = (event as Record<string, unknown>).type;
  const itemType = getEventItemType(event);

  return (
    type === "thread.started" ||
    type === "turn.started" ||
    type === "turn.completed" ||
    itemType === "web_search"
  );
}

function serverMessageToDisplayMessages(message: ServerMessage): DisplayMessage[] {
  if (message.type === "user_message") {
    return [
      {
        type: "display_user",
        sessionId: message.sessionId,
        text: message.message,
        createdAt: message.createdAt
      }
    ];
  }

  if (message.type === "codex_text") {
    if (message.text.includes("Reading additional input from stdin")) {
      return [];
    }

    return [
      {
        type: "display_text",
        sessionId: message.sessionId,
        text: message.text,
        createdAt: message.createdAt
      }
    ];
  }

  if (message.type === "codex_event") {
    const agentMessage = getAgentMessage(message.event);
    if (agentMessage) {
      return [
        {
          type: "display_assistant",
          sessionId: message.sessionId,
          text: agentMessage,
          createdAt: message.createdAt
        }
      ];
    }

    const command = getCommandText(message.event);
    if (command) {
      return [
        {
          type: "display_command",
          sessionId: message.sessionId,
          command,
          createdAt: message.createdAt
        }
      ];
    }

    if (isQuietEvent(message.event)) {
      return [];
    }

    return [
      {
        type: "display_event",
        sessionId: message.sessionId,
        title: formatEventTitle(message.event),
        event: message.event,
        raw: message.raw,
        extractedText: maybeExtractText(message.event),
        createdAt: message.createdAt
      }
    ];
  }

  if (message.type === "run_complete") {
    return [
      {
        type: "display_summary",
        sessionId: message.sessionId,
        exitCode: message.exitCode,
        gitStatus: message.gitStatus,
        gitDiffStat: message.gitDiffStat,
        createdAt: message.createdAt
      }
    ];
  }

  if (message.type === "error") {
    return [
      {
        type: "display_error",
        sessionId: message.sessionId,
        text: message.message,
        createdAt: message.createdAt
      }
    ];
  }

  if (message.type === "local_notice") {
    return [
      {
        type: "display_notice",
        sessionId: message.sessionId,
        text: message.message,
        createdAt: message.createdAt
      }
    ];
  }

  return [];
}

function isLongText(text: string) {
  return text.length > 600 || text.split("\n").length > 12;
}

function CollapsibleBlock({
  title,
  children,
  defaultOpen = false
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className="collapse" open={defaultOpen}>
      <summary>{title}</summary>
      {children}
    </details>
  );
}

function buildRenderItems(items: ChatItem[]): RenderItem[] {
  const renderItems: RenderItem[] = [];
  let commandBuffer: string[] = [];

  function flushCommands() {
    if (commandBuffer.length === 0) {
      return;
    }

    renderItems.push({
      id: `commands-${renderItems.length}-${commandBuffer.length}`,
      message: {
        type: "display_command_group",
        commands: commandBuffer
      }
    });
    commandBuffer = [];
  }

  for (const item of items) {
    const command = item.message.type === "display_command" ? item.message.command : "";

    if (command) {
      commandBuffer.push(command);
      continue;
    }

    flushCommands();
    renderItems.push(item);
  }

  flushCommands();
  return renderItems;
}

function MarkdownLite({ text }: { text: string }) {
  const blocks = parseMarkdownBlocks(text);

  return (
    <>
      {blocks.map((block, index) => {
        if (block.type === "code") {
          return (
            <pre key={index}>
              <code>{block.text}</code>
            </pre>
          );
        }

        if (block.type === "heading") {
          const Tag = `h${Math.min(block.level, 3)}` as "h1" | "h2" | "h3";
          return <Tag key={index}>{renderInlineMarkdown(block.text)}</Tag>;
        }

        if (block.type === "list") {
          return (
            <ul key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderInlineMarkdown(item)}</li>
              ))}
            </ul>
          );
        }

        return <p key={index}>{renderInlineMarkdown(block.text)}</p>;
      })}
    </>
  );
}

type MarkdownBlock =
  | { type: "code"; text: string }
  | { type: "heading"; level: number; text: string }
  | { type: "list"; items: string[] }
  | { type: "paragraph"; text: string };

function parseMarkdownBlocks(text: string): MarkdownBlock[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];
  let listItems: string[] = [];
  let codeLines: string[] = [];
  let inCode = false;

  function flushParagraph() {
    if (paragraph.length > 0) {
      blocks.push({ type: "paragraph", text: paragraph.join("\n") });
      paragraph = [];
    }
  }

  function flushList() {
    if (listItems.length > 0) {
      blocks.push({ type: "list", items: listItems });
      listItems = [];
    }
  }

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      if (inCode) {
        blocks.push({ type: "code", text: codeLines.join("\n") });
        codeLines = [];
        inCode = false;
      } else {
        flushParagraph();
        flushList();
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2] });
      continue;
    }

    const list = /^\s*[-*]\s+(.*)$/.exec(line);
    if (list) {
      flushParagraph();
      listItems.push(list[1]);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  if (inCode) {
    blocks.push({ type: "code", text: codeLines.join("\n") });
  }
  flushParagraph();
  flushList();

  return blocks;
}

function renderInlineMarkdown(text: string) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }

    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }

    return part;
  });
}

export default function App() {
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<RunStatus>("idle");
  const [project, setProject] = useState<Project | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messagesBySession, setMessagesBySession] = useState<Record<string, ChatItem[]>>({});
  const [input, setInput] = useState("");
  const [permissionMode, setPermissionMode] = useState<PermissionMode>("workspace-write");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);

  const canSend = connected && status !== "running" && input.trim().length > 0;
  const items = activeSessionId ? (messagesBySession[activeSessionId] ?? []) : [];

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  function appendDisplayMessage(sessionId: string | undefined, message: DisplayMessage) {
    if (!sessionId) {
      return;
    }

    setMessagesBySession((current) => ({
      ...current,
      [sessionId]: [...(current[sessionId] ?? []), toChatItem(message)]
    }));
  }

  function appendServerMessage(message: ServerMessage) {
    const displayMessages = serverMessageToDisplayMessages(message);
    for (const displayMessage of displayMessages) {
      appendDisplayMessage(displayMessage.sessionId, displayMessage);
    }
  }

  function setSessionMessages(sessionId: string, messages: StoredDisplayMessage[]) {
    setMessagesBySession((current) => ({
      ...current,
      [sessionId]: storedMessagesToChatItems(messages)
    }));
  }

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${protocol}://${window.location.host}/ws`);

    ws.addEventListener("open", () => {
      setConnected(true);
    });

    ws.addEventListener("close", () => {
      setConnected(false);
      setSocket(null);
      const sessionId = activeSessionIdRef.current ?? undefined;
      appendDisplayMessage(sessionId, {
        type: "display_notice",
        sessionId,
        text: "连接已断开。请确认电脑端服务仍在运行，然后刷新页面。",
        createdAt: new Date().toISOString()
      });
    });

    ws.addEventListener("error", () => {
      const sessionId = activeSessionIdRef.current ?? undefined;
      appendDisplayMessage(sessionId, {
        type: "display_notice",
        sessionId,
        text: "连接失败。请检查地址、网络和 Windows 防火墙。",
        createdAt: new Date().toISOString()
      });
    });

    ws.addEventListener("message", (event) => {
      let parsed: ServerMessage;

      try {
        parsed = JSON.parse(event.data) as ServerMessage;
      } catch {
        const sessionId = activeSessionIdRef.current ?? undefined;
        appendDisplayMessage(sessionId, {
          type: "display_notice",
          sessionId,
          text: "收到了一条无法解析的服务端消息。",
          createdAt: new Date().toISOString()
        });
        return;
      }

      if (parsed.type === "hello") {
        setProject(parsed.project);
        setSessions(parsed.sessions);
        setActiveSessionId(parsed.activeSessionId);
        setSessionMessages(parsed.activeSessionId, parsed.messages);
        setStatus(parsed.status);
        return;
      }

      if (parsed.type === "sessions_updated") {
        setSessions(parsed.sessions);
        setActiveSessionId(parsed.activeSessionId);
        return;
      }

      if (parsed.type === "session_selected") {
        setActiveSessionId(parsed.sessionId);
        setSessionMessages(parsed.sessionId, parsed.messages);
        return;
      }

      if (parsed.type === "status") {
        setStatus(parsed.status);
        return;
      }

      if (parsed.type === "user_message") {
        return;
      }

      appendServerMessage(parsed);
    });

    setSocket(ws);

    return () => {
      ws.close();
    };
  }, []);

  useEffect(() => {
    listRef.current?.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: "smooth"
    });
  }, [items]);

  const statusText = useMemo(() => {
    if (!connected) {
      return "未连接";
    }

    if (status === "running") {
      return "运行中";
    }

    if (status === "error") {
      return "错误";
    }

    return "空闲";
  }, [connected, status]);

  const renderItems = useMemo(() => buildRenderItems(items), [items]);

  function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submitMessage();
  }

  function submitMessage() {
    const message = input.trim();
    if (!activeSessionId) {
      return;
    }

    if (!socket || socket.readyState !== WebSocket.OPEN) {
      appendDisplayMessage(activeSessionId, {
        type: "display_notice",
        sessionId: activeSessionId,
        text: "还没有连上电脑端服务，暂时不能发送。",
        createdAt: new Date().toISOString()
      });
      return;
    }

    if (!canSend) {
      return;
    }

    socket.send(
      JSON.stringify({
        type: "user_message",
        sessionId: activeSessionId,
        message,
        permissionMode
      })
    );
    appendDisplayMessage(activeSessionId, {
      type: "display_user",
      sessionId: activeSessionId,
      text: message,
      createdAt: new Date().toISOString()
    });
    setInput("");
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }

    event.preventDefault();
    submitMessage();
  }

  function cancelRun() {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    socket.send(JSON.stringify({ type: "cancel_run" }));
  }

  function createSession() {
    if (!socket || socket.readyState !== WebSocket.OPEN || status === "running") {
      return;
    }

    socket.send(JSON.stringify({ type: "create_session" }));
    setSidebarOpen(false);
  }

  function selectSession(sessionId: string) {
    if (!socket || socket.readyState !== WebSocket.OPEN || status === "running" || sessionId === activeSessionId) {
      return;
    }

    socket.send(JSON.stringify({ type: "select_session", sessionId }));
    setSidebarOpen(false);
  }

  function deleteSession() {
    if (!socket || socket.readyState !== WebSocket.OPEN || status === "running" || !activeSessionId) {
      return;
    }

    const activeSession = sessions.find((session) => session.id === activeSessionId);
    const title = activeSession?.title ?? "当前会话";
    if (!window.confirm(`删除会话“${title}”？历史记录会从列表中移除。`)) {
      return;
    }

    socket.send(JSON.stringify({ type: "delete_session", sessionId: activeSessionId }));
  }

  const activeSession = sessions.find((session) => session.id === activeSessionId);

  return (
    <main className="shell">
      <header className="topbar">
        <button type="button" className="sidebar-toggle" onClick={() => setSidebarOpen(true)}>
          会话
        </button>
        <div className="topbar-title">
          <h1>Codex Phone</h1>
          <p>{activeSession ? activeSession.title : project ? project.name : "等待连接电脑端服务"}</p>
        </div>
        <span className={`status status-${connected ? status : "disconnected"}`}>{statusText}</span>
      </header>

      {sidebarOpen ? <button type="button" className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} /> : null}
      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`} aria-hidden={!sidebarOpen}>
        <div className="sidebar-header">
          <div>
            <h2>{project?.name ?? "项目"}</h2>
            <p>{project?.path ?? "等待连接"}</p>
          </div>
          <button type="button" onClick={() => setSidebarOpen(false)}>
            关闭
          </button>
        </div>
        <div className="sidebar-actions">
          <button type="button" onClick={createSession} disabled={!connected || status === "running"}>
            新会话
          </button>
          <button
            type="button"
            className="delete-session-button"
            onClick={deleteSession}
            disabled={!connected || status === "running" || !activeSessionId}
          >
            删除当前
          </button>
        </div>
        <div className="session-list">
          {sessions.map((session) => (
            <button
              type="button"
              className={`session-item ${session.id === activeSessionId ? "session-item-active" : ""}`}
              key={session.id}
              onClick={() => selectSession(session.id)}
              disabled={status === "running"}
            >
              <span>{session.title}</span>
              <small>{session.threadId ? "已绑定上下文" : "新会话"}</small>
            </button>
          ))}
        </div>
      </aside>

      <section className="messages" ref={listRef}>
        {items.length === 0 ? (
          <div className="empty">
            <h2>连接成功后即可发送</h2>
            <p>建议第一条先发只读请求，确认事件流正常后再让 Codex 修改文件。</p>
          </div>
        ) : (
          renderItems.map((item) => <MessageItem key={item.id} item={item.message} />)
        )}
      </section>

      <form className="composer" onSubmit={sendMessage}>
        <select
          className="permission-select"
          value={permissionMode}
          onChange={(event) => setPermissionMode(event.target.value as PermissionMode)}
          disabled={!connected || status === "running"}
          aria-label="权限模式"
        >
          <option value="read-only">只读</option>
          <option value="workspace-write">可改项目</option>
          <option value="danger-full-access">完全访问</option>
          <option value="bypass">危险全自动</option>
        </select>
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleComposerKeyDown}
          placeholder={connected ? "给这台电脑上的 Codex 发送消息" : "正在连接电脑端服务..."}
          rows={2}
          disabled={!connected || status === "running"}
        />
        {status === "running" ? (
          <button type="button" className="stop-button" onClick={cancelRun}>
            停止
          </button>
        ) : (
          <button type="submit" disabled={!canSend}>
            发送
          </button>
        )}
      </form>
    </main>
  );
}

function MessageItem({ item }: { item: RenderItem["message"] }) {
  if (item.type === "display_user") {
    return (
      <article className="message user">
        <div className="bubble">{item.text}</div>
      </article>
    );
  }

  if (item.type === "display_text") {
    if (isLongText(item.text)) {
      return (
        <article className="message system">
          <CollapsibleBlock title="Codex 文本" defaultOpen={false}>
            <pre>{item.text}</pre>
          </CollapsibleBlock>
        </article>
      );
    }

    return (
      <article className="message system">
        <div className="label">Codex 文本</div>
        <pre>{item.text}</pre>
      </article>
    );
  }

  if (item.type === "display_assistant") {
    return (
      <article className="message assistant">
        <div className="assistant-name">Codex</div>
        <div className="assistant-text markdown">
          <MarkdownLite text={item.text} />
        </div>
      </article>
    );
  }

  if (item.type === "display_event") {
    return (
      <article className="message event">
        <CollapsibleBlock title={item.title} defaultOpen={Boolean(item.extractedText) && !isLongText(item.raw)}>
          {item.extractedText ? <p className="event-text">{item.extractedText}</p> : null}
          <pre>{JSON.stringify(item.event, null, 2)}</pre>
        </CollapsibleBlock>
      </article>
    );
  }

  if (item.type === "display_summary") {
    const hasUsefulGitStatus =
      item.gitStatus &&
      !item.gitStatus.includes("当前目录不是 Git 仓库") &&
      item.gitStatus !== "干净";
    const hasUsefulDiff =
      item.gitDiffStat &&
      item.gitDiffStat !== "无 Git diff。" &&
      item.gitDiffStat !== "没有已跟踪文件差异";
    const hasProblemExitCode = item.exitCode !== 0 && item.exitCode !== null;
    const shouldShowCompletion = hasProblemExitCode || hasUsefulGitStatus || hasUsefulDiff;

    if (!shouldShowCompletion) {
      return null;
    }

    return (
      <article className="message summary">
        <div className="label">执行结束 · 退出码 {item.exitCode ?? "未知"}</div>
        <div className="summary-grid">
          <div>
            <CollapsibleBlock title="git status" defaultOpen={!isLongText(item.gitStatus)}>
              <pre>{item.gitStatus || "干净"}</pre>
            </CollapsibleBlock>
          </div>
          <div>
            <CollapsibleBlock title="git diff --stat" defaultOpen={!isLongText(item.gitDiffStat)}>
              <pre>{item.gitDiffStat || "没有已跟踪文件差异"}</pre>
            </CollapsibleBlock>
          </div>
        </div>
      </article>
    );
  }

  if (item.type === "display_error") {
    return (
      <article className="message error">
        <div className="label">错误</div>
        <pre>{item.text}</pre>
      </article>
    );
  }

  if (item.type === "display_notice") {
    return (
      <article className="message notice">
        <div className="label">提示</div>
        <pre>{item.text}</pre>
      </article>
    );
  }

  if (item.type === "display_command_group") {
    return (
      <article className="message command">
        <CollapsibleBlock title={`命令记录 · ${item.commands.length} 条`} defaultOpen={false}>
          <div className="command-list">
            {item.commands.map((command, index) => (
              <div className="command-item" key={`${index}-${command}`}>
                <div className="command-index">#{index + 1}</div>
                <pre>{command}</pre>
              </div>
            ))}
          </div>
        </CollapsibleBlock>
      </article>
    );
  }

  return null;
}
