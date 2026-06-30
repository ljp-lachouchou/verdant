import type { Tool, ToolResult, ToolContext, ToolUpdateCallback } from './types'
import type { AgentConfig, AgentEvent } from '@shared/types'
import type { LLMProvider } from '@agent/types'
import type { RuntimeLoopCallbacks } from '@runtime/loop/runtime-loop'
import type { ResourceRegistry } from '@runtime/resource/registry'
import { GoalManager, StateProjector, ContextFormatter, ExecutorManager, MemoryResource, RuntimeLoop } from '@runtime/index'
import { createFullToolRegistry } from './registry'
import { SkillTool, SkillLoader } from './skill-tool'
import { randomUUID } from 'crypto'

const SUBAGENT_PROMPT = `You are a specialized sub-agent. You have been assigned a specific task by the parent agent.
Focus exclusively on your assigned task. Use available tools to complete it.
Provide a clear, complete result at the end.
Write any intermediate files to /tmp/ only.

If a skill is available and relevant to your task, load it first using the skill tool, then follow its instructions.`

export interface TaskToolConfig {
  llmProvider: LLMProvider
  baseConfig: AgentConfig
  toolFactory: () => Map<string, Tool>
  parentCallbacks: RuntimeLoopCallbacks
  parentSessionId: string
  skillLoader?: SkillLoader
  resourceRegistry: ResourceRegistry
}

export class TaskTool implements Tool {
  definition = {
    name: 'task',
    description: 'Delegate a sub-task to a sub-agent. The sub-agent runs its own runtime loop with full tool access including skills. Use this to parallelize work or delegate complex sub-tasks. The sub-agent cannot call task tool (no infinite recursion) but CAN use all other tools: bash, read, write, edit, ls, browser, skill, ask_user, vibe_coding.',
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
  private activeSubAgents: Map<string, RuntimeLoop> = new Map()

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

    this.emitEvent({
      type: 'subagent_register',
      sessionId: this.config.parentSessionId,
      subAgentId,
      subAgentName: description,
      subAgentTask: prompt,
      subAgentStatus: 'running'
    })

    onUpdate?.({ output: `Sub-agent "${description}" started...` })

    const skillLoader = this.config.skillLoader
    const skillsText = skillLoader?.getSkillListText() || ''
    const subSystemPrompt = SUBAGENT_PROMPT + skillsText

    const tools = createFullToolRegistry()

    if (skillLoader && skillLoader.getAllSkills().length > 0) {
      tools.set('skill', new SkillTool(skillLoader))
    }

    if (agentType === 'explore') {
      const readOnly = new Map()
      for (const [name, tool] of tools) {
        if (['read', 'ls', 'bash', 'skill'].includes(name)) {
          readOnly.set(name, tool)
        }
      }
      tools.clear()
      for (const [name, tool] of readOnly) {
        tools.set(name, tool)
      }
    }

    const subGoalManager = new GoalManager()
    const subMemoryResource = new MemoryResource()
    const subProjector = new StateProjector(
      this.config.resourceRegistry,
      subGoalManager,
      subMemoryResource
    )
    const subFormatter = new ContextFormatter(
      subSystemPrompt,
      `Sub-agent: ${description}`
    )
    const subExecutor = new ExecutorManager(tools, {}, {
      sessionId: `${this.config.parentSessionId}_${subAgentId}`,
      workingDirectory: context.workingDirectory,
      timeout: this.config.baseConfig.shellTimeout,
      maxOutputLength: this.config.baseConfig.maxOutputLength
    })

    const subCallbacks: RuntimeLoopCallbacks = {
      onToken: undefined,
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
      shouldStop: () => this.config.parentCallbacks.shouldStop?.() ?? false
    }

    const loop = new RuntimeLoop(
      subProjector,
      subFormatter,
      subExecutor,
      this.config.llmProvider,
      subGoalManager,
      {
        maxIterations: Math.min(this.config.baseConfig.maxIterations, 25),
        systemPrompt: subSystemPrompt,
        agentConfig: { ...this.config.baseConfig, systemPrompt: subSystemPrompt }
      },
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
