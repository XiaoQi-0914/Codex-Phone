# Codex Phone Chat Plan

## 目标

做一个手机聊天入口，让手机可以控制这台电脑上已经可用的 Codex CLI，在指定项目目录里完成读代码、改代码、跑命令、返回结果等工作。

手机端不登录 Codex，也不持有 OpenAI 账号或密钥。账号、权限、项目文件和实际执行都留在电脑上。

## 推荐方案

第一版采用聊天模式，而不是终端镜像模式。

```text
手机聊天页
  -> WebSocket
电脑本地 worker
  -> codex exec --json
  -> 项目文件 / git / shell
  -> JSONL 事件流
电脑本地 worker
  -> WebSocket
手机聊天页
```

核心命令：

```powershell
codex exec --json -C C:\Users\90511\Desktop\Codex-Phone "用户消息"
```

连续对话先用：

```powershell
codex exec resume --last --json "下一条用户消息"
```

后续如果能稳定从 JSONL 事件里拿到 Codex session id，就改成：

```powershell
codex exec resume <session_id> --json "下一条用户消息"
```

## 为什么不用交互式终端模式作为第一版

交互式终端模式是可行的：

```powershell
codex -C C:\Users\90511\Desktop\Codex-Phone
```

然后通过 PTY / ConPTY / xterm.js 把终端搬到手机上。

但它更像手机远程终端，问题包括：

- 手机输入本质是给终端敲字，不是发送结构化聊天消息。
- Codex 当前是否空闲、是否在等待确认，不容易稳定判断。
- TUI 画面、快捷键、滚动和断线重连体验较难做好。
- 后续要做命令卡片、diff 卡片、确认按钮会比较别扭。

所以第一版优先做 `codex exec --json`。它虽然每条消息会启动一次 CLI 执行，但可以通过 `resume` 保持上下文，手机体验更像现在的聊天弹窗。

## 第一版 MVP 范围

只支持一个固定项目：

```text
C:\Users\90511\Desktop\Codex-Phone
```

第一版功能：

- 手机打开网页聊天页。
- 手机发送一条消息。
- 电脑 worker 收到消息后调用 `codex exec --json`。
- worker 实时读取 stdout 中的 JSONL 事件。
- 手机端实时显示 Codex 输出。
- 执行结束后显示最终回复。
- 后续消息通过 `codex exec resume --last --json` 继续上下文。
- 每次执行结束后自动展示 `git status --short` 和 `git diff --stat`。
- 同一时间只允许一个 Codex run 执行。

暂不做：

- 多项目。
- 多电脑。
- 多用户。
- 复杂权限系统。
- 完整终端镜像。
- 文件浏览器。
- 一键回滚。

这些等 MVP 跑通后再加。

## 电脑端 Worker 职责

worker 是整套方案的核心守门层。

职责：

- 常驻运行在电脑上。
- 持有项目白名单，第一版先写死一个项目路径。
- 接收手机端消息。
- 判断当前是否已有 run 正在执行。
- 启动 Codex CLI 子进程。
- 逐行读取 `--json` 输出。
- 解析 JSONL event。
- 把 event 转发给手机。
- 记录当前会话状态。
- 执行完成后跑 git 摘要命令。
- 把完成、失败、退出码和 diff 摘要回传给手机。

伪流程：

```text
on user_message:
  if status == running:
    reject message

  status = running

  if no current session:
    spawn codex exec --json -C <project_path> <message>
  else:
    spawn codex exec resume --last --json <message>

  for each stdout line:
    parse as JSON
    send event to phone

  on process exit:
    run git status --short
    run git diff --stat
    send summary to phone
    status = idle
```

## 手机端 UI

第一版保持简单：

```text
顶部：项目名 / 当前状态
中间：消息列表
底部：输入框 / 发送按钮
```

消息类型：

- 用户消息。
- Codex 事件。
- Codex 最终回复。
- 命令执行卡片。
- 命令输出卡片。
- 错误卡片。
- 修改摘要卡片。

第一版可以先半结构化展示事件。也就是说，能识别的 event 做成卡片，暂时不认识的 event 先折叠显示原始 JSON。

## 状态模型

第一版只需要很小的状态机：

```text
idle
  -> running
  -> idle

running
  -> error
  -> idle
```

规则：

- `idle` 时允许发送消息。
- `running` 时禁用发送按钮，或者提示当前任务仍在执行。
- `error` 时显示错误，并允许用户继续发送下一条消息。

## 会话策略

MVP 阶段：

- 新对话使用 `codex exec --json -C <project> "<message>"`。
- 后续对话使用 `codex exec resume --last --json "<message>"`。

MVP 跑通后升级：

- 从 Codex JSONL event 或本地 session 记录里拿到真实 session id。
- 每个手机聊天线程绑定一个 `codex_session_id`。
- 后续执行使用 `codex exec resume <session_id> --json`。

原因：

- `resume --last` 实现简单，适合先验证可行性。
- 但多项目、多线程时 `--last` 容易串线，必须升级成显式 session id。

## 安全边界

第一版也要保留基础安全边界：

- 项目路径由 worker 写死，不接受手机端传任意路径。
- 不默认使用 `danger-full-access`。
- 同一时间只运行一个 Codex 子进程。
- 执行结束后展示 git 摘要，让用户知道改了什么。
- worker 不把 OpenAI token、Codex 登录态或本机敏感路径发给手机。
- 手机端只发自然语言消息，不直接发 shell 命令给 worker 执行。

建议默认使用：

```powershell
codex exec --json -C <project_path> "<message>"
```

不要在第一版默认加入：

```powershell
--dangerously-bypass-approvals-and-sandbox
```

## 可行性验证步骤

落代码前可以先手动验证两条命令。

验证一次性执行：

```powershell
codex exec --json -C C:\Users\90511\Desktop\Codex-Phone "请只检查项目结构，不要修改文件"
```

验证连续对话：

```powershell
codex exec resume --last --json "继续，用一句话总结刚才看到的项目结构"
```

如果这两条稳定工作，说明手机聊天 App 方案的核心链路成立。

## 建议开发顺序

1. 写电脑端 worker，先从命令行读取一条消息，调用 `codex exec --json` 并打印事件。
2. 加 WebSocket，让网页能把消息发给 worker。
3. 做一个手机可用的网页聊天 UI。
4. 加 `resume --last`，实现连续对话。
5. 加 `git status --short` 和 `git diff --stat` 摘要。
6. 把事件渲染成更清晰的聊天卡片。
7. 验证 session id 获取方式，替换掉 `resume --last`。
8. 再考虑多项目。

## 后续多项目设计

MVP 跑通后，多项目可以这样扩展：

```text
Project = 一个允许操作的本地目录
Chat = 一个项目内的聊天线程
Run = 一条用户消息触发的一次 Codex CLI 执行
Event = Run 过程中回传的一条 JSONL 事件
```

worker 本地保存项目白名单：

```json
[
  {
    "id": "codex-phone",
    "name": "Codex-Phone",
    "path": "C:\\Users\\90511\\Desktop\\Codex-Phone"
  }
]
```

手机端只能选择白名单里的项目，不能传任意路径。

多项目时必须使用显式 `codex_session_id`，不要继续依赖 `resume --last`。

## 最终判断

这个方案可行，而且是当前约束下最适合先试的路线：

- 不需要手机登录 Codex。
- 不需要移动端接管 VSCode 插件。
- 不需要完整远程桌面。
- 利用电脑上现成可用的 Codex CLI。
- 手机端可以做成真正的聊天体验。
- 后续能自然扩展到多项目和更精细的权限控制。
