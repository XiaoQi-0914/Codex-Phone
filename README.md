# Codex Phone

手机聊天页控制这台电脑上的 Codex CLI。

第一版是 MVP：手机打开本机提供的网页，网页通过 WebSocket 把消息发给电脑端 worker，worker 调用 `codex exec --json`，再把 Codex 的 JSONL 事件流实时推回手机。

## 技术栈

- Node.js
- Express
- ws
- Vite
- React
- TypeScript
- Codex CLI
- SQLite

## 配置

默认配置在 `config.json`：

```json
{
  "codexCommand": "c:\\Users\\90511\\.vscode\\extensions\\openai.chatgpt-26.609.30741-win32-x64\\bin\\windows-x86_64\\codex.exe",
  "project": {
    "id": "codex-phone",
    "name": "Codex-Phone",
    "path": "C:\\Users\\90511\\Desktop\\Codex-Phone"
  },
  "server": {
    "host": "0.0.0.0",
    "port": 5179
  }
}
```

Windows 上如果页面报 `spawn codex ENOENT`，说明 Node 没找到 Codex 命令。可以把 `codexCommand` 改成绝对路径，例如：

```json
{
  "codexCommand": "c:\\Users\\90511\\.vscode\\extensions\\openai.chatgpt-26.609.30741-win32-x64\\bin\\windows-x86_64\\codex.exe"
}
```

第一版只支持一个固定项目。不要从手机端传任意项目路径。

会话和历史数据保存在：

```text
data/codex-phone.db
```

## 启动

安装依赖：

```powershell
npm install
```

启动：

```powershell
npm run dev
```

`npm run dev` 会启动一个本地 Node 服务，同时提供网页和 WebSocket。

电脑浏览器访问：

```text
http://localhost:5179
```

手机访问：

```text
http://你的电脑局域网IP:5179
```

查看电脑局域网 IP：

```powershell
ipconfig
```

通常找无线网卡或以太网卡里的 `IPv4 地址`。

如果手机打不开，优先检查：

- 手机和电脑是否在同一个局域网。
- Windows 防火墙是否拦截了 Node.js。
- `config.json` 里的 server.host 是否是 `0.0.0.0`。
- 端口 `5179` 是否被占用。

## 建议第一条测试消息

先发只读请求：

```text
请只检查这个项目结构，不要修改文件，然后用简短中文总结你看到了什么。
```

确认事件流能正常显示后，再试小改动。

## 当前行为

每个会话第一次消息执行：

```powershell
codex exec --json --skip-git-repo-check --sandbox <mode> -C <project_path> "<message>"
```

后端会监听 `thread.started.thread_id` 并保存到 SQLite。后续消息执行：

```powershell
codex exec resume <thread_id> --json --skip-git-repo-check -c sandbox_mode="<mode>" "<message>"
```

权限模式来自页面右侧下拉：

```text
只读 -> read-only
可改项目 -> workspace-write
完全访问 -> danger-full-access
危险全自动 -> dangerously-bypass-approvals-and-sandbox
```

每次 run 结束后，worker 会额外执行：

```powershell
git status --short
git diff --stat
```

只有存在真实状态、diff 或异常退出码时，摘要才会显示在手机页面里。

页面支持多个会话：

- 顶部 `会话` 按钮打开侧边栏
- 新会话
- 侧边栏切换会话
- 删除会话
- 刷新后恢复历史
- 每个会话绑定自己的 Codex `thread_id`

## MVP 限制

- 同一时间只允许一个 Codex run。
- 暂时只支持一个项目。
- Codex JSONL 事件半结构化展示，未知事件会显示原始 JSON。
- 还没有做登录、配对码、访问控制或公网中转。
- 还没有做完整终端镜像。
- 还没有做会话重命名或搜索。

## 下一步

- 增加项目白名单，支持多个项目。
- 增加手机端确认机制。
- 增加会话重命名、搜索。
