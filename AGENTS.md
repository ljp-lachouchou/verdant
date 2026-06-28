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
- **Tools** (`src/tools/`): Shell, file, and PTY tool implementations
- **Storage** (`src/storage/`): SQLite persistence, sessions, messages, compaction
- **Renderer** (`src/renderer/`): React UI with Redux state management
- **Shared** (`src/shared/`): Type definitions shared across processes

## Key Design Decisions
- IPC communication between main and renderer via `contextBridge`
- SQLite (better-sqlite3) for persistence with WAL mode
- Tool registry pattern for extensibility
- Prompt manager handles token estimation and compaction
- Agent loop supports streaming tokens, tool calls, and error recovery

## Code Style
- TypeScript strict mode
- Path aliases: `@shared`, `@agent`, `@tools`, `@storage`, `@renderer`
- No comments in code unless explicitly requested
- Follow existing patterns in the codebase
