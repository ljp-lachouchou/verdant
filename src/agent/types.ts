import type { Message, LLMResponse, AgentConfig, CompactionResult, AgentEvent } from '@shared/types'

export interface PromptSegment {
  role: 'system' | 'developer' | 'user' | 'assistant' | 'tool'
  content: string
  toolCallId?: string
  reasoningContent?: string
  toolCalls?: Array<{
    id: string
    name: string
    args: Record<string, unknown>
  }>
}

export interface PromptManager {
  addUserMessage(content: string): Message
  addAssistantMessage(content: string, toolCalls?: Message['toolCalls'], reasoningContent?: string): Message
  addToolResult(toolCallId: string, toolName: string, output: string, isError: boolean): Message
  addSystemMessage(content: string): void
  addSteeringMessage(content: string): Message
  buildPrompt(): PromptSegment[]
  convertToLlm?(): PromptSegment[]
  getMessages(): Message[]
  getActiveMessages(): Message[]
  getContextTokenCount(): number
  getFilesRead?(): string[]
  getFilesModified?(): string[]
  trackFileAccess?(path: string, modified: boolean): void
  compact(summary: string): CompactionResult
  clear(): void
}

export interface LLMProvider {
  query(prompt: PromptSegment[], config: AgentConfig): Promise<LLMResponse>
  streamQuery(
    prompt: PromptSegment[],
    config: AgentConfig,
    onToken: (token: string) => void
  ): Promise<LLMResponse>
}

export type AgentEventHandler = (event: AgentEvent) => void

export interface ToolHookContext {
  toolName: string
  args: Record<string, unknown>
  sessionId: string
}

export interface BeforeToolCallResult {
  block?: boolean
  reason?: string
  modifiedArgs?: Record<string, unknown>
}

export interface AfterToolCallResult {
  modifiedOutput?: string
  isError?: boolean
  terminate?: boolean
}

export interface AgentLoopCallbacks {
  onEvent?: (event: AgentEvent) => void
  onToken?: (token: string) => void
  onTextChunk?: (text: string) => void
  onToolCall?: (name: string, args: Record<string, unknown>) => void
  onToolResult?: (name: string, output: string, isError: boolean) => void
  onComplete?: (text: string) => void
  onError?: (error: Error) => void
  onMessagePersist?: (message: Message) => void
  onCompaction?: (result: CompactionResult) => void
  beforeToolCall?: (ctx: ToolHookContext) => BeforeToolCallResult | void
  afterToolCall?: (ctx: ToolHookContext, output: string, isError: boolean) => AfterToolCallResult | void
  shouldStop?: () => boolean
  shouldStopAfterTurn?: () => boolean
  getSteeringMessages?: () => Message[]
}

export const DEFAULT_CONFIG: AgentConfig = {
  model: 'deepseek-v4-pro',
  systemPrompt: 'You are a helpful AI assistant running in a desktop environment.',
  maxIterations: 50,
  maxContextTokens: 128000,
  compactionThreshold: 100000,
  compactionKeepTokens: 30000,
  shellTimeout: 60000,
  maxOutputLength: 100000,
  apiBaseUrl: 'https://api.deepseek.com',
  apiKey: ''
}
