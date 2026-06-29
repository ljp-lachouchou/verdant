# Verdant — AI 桌面助手

基于 Electron + React 构建的多智能体桌面 AI 助手，采用 Harness 架构让模型自主决策何时委派、并行和与用户交互。

## 核心特性

### Harness 架构
- 模型自主决策何时委派 — 不预设工作流约束
- 两阶段上下文管道：`buildPrompt()` → `convertToLlm()`（过滤非 LLM 消息）
- Steering + Follow-up 双队列，支持任务中途用户注入
- 并行工具执行，支持 `executionMode: 'sequential'` 强制串行
- `shouldStopAfterTurn` 优雅终止，不中断正在运行的工具

### 多智能体协作
- `task` tool：动态委派子任务给子智能体并行执行
- 每个子智能体拥有独立 `AgentLoop`，具备完整工具访问（禁止递归）
- 子智能体结果返回父智能体进行综合
- 借鉴 Pi Agent 循环设计：工具异常抛出、流式原位突变、轮次边界刷新

### 浏览器自动化
- 内置 Playwright 浏览器工具，支持 10 种操作：导航、点击、输入、填表、截图、提取、滚动、等待、执行 JS、关闭
- 浏览器会话跨多次工具调用持久化
- 反检测：自定义 User-Agent、禁用自动化标志
- `ask_user` tool：暂停执行等待用户确认（登录、验证码、决策）

### Vibe Coding 集成
- 可配置外部 CLI 编程工具（Claude Code / Aider / Cursor CLI / Codex CLI）
- 设置面板一键选择预设
- Agent 自动将编程任务委派给配置的 CLI 工具

### 上下文管理
- Token 预算感知的自动压缩，分块折叠摘要
- 软删除标记 `is_compacted`，可恢复
- 文件访问追踪（读取/修改）附加到压缩摘要
- 原子化逐条消息持久化到 SQLite，崩溃安全

### UI / UX
- ContentBlock 模型：文本、工具调用、图片在一条消息内按序渲染
- Agent 输出底部流式指示器
- 右侧状态面板，子智能体实时监控（可点击查看输入/输出详情）
- 编程宠物：SVG 状态机，6 种心情（idle/thinking/working/happy/sad/sleeping）
- 翡翠绿暗色主题，玻璃态侧边栏
- 会话隔离：流式事件按 sessionId + requestId 过滤

## 技术栈

| 层 | 技术 |
|---|------|
| 桌面框架 | Electron 31 + electron-vite |
| 前端 | React 18 + Redux Toolkit |
| 后端 | Node.js + TypeScript (strict) |
| LLM | DeepSeek API（OpenAI 兼容）|
| 持久化 | SQLite (better-sqlite3, WAL 模式) |
| 浏览器 | Playwright |
| 测试 | Jest + Testing Library（53 个测试）|

## 工具系统

| 工具 | 说明 |
|------|------|
| `bash` | 跨平台 Shell 命令执行 |
| `read` / `write` / `edit` / `ls` | 文件系统操作 |
| `browser` | Playwright 浏览器自动化（10 种操作）|
| `task` | 委派子任务给并行子智能体 |
| `ask_user` | 暂停等待用户确认 |
| `vibe_coding` | 委派外部 CLI 编程工具（可选）|

## 快速开始

### 下载预编译版本

从 [GitHub Releases](https://github.com/ljp-lachouchou/verdant/releases/latest) 下载最新版本。

**安装提示：**

| 平台 | 文件 | 说明 |
|------|------|------|
| macOS | `.dmg` | 如提示"已损坏"，终端运行：`xattr -cr /Applications/Verdant.app` |
| Windows | `.exe` | SmartScreen 警告时点"更多信息" → "仍要运行" |
| Linux | `.AppImage` | 运行 `chmod +x Verdant-*.AppImage && ./Verdant-*.AppImage` |

### 从源码构建

```bash
# 安装依赖
npm install

# 为 Electron 重新编译原生模块
npx electron-rebuild -f -w better-sqlite3,node-pty

# 配置 API Key
cp .env.example .env
# 编辑 .env，填入 DEEPSEEK_API_KEY

# 开发模式
npm run dev

# 生产构建
npm run build

# 打包当前平台
npm run package
```

## 配置

### API Key
在 `.env` 文件或设置面板中配置：
```
DEEPSEEK_API_KEY=your_api_key_here
```

### Vibe Coding（可选）
打开设置 → Vibe Coding → 开启 → 选择预设（Claude Code / Aider / Cursor / Codex / 自定义）。

### 浏览器工具
Playwright 浏览器会自动安装。浏览器工具会启动可见的 Chromium 窗口。

## 项目结构

```
src/
├── main/          # Electron 主进程, IPC 处理, 数据库初始化
├── preload/       # 安全 IPC 桥接 (contextBridge)
├── agent/         # AgentLoop, PromptManager, LLMProvider, DAG, TaskPlanner
├── tools/         # Shell, File, Browser, Task, AskUser, VibeCoding 工具
├── storage/       # SQLite, Sessions, Messages, Compaction
├── renderer/      # React UI, Redux store, StatusPanel, CodingPet
└── shared/        # 跨进程类型定义
```

## 架构图

```
┌──────────────────────────────────────────────────────┐
│                    Electron 应用                      │
│  ┌──────────┐  ┌─────────────┐  ┌────────────────┐  │
│  │  侧边栏   │  │  聊天主区   │  │   状态面板     │  │
│  │ 会话列表  │  │  消息+工具  │  │  子智能体监控  │  │
│  │ 设置      │  │  +图片      │  │  编程宠物      │  │
│  └──────────┘  └──────┬──────┘  └────────────────┘  │
│                       │ IPC                          │
│  ┌────────────────────▼──────────────────────────┐  │
│  │                   主进程                       │  │
│  │  ┌──────────┐  ┌──────────┐  ┌────────────┐  │  │
│  │  │AgentLoop │  │ 工具注册 │  │  SQLite    │  │  │
│  │  │ + LLM    │  │ + Task   │  │  + 压缩    │  │  │
│  │  └──────────┘  └──────────┘  └────────────┘  │  │
│  └───────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

## 开发

```bash
# 类型检查
npm run typecheck

# 代码检查
npm run lint

# 单元测试
npm test

# E2E 测试
npm run test:e2e
```

## 许可证

MIT

---

## English Summary

Verdant is a multi-agent desktop AI assistant built with Electron and React. It uses a Harness architecture where the model autonomously decides when to delegate tasks to parallel sub-agents, control a web browser via Playwright, pause for user confirmation, or invoke external CLI coding tools. The system features token-aware context compaction with soft-delete recovery, atomic SQLite persistence, and a polished emerald-themed UI with a coding pet companion, streaming markdown rendering, and real-time sub-agent monitoring. It integrates patterns from Pi Agent (two-phase context pipeline, steering queues, parallel tool execution) and supports DeepSeek's OpenAI-compatible API out of the box.
