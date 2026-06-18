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
  "projects": [
    {
      "id": "codex-phone",
      "name": "Codex-Phone",
      "path": "C:\\Users\\90511\\Desktop\\Codex-Phone"
    }
  ],
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

支持多个项目时，可以继续把固定项目写在 `projects` 数组里。除此之外，后端会自动读取 VS Code 当前打开窗口，把正在打开的文件夹补到项目下拉框里。手写配置优先；如果 VS Code 里打开的是同一路径，不会重复显示。

当前版本对旧配置仍兼容。如果你的 `config.json` 里还是单个 `project` 字段，服务端会自动按单项目方式读取。

会话和历史数据保存在：

```text
data/codex-phone.db
```

## 启动

安装依赖：

```powershell
npm install
```

开发模式启动：

```powershell
npm run dev
```

`npm run dev` 会启动一个本地 Node 服务，同时提供网页和 WebSocket。

桌面托盘模式启动：

```powershell
npm run electron:dev
```

打包 Windows exe：

```powershell
npm run dist
```

`npm run dist` 每次都会输出到一个新的时间戳目录，避免旧版本正在运行时把打包目录锁住。例如：

```text
release\20260617-140530\
```

桌面托盘版行为：

- 启动后只在右下角托盘常驻，默认不打开本机前端窗口。
- 首次启动提示会显示本机 IP、端口和访问地址。
- 托盘图标使用单独生成的小尺寸透明留白图标，避免 Windows 托盘裁切。
- 托盘双击或菜单里的“打开访问页”会用默认浏览器打开 `http://你的电脑IP:5179`。
- 托盘菜单可复制访问地址、查看服务信息、打开数据目录、配置目录、安装目录，也能重启服务。
- 如果启动失败，会弹出可直接复制的错误窗口，并显示安装目录、配置目录、数据目录和完整日志。

打包后的路径规则：

```text
安装目录: 安装时可自定义，默认通常是 C:\Users\你的用户名\AppData\Local\Programs\codex-phone
配置文件: <安装目录>\resources\config.json
数据目录: C:\Users\你的用户名\AppData\Roaming\codex-phone\data
```

卸载与清理：

- 程序卸载：Windows 应用列表里卸载 `Codex Phone`，或者运行安装目录下的卸载程序。
- 配置文件不会跟随卸载自动删除，方便保留你的项目列表和命令路径。
- 如果你想彻底清理，再手动删掉安装目录和 `C:\Users\你的用户名\AppData\Roaming\codex-phone\`。

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

页面支持多个项目和多个会话：

- 侧边栏顶部切换项目
- 自动显示当前 VS Code 打开的文件夹项目
- 顶部 `会话` 按钮打开侧边栏
- 新会话
- 重命名当前会话
- 按标题搜索当前项目会话
- 侧边栏切换会话
- 删除会话
- 刷新后恢复历史
- 断线后自动重连并同步当前状态
- 运行超过 5 分钟时给出软提醒，不会自动杀进程
- 每个会话绑定自己的项目和 Codex `thread_id`

## MVP 限制

- 同一时间只允许一个 Codex run。
- Codex JSONL 事件半结构化展示，未知事件会显示原始 JSON。
- 还没有做登录、配对码、访问控制或公网中转。
- 还没有做完整终端镜像。
- 会话搜索目前只按当前项目的会话标题过滤，不做跨项目全文搜索。

## 下一步

- 增加手机端确认机制。
- 如果会话规模变大，再补跨项目全文搜索。
