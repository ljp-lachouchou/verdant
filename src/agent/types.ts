import type { LLMResponse, AgentConfig } from '@shared/types'

export type PromptContent = string | Array<
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
>

export interface PromptSegment {
  role: 'system' | 'developer' | 'user' | 'assistant' | 'tool'
  content: PromptContent
  toolCallId?: string
  reasoningContent?: string
  toolCalls?: Array<{
    id: string
    name: string
    args: Record<string, unknown>
  }>
}

export interface LLMProvider {
  query(prompt: PromptSegment[], config: AgentConfig): Promise<LLMResponse>
  streamQuery(
    prompt: PromptSegment[],
    config: AgentConfig,
    onToken: (token: string) => void
  ): Promise<LLMResponse>
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
