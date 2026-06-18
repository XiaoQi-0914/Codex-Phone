# 多项目支持实施清单

## 本次改动目标

在不推翻当前单项目 MVP 架构的前提下，为 Codex Phone 增加最小可用的多项目支持。

## 本次准备做的改动

1. 配置层

- 支持 `config.json` 使用 `projects` 数组。
- 对旧版单项目 `project` 配置保持兼容。
- 在启动时把所有项目同步到数据库。

2. 服务端状态层

- 增加当前激活项目 `activeProjectId`。
- 为每个项目分别记录自己的 `activeSessionId`。
- 切换项目时加载该项目下最近会话，没有则自动新建。

3. 服务端协议层

- `hello` 消息返回项目列表和当前项目。
- 增加 `select_project` 客户端消息。
- 项目切换后返回新的会话列表、当前会话和消息列表。

4. 执行层

- Codex run 根据当前会话所属项目的路径执行。
- `git status` / `git diff --stat` 也按对应项目路径执行。

5. 前端

- 顶部增加项目切换下拉。
- 会话列表只显示当前项目的会话。
- 切项目后同步切换当前会话和消息。

6. 文档与验证

- 更新示例配置和 README。
- 跑构建和基础烟雾验证，直到通过。

## 2026-06-17 14:56 追加修复记录

这次开始修改前记录两类问题，避免打包和测试过程中切换上下文丢失。

1. VS Code 多窗口项目自动发现

- 当前问题：后端只读取 `config.json` 里的 `projects`，用户电脑上同时打开两个 VS Code 项目时，手机端只能看到配置里的一个。
- 改动方向：新增 VS Code 项目发现模块，读取 `%APPDATA%\Code\User\globalStorage\storage.json` 的 `windowsState.openedWindows` / `lastActiveWindow`。
- 合并规则：`config.json` 中手写项目优先；VS Code 当前窗口项目作为自动发现项目补充；按真实路径去重。
- 刷新时机：服务启动、手机页面连接、切换项目、新建/删除/选择会话前刷新一次项目列表。
- 目标效果：当前打开的 `Codex-Phone` 和 `SupersetAgent` 都能出现在项目下拉框里，不需要手动改配置或重启服务。

2. 托盘图标偏斜/裁切

- 当前问题：托盘直接把大尺寸 `icon.png` 缩成 18x18，容易看起来偏斜或被系统托盘裁切。
- 改动方向：构建时额外生成透明留白的 `build/tray-icon.png`，专门用于 Windows 托盘。
- 运行时改动：Electron 托盘入口改用 `tray-icon.png`，不再用安装图标硬缩放。
- 验证目标：`npm run build:icon` 能生成 `icon.svg`、`icon.png`、`icon.ico`、`tray-icon.png`，打包后托盘读取新图标。
