# Verdant — AI Desktop Assistant

A multi-agent desktop AI assistant built with Electron + React, powered by a Harness architecture that lets the model autonomously decide when to delegate, parallelize, and interact with the user.

## Features

### Harness Architecture
- Model autonomously decides when to delegate — no preset workflow constraints
- Two-phase context pipeline: `buildPrompt()` → `convertToLlm()` (filters non-LLM messages)
- Steering + follow-up dual queue for mid-task user injection
- Parallel tool execution with sequential override (`executionMode: 'sequential'`)
- `shouldStopAfterTurn` for graceful termination without aborting running tools

### Multi-Agent Collaboration
- `task` tool: dynamically delegate sub-tasks to sub-agents that run in parallel
- Each sub-agent has its own `AgentLoop` with full tool access (no recursion)
- Sub-agent results flow back to the parent agent for synthesis
- Inspired by Pi Agent's loop design: tool exceptions, in-place streaming mutation, turn-boundary writes

### Browser Automation
- Built-in Playwright browser tool with 10 actions: navigate, click, type, fill_form, screenshot, extract, scroll, wait, evaluate, close
- Persistent browser session across multiple tool calls
- Anti-detection: custom user agent, disabled automation flags
- `ask_user` tool: pause execution and wait for user confirmation (login, captcha, decisions)

### Vibe Coding Integration
- Configure external CLI coding tools (Claude Code, Aider, Cursor CLI, Codex CLI)
- One-click presets in Settings
- Agent delegates coding tasks to the configured CLI tool automatically

### Context Management
- Token-budget-aware automatic compaction with folding summary
- Soft-delete with `is_compacted` flag (recoverable)
- File access tracking (read/modified) attached to compaction summaries
- Atomic per-message persistence to SQLite (crash-safe)

### UI / UX
- ContentBlock model: text, tool calls, and images rendered inline in a single message
- Streaming indicator at the bottom of agent output
- Right-side status panel with sub-agent monitoring (clickable detail popup with input/output)
- Coding pet: SVG state machine with 6 moods (idle, thinking, working, happy, sad, sleeping)
- Emerald dark theme with glassmorphic sidebar
- Session isolation: streaming events filtered by sessionId + requestId

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop | Electron 31 + electron-vite |
| Frontend | React 18 + Redux Toolkit |
| Backend | Node.js + TypeScript (strict) |
| LLM | DeepSeek API (OpenAI-compatible) |
| Storage | SQLite (better-sqlite3, WAL mode) |
| Browser | Playwright |
| Testing | Jest + Testing Library (53 tests) |

## Tools

| Tool | Description |
|------|-------------|
| `bash` | Cross-platform shell command execution |
| `read` / `write` / `edit` / `ls` | File system operations |
| `browser` | Playwright browser automation (10 actions) |
| `task` | Delegate sub-tasks to parallel sub-agents |
| `ask_user` | Pause and wait for user confirmation |
| `vibe_coding` | Delegate to external CLI coding tool (optional) |

## Getting Started

```bash
# Install dependencies
npm install

# Rebuild native modules for Electron
npx electron-rebuild -f -w better-sqlite3,node-pty

# Configure API key
cp .env.example .env
# Edit .env and add your DEEPSEEK_API_KEY

# Start development
npm run dev

# Build for production
npm run build

# Package for current platform
npm run package
```

## Configuration

### API Key
Set in `.env` file or via Settings panel:
```
DEEPSEEK_API_KEY=your_api_key_here
```

### Vibe Coding (Optional)
Open Settings → Vibe Coding → Enable → Select a preset (Claude Code / Aider / Cursor / Codex / Custom).

### Browser Tool
Playwright browsers are auto-installed. The browser tool launches a visible Chromium window.

## Project Structure

```
src/
├── main/          # Electron main process, IPC handlers, DB init
├── preload/       # Secure IPC bridge (contextBridge)
├── agent/         # AgentLoop, PromptManager, LLMProvider, DAG, TaskPlanner
├── tools/         # Shell, File, Browser, Task, AskUser, VibeCoding tools
├── storage/       # SQLite, Sessions, Messages, Compaction
├── renderer/      # React UI, Redux store, StatusPanel, CodingPet
└── shared/        # Cross-process type definitions
```

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                    Electron App                       │
│  ┌──────────┐  ┌─────────────┐  ┌────────────────┐  │
│  │ Sidebar  │  │  Chat Main  │  │  Status Panel  │  │
│  │ Sessions │  │  Messages   │  │  Sub-Agents    │  │
│  │ Settings │  │  + Tools    │  │  Coding Pet    │  │
│  │          │  │  + Images   │  │                │  │
│  └──────────┘  └──────┬──────┘  └────────────────┘  │
│                       │ IPC                          │
│  ┌────────────────────▼──────────────────────────┐  │
│  │              Main Process                     │  │
│  │  ┌──────────┐  ┌──────────┐  ┌────────────┐  │  │
│  │  │AgentLoop │  │ Tool Reg │  │  SQLite    │  │  │
│  │  │ + LLM    │  │ + Task   │  │  + Compact │  │  │
│  │  └──────────┘  └──────────┘  └────────────┘  │  │
│  └───────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

## Development

```bash
# Type checking
npm run typecheck

# Linting
npm run lint

# Tests
npm test

# E2E tests
npm run test:e2e
```

## License

MIT
