export type MessageRole = 'system' | 'user' | 'assistant' | 'tool'

export type MessageType = 'text' | 'tool_use' | 'tool_result' | 'summary' | 'steering' | 'notification'

export type ContentBlockType = 'text' | 'tool_call' | 'image'

export interface ContentBlock {
  type: ContentBlockType
  text?: string
  toolName?: string
  command?: string
  output?: string
  status?: 'pending' | 'running' | 'success' | 'error'
  imagePath?: string
  imageAlt?: string
}

export interface Message {
  id: string
  sessionId: string
  role: MessageRole
  messageType: MessageType
  content: string
  timestamp: number
  toolCalls?: ToolCall[]
  blocks?: ContentBlock[]
  isSummary?: boolean
  isCompacted?: boolean
  parentMessageId?: string
  tokenCount?: number
  reasoningContent?: string
  llmVisible?: boolean
  metadata?: Record<string, unknown>
}

export interface ToolCall {
  id: string
  toolName: string
  args: Record<string, unknown>
  output?: string
  status: 'pending' | 'running' | 'success' | 'error'
  error?: string
  timestamp: number
}

export interface Session {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  parentId?: string
  metadata?: Record<string, unknown>
}

export interface LLMResponse {
  text: string
  reasoningContent?: string
  toolCalls?: Array<{
    id: string
    name: string
    args: Record<string, unknown>
  }>
  done: boolean
  stopReason?: 'stop' | 'tool_use' | 'length' | 'error'
  usage?: {
    promptTokens: number
    completionTokens: number
  }
}

export interface AgentConfig {
  model: string
  systemPrompt: string
  maxIterations: number
  maxContextTokens: number
  compactionThreshold: number
  compactionKeepTokens: number
  shellTimeout: number
  maxOutputLength: number
  apiBaseUrl: string
  apiKey: string
  vibeCoding?: VibeCodingConfig
}

export interface VibeCodingConfig {
  enabled: boolean
  cliPath: string
  argsTemplate: string
  workingDir: string
  timeout: number
}

export const DEFAULT_VIBE_CODING_CONFIG: VibeCodingConfig = {
  enabled: false,
  cliPath: '',
  argsTemplate: '{prompt}',
  workingDir: '',
  timeout: 120000
}

export interface CompactionResult {
  summary: string
  compactedCount: number
  tokensBefore: number
  tokensAfter: number
  summaryMessageId: string
  filesRead: string[]
  filesModified: string[]
}

export interface IPCChannel {
  AGENT_SEND: 'agent:send'
  AGENT_STREAM: 'agent:stream'
  AGENT_STOP: 'agent:stop'
  AGENT_STEER: 'agent:steer'
  SESSION_LIST: 'session:list'
  SESSION_CREATE: 'session:create'
  SESSION_DELETE: 'session:delete'
  SESSION_LOAD: 'session:load'
  TOOL_RESULT: 'tool:result'
  CONFIG_GET: 'config:get'
  CONFIG_SET: 'config:set'
}

export type IPCChannels = IPCChannel[keyof IPCChannel]

export type AgentEventType =
  | 'agent_start'
  | 'agent_end'
  | 'turn_start'
  | 'turn_end'
  | 'message_start'
  | 'message_update'
  | 'message_end'
  | 'tool_start'
  | 'tool_update'
  | 'tool_end'
  | 'token'
  | 'text_chunk'
  | 'tool_call'
  | 'tool_result'
  | 'complete'
  | 'error'
  | 'compaction'
  | 'config_required'
  | 'wait_user'
  | 'plan_created'
  | 'subagent_register'
  | 'subagent_update'
  | 'subagent_complete'

export interface AgentEvent {
  type: AgentEventType
  sessionId?: string
  token?: string
  text?: string
  name?: string
  args?: Record<string, unknown>
  output?: string
  isError?: boolean
  message?: string
  toolCallId?: string
  turn?: number
  result?: CompactionResult
  subAgentId?: string
  subAgentName?: string
  subAgentTask?: string
  subAgentStatus?: 'idle' | 'running' | 'success' | 'error'
  subAgentResult?: string
  planSteps?: Array<{ id: string; name: string; description: string; dependencies: string[] }>
  imageBase64?: string
}

export type AgentStreamEvent = AgentEvent

export interface PlanStep {
  id: string
  name: string
  description: string
  dependencies: string[]
  prompt: string
}

export interface TaskPlan {
  steps: PlanStep[]
  requiresSynthesis: boolean
}
