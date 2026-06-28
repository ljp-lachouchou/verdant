# Codex Agent Architecture

## Overview

A Codex-style desktop AI agent built with Electron, React, and the Pi framework.
The application implements a full agent loop (perception → planning → action → memory)
with cross-platform shell integration, SQLite persistence, and streaming markdown UI.

## System Architecture

```
┌─────────────────────────────────────────────┐
│                  Electron App                │
│  ┌─────────────┐    ┌─────────────────────┐ │
│  │  Main Process │    │   Renderer Process   │ │
│  │              │    │                     │ │
│  │  ┌─────────┐ │    │  ┌───────────────┐  │ │
│  │  │ Agent   │ │◄──►│  │   React UI     │  │ │
│  │  │ Loop    │ │IPC │  │  (Streamdown)  │  │ │
│  │  └────┬────┘ │    │  └───────────────┘  │ │
│  │       │      │    │                     │ │
│  │  ┌────▼────┐ │    │  ┌───────────────┐  │ │
│  │  │ Tools   │ │    │  │  Redux Store   │  │ │
│  │  │ Registry│ │    │  └───────────────┘  │ │
│  │  └────┬────┘ │    │                     │ │
│  │       │      │    └─────────────────────┘ │
│  │  ┌────▼────┐ │                           │
│  │  │ SQLite  │ │                           │
│  │  │ Storage │ │                           │ │
│  │  └─────────┘ │                           │ │
│  └─────────────┘                           │ │
└─────────────────────────────────────────────┘
```

## Agent Loop

The agent loop follows the perception-planning-action-memory cycle:

1. **Perception**: User input is added to the prompt manager
2. **Planning**: LLM is queried with the full prompt context
3. **Action**: If the LLM requests a tool call, execute it
4. **Memory**: Results are stored in SQLite and context is managed

The loop continues until the LLM produces a final response or max iterations is reached.

### Compaction

When context exceeds the threshold (default: 100K tokens), older messages are
summarized via an LLM call and replaced with a summary message.

## Tool System

Tools are registered in a central registry. Each tool implements:
- `definition`: Name, description, parameters
- `execute(args, context)`: Returns `ToolResult`

Built-in tools:
- `bash`: Cross-platform shell execution with safety filters
- `pty`: Interactive pseudo-terminal (via node-pty)
- `read`/`write`/`edit`/`ls`: File system operations

### Security

- Blocked dangerous commands (rm -rf /, mkfs, shutdown, etc.)
- Output truncation to prevent memory exhaustion
- Configurable timeouts per command
- No elevated privileges

## Storage

SQLite with WAL mode for concurrent read/write. Tables:
- `sessions`: Conversation sessions with branching support
- `messages`: All messages with tool call metadata
- `prompt_templates`: Reusable prompt fragments
- `app_metadata`: Key-value app configuration

## IPC Communication

The main process and renderer communicate via secure IPC:
- `agent:send` / `agent:stream`: Send messages and receive streaming responses
- `session:list/create/delete/load`: Session management
- `config:get/set`: Configuration management

All communication goes through `contextBridge` for security isolation.

## UI

React 18 with Redux Toolkit for state management. Streamdown for streaming
markdown rendering with code highlighting and mermaid support.

## Cross-Platform Support

- macOS: bash, hidden inset title bar
- Windows: cmd.exe / PowerShell, native title bar
- Linux: bash, standard title bar

## Testing

- Unit tests: Jest + ts-jest
- E2E tests: Playwright
- Test coverage: Agent loop, tools, storage, prompt manager
