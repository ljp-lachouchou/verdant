import type { Tool, ToolResult, ToolContext, ToolUpdateCallback } from './types'
import type { AgentConfig, AgentEvent } from '@shared/types'
import type { LLMProvider, AgentLoopCallbacks } from '@agent/types'
import { AgentLoop } from '@agent/loop'
import { randomUUID } from 'crypto'

const SUBAGENT_PROMPT = `You are a specialized sub-agent. You have been assigned a specific task by the parent agent.
Focus exclusively on your assigned task. Use available tools (bash, read, write, edit, ls) to complete it.
Provide a clear, complete result at the end.
Write any intermediate files to /tmp/ only.`

export interface TaskToolConfig {
  llmProvider: LLMProvider
  baseConfig: AgentConfig
  toolFactory: () => Map<string, Tool>
  parentCallbacks: AgentLoopCallbacks
  parentSessionId: string
}

export class TaskTool implements Tool {
  definition = {
    name: 'task',
    description: 'Delegate a sub-task to a sub-agent. The sub-agent runs its own agent loop with full tool access. Use this to parallelize work or delegate complex sub-tasks. The sub-agent cannot call task tool (no infinite recursion).',
    parameters: [
      {
        name: 'description',
        type: 'string' as const,
        description: 'A short 3-5 word description of the task',
        required: true
      },
      {
        name: 'prompt',
        type: 'string' as const,
        description: 'Detailed instructions for the sub-agent. Must be self-contained.',
        required: true
      },
      {
        name: 'agent_type',
        type: 'string' as const,
        description: 'Type of sub-agent: "general" (full tools, default) or "explore" (read-only, for research/exploration)',
        required: false,
        default: 'general'
      }
    ]
  }

  private config: TaskToolConfig
  private activeSubAgents: Map<string, AgentLoop> = new Map()

  constructor(config: TaskToolConfig) {
    this.config = config
  }

  async execute(args: Record<string, unknown>, context: ToolContext, onUpdate?: ToolUpdateCallback): Promise<ToolResult> {
    const description = args.description as string
    const prompt = args.prompt as string
    const agentType = (args.agent_type as string) || 'general'

    if (!prompt) {
      return { output: 'Error: prompt is required for task tool', isError: true }
    }

    const subAgentId = `subagent_${randomUUID().slice(0, 8)}`
    console.log(`[TaskTool] delegating to sub-agent ${subAgentId}: ${description}`)

    // Emit register event
    this.emitEvent({
      type: 'subagent_register',
      sessionId: this.config.parentSessionId,
      subAgentId,
      subAgentName: description,
      subAgentTask: prompt,
      subAgentStatus: 'running'
    })

    onUpdate?.({ output: `Sub-agent "${description}" started...` })

    // Build sub-agent config
    const subConfig: AgentConfig = {
      ...this.config.baseConfig,
      systemPrompt: SUBAGENT_PROMPT,
      maxIterations: Math.min(this.config.baseConfig.maxIterations, 25),
    }

    // Build tool registry — exclude task tool (no recursion)
    const tools = this.config.toolFactory()
    if (agentType === 'explore') {
      // Read-only: only keep read, ls, grep, bash
      const readOnly = new Map()
      for (const [name, tool] of tools) {
        if (['read', 'ls', 'bash', 'grep', 'glob'].includes(name)) {
          readOnly.set(name, tool)
        }
      }
      tools.clear()
      for (const [name, tool] of readOnly) {
        tools.set(name, tool)
      }
    }

    // Build callbacks — forward tool events, suppress token streaming
    const subCallbacks: AgentLoopCallbacks = {
      onToken: undefined,  // don't stream sub-agent tokens to UI
      onTextChunk: undefined,
      onToolCall: (name, toolArgs) => {
        this.config.parentCallbacks.onToolCall?.(name, toolArgs)
      },
      onToolResult: (name, output, isError) => {
        this.config.parentCallbacks.onToolResult?.(name, output, isError)
      },
      onComplete: (_text) => { },
      onError: (error) => {
        console.error(`[TaskTool] sub-agent ${subAgentId} error: ${error.message}`)
      },
      onMessagePersist: (msg) => {
        this.config.parentCallbacks.onMessagePersist?.({
          ...msg,
          metadata: { ...msg.metadata, subAgentId, subAgentName: description }
        })
      },
      shouldStop: () => this.config.parentCallbacks.shouldStop?.() ?? false
    }

    const loop = new AgentLoop(
      `${this.config.parentSessionId}_${subAgentId}`,
      this.config.llmProvider,
      tools,
      subConfig,
      subCallbacks
    )

    this.activeSubAgents.set(subAgentId, loop)

    try {
      const result = await loop.run(prompt)

      this.emitEvent({
        type: 'subagent_complete',
        sessionId: this.config.parentSessionId,
        subAgentId,
        subAgentName: description,
        subAgentStatus: 'success',
        subAgentResult: result
      })

      console.log(`[TaskTool] sub-agent ${subAgentId} completed: ${result.substring(0, 100)}...`)

      return {
        output: result,
        isError: false,
        metadata: { subAgentId, description }
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)

      this.emitEvent({
        type: 'subagent_update',
        sessionId: this.config.parentSessionId,
        subAgentId,
        subAgentStatus: 'error'
      })

      return {
        output: `Sub-agent "${description}" failed: ${errorMsg}`,
        isError: true,
        metadata: { subAgentId, error: errorMsg }
      }
    } finally {
      this.activeSubAgents.delete(subAgentId)
    }
  }

  stopAll(): void {
    for (const loop of this.activeSubAgents.values()) {
      loop.stop()
    }
    this.activeSubAgents.clear()
  }

  private emitEvent(event: AgentEvent): void {
    this.config.parentCallbacks.onEvent?.(event)
  }
}
