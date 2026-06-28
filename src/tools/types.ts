export interface ToolDefinition {
  name: string
  description: string
  parameters: ToolParameter[]
  executionMode?: 'parallel' | 'sequential'
}

export interface ToolParameter {
  name: string
  type: 'string' | 'number' | 'boolean' | 'array' | 'object'
  description: string
  required: boolean
  default?: unknown
}

export interface ToolResult {
  output: string
  isError: boolean
  terminate?: boolean
  metadata?: Record<string, unknown>
}

export type ToolUpdateCallback = (partialResult: { output?: string; metadata?: Record<string, unknown> }) => void

export interface Tool {
  definition: ToolDefinition
  execute(args: Record<string, unknown>, context: ToolContext, onUpdate?: ToolUpdateCallback): Promise<ToolResult>
}

export interface ToolContext {
  sessionId: string
  workingDirectory: string
  timeout: number
  maxOutputLength: number
  signal?: AbortSignal
}

export type ToolRegistry = Map<string, Tool>
