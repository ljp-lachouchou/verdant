# AGENTS.md

## Build & Dev Commands
- `npm run dev` - Start Electron dev mode with hot reload
- `npm run build` - Build all (main + preload + renderer)
- `npm run typecheck` - Run TypeScript type checking (node + web)
- `npm run lint` - Run ESLint
- `npm test` - Run Jest unit tests
- `npm run test:e2e` - Run Playwright E2E tests
- `npm run package` - Build and package for current platform

## Architecture
- **Main process** (`src/main/`): Electron entry, IPC handlers, database init
- **Preload** (`src/preload/`): Secure bridge between main and renderer
- **Agent core** (`src/agent/`): Agent loop, prompt manager, LLM provider interface
- **Tools** (`src/tools/`): Shell, file, browser, task, skill, ask_user, vibe_coding
- **Storage** (`src/storage/`): SQLite persistence, sessions, messages, compaction
- **Renderer** (`src/renderer/`): React UI with Redux state management
- **Shared** (`src/shared/`): Type definitions shared across processes

## Harness Architecture (Core Principle)
Verdant is a **Harness** application. The harness provides capabilities (tools, memory, persistence, UI) without constraining the model's workflow. The model autonomously decides:
- Whether to delegate to sub-agents or do work itself
- Whether to load a skill before proceeding
- How to decompose tasks (or not)
- When to ask the user for input

All system prompt changes, tool additions, and architectural decisions must align with this principle: **the harness empowers the model, never restricts it**. The model should never be forced into a specific workflow pattern — it should naturally choose the best approach based on the task.

### What this means in practice:
- No forced "plan mode" or "build mode" — the model decides
- No hardcoded rules like "always delegate" or "never delegate" — the model decides
- Skills are available but not mandatory — the model decides
- Sub-agents are available but not mandatory — the model decides
- The system prompt guides and suggests, but the model has final say

## Key Design Decisions
- IPC communication between main and renderer via `contextBridge`
- SQLite (better-sqlite3) for persistence with WAL mode
- Tool registry pattern for extensibility
- Prompt manager handles token estimation and compaction
- Agent loop supports streaming tokens, tool calls, and error recovery
- Two-phase context pipeline: buildPrompt() → convertToLlm()
- Sub-agents have full tool access (including skills) except task (no recursion)
- Blocks persisted to DB metadata for session restoration

## Code Style
- TypeScript strict mode
- Path aliases: `@shared`, `@agent`, `@tools`, `@storage`, `@renderer`
- No comments in code unless explicitly requested
- Follow existing patterns in the codebase
