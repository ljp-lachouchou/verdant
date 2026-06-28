import type { AgentConfig, AgentEvent, Message, PlanStep } from '@shared/types'
import type { AgentLoopCallbacks, LLMProvider } from './types'
import { AgentLoop } from './loop'
import { TaskPlanner } from './task-planner'
import { TaskDAG, type SubTaskResult } from './dag'
import type { Tool } from '@tools/types'
import { randomUUID } from 'crypto'

const SUBAGENT_SYSTEM_PROMPT = `You are a specialized sub-agent working on a specific subtask within a larger task. Focus exclusively on your assigned subtask and complete it thoroughly. Use available tools (shell, file read/write/edit, directory listing) to accomplish your goal. Provide a clear, complete result at the end.`

const SYNTHESIS_SYSTEM_PROMPT = `You are a synthesis agent. You receive results from multiple sub-agents that worked on different parts of a task. Combine their outputs into a single cohesive, well-structured final answer. Remove redundancies, resolve conflicts, and ensure completeness.`

export interface SubAgentManagerConfig {
  sessionId: string
  llmProvider: LLMProvider
  baseConfig: AgentConfig
  callbacks: AgentLoopCallbacks
  toolFactory: () => Map<string, Tool>
  enabled: boolean
}

export class SubAgentManager {
  private sessionId: string
  private llmProvider: LLMProvider
  private baseConfig: AgentConfig
  private callbacks: AgentLoopCallbacks
  private toolFactory: () => Map<string, Tool>
  private enabled: boolean
  private activeLoops: Map<string, AgentLoop> = new Map()
  private currentLoop: AgentLoop | null = null
  private stopped = false

  constructor(config: SubAgentManagerConfig) {
    this.sessionId = config.sessionId
    this.llmProvider = config.llmProvider
    this.baseConfig = config.baseConfig
    this.callbacks = config.callbacks
    this.toolFactory = config.toolFactory
    this.enabled = config.enabled
  }

  async execute(
    userInput: string,
    conversationContext?: string,
    history?: Message[]
  ): Promise<string> {
    if (!this.enabled) {
      return this.runSingleAgent(userInput, history)
    }

    const planner = new TaskPlanner(this.llmProvider, this.baseConfig)
    const plan = await planner.plan(userInput, conversationContext)

    // Always emit plan_created so UI can show planning happened
    this.emit({
      type: 'plan_created',
      sessionId: this.sessionId,
      message: plan.steps.length === 1
        ? 'Plan: single step (no decomposition needed)'
        : `Plan: ${plan.steps.length} steps`,
      planSteps: plan.steps.map(s => ({
        id: s.id,
        name: s.name,
        description: s.description,
        dependencies: s.dependencies
      }))
    })

    if (plan.steps.length === 1 && plan.steps[0].dependencies.length === 0) {
      console.log('[SubAgentManager] Single step plan, running as single agent')
      return this.runSingleAgent(userInput, history)
    }

    const dag = new TaskDAG(plan)
    if (dag.hasCycle()) {
      console.warn('[SubAgentManager] Cycle detected in plan, falling back to single agent')
      return this.runSingleAgent(userInput, history)
    }

    this.emit({
      type: 'plan_created',
      sessionId: this.sessionId,
      message: `Plan: ${plan.steps.length} steps`,
      planSteps: plan.steps.map(s => ({
        id: s.id,
        name: s.name,
        description: s.description,
        dependencies: s.dependencies
      }))
    })

    const results = await this.executeDAG(dag)

    let finalText: string
    if (plan.requiresSynthesis && results.length > 1) {
      finalText = await this.synthesize(userInput, results)
    } else if (results.length === 1) {
      finalText = results[0].result
    } else {
      finalText = results.map(r => `## ${r.stepName}\n${r.result}`).join('\n\n')
    }

    this.callbacks.onComplete?.(finalText)
    return finalText
  }

  private async executeDAG(dag: TaskDAG): Promise<SubTaskResult[]> {
    const concurrencyLimit = 4
    const runningPromises: Map<string, Promise<void>> = new Map()

    while (!dag.isComplete() && !this.stopped) {
      while (runningPromises.size < concurrencyLimit) {
        const readyTasks = dag.getReadyTasks()
        if (readyTasks.length === 0) break

        const step = readyTasks[0]
        dag.markRunning(step.id)

        const promise = this.executeStep(dag, step).then(() => {
          runningPromises.delete(step.id)
        })
        runningPromises.set(step.id, promise)
      }

      if (runningPromises.size === 0) {
        if (!dag.isComplete()) {
          console.error('[SubAgentManager] Deadlock detected — no ready tasks and no running tasks')
        }
        break
      }

      await Promise.race(runningPromises.values())
    }

    if (runningPromises.size > 0) {
      await Promise.all(runningPromises.values())
    }

    return dag.getResults()
  }

  private async executeStep(dag: TaskDAG, step: PlanStep): Promise<void> {
    const subAgentId = `subagent_${step.id}_${randomUUID().slice(0, 8)}`

    this.emit({
      type: 'subagent_register',
      sessionId: this.sessionId,
      subAgentId,
      subAgentName: step.name,
      subAgentTask: step.description,
      subAgentStatus: 'running'
    })

    const depResults = dag.getDependencyResults(step.id)
    const contextPrefix = this.buildDependencyContext(depResults)
    const fullPrompt = contextPrefix
      ? `${contextPrefix}\n\nYour task:\n${step.prompt}`
      : step.prompt

    const subConfig: AgentConfig = {
      ...this.baseConfig,
      systemPrompt: SUBAGENT_SYSTEM_PROMPT,
      maxIterations: Math.min(this.baseConfig.maxIterations, 25)
    }

    const tools = this.toolFactory()

    const subCallbacks: AgentLoopCallbacks = {
      onToken: (token) => { this.callbacks.onToken?.(token) },
      onTextChunk: (text) => { this.callbacks.onTextChunk?.(text) },
      onToolCall: (name, args) => { this.callbacks.onToolCall?.(name, args) },
      onToolResult: (name, output, isError) => { this.callbacks.onToolResult?.(name, output, isError) },
      onComplete: (_text) => { },
      onError: (error) => {
        console.error(`[SubAgentManager] sub-agent ${step.name} error: ${error.message}`)
        this.emit({
          type: 'subagent_update',
          sessionId: this.sessionId,
          subAgentId,
          subAgentStatus: 'error'
        })
      },
      onMessagePersist: (message) => {
        this.callbacks.onMessagePersist?.({
          ...message,
          metadata: { ...message.metadata, subAgentId, subAgentName: step.name }
        })
      },
      onCompaction: (result) => { this.callbacks.onCompaction?.(result) },
      beforeToolCall: (ctx) => this.callbacks.beforeToolCall?.(ctx),
      afterToolCall: (ctx, output, isError) => this.callbacks.afterToolCall?.(ctx, output, isError),
      shouldStop: () => this.stopped
    }

    const loop = new AgentLoop(
      `${this.sessionId}_${subAgentId}`,
      this.llmProvider,
      tools,
      subConfig,
      subCallbacks
    )

    this.activeLoops.set(subAgentId, loop)

    try {
      const result = await loop.run(fullPrompt)

      const subResult: SubTaskResult = {
        stepId: step.id,
        stepName: step.name,
        result,
        success: true
      }
      dag.markCompleted(subResult)

      this.emit({
        type: 'subagent_complete',
        sessionId: this.sessionId,
        subAgentId,
        subAgentName: step.name,
        subAgentStatus: 'success',
        subAgentResult: result
      })
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      const subResult: SubTaskResult = {
        stepId: step.id,
        stepName: step.name,
        result: `Error: ${errorMsg}`,
        success: false,
        error: errorMsg
      }
      dag.markCompleted(subResult)

      this.emit({
        type: 'subagent_update',
        sessionId: this.sessionId,
        subAgentId,
        subAgentStatus: 'error'
      })
    } finally {
      this.activeLoops.delete(subAgentId)
    }
  }

  private buildDependencyContext(results: SubTaskResult[]): string {
    if (results.length === 0) return ''
    const parts = results.map(r => `### ${r.stepName}\n${r.result}`)
    return `Results from previous subtasks (use as context for your work):\n\n${parts.join('\n\n')}`
  }

  private async synthesize(originalInput: string, results: SubTaskResult[]): Promise<string> {
    const resultsText = results.map(r => `### ${r.stepName}\n${r.result}`).join('\n\n---\n\n')

    const synthesisConfig: AgentConfig = {
      ...this.baseConfig,
      systemPrompt: SYNTHESIS_SYSTEM_PROMPT,
      maxIterations: 5
    }

    const tools = this.toolFactory()
    const synthesisId = `synthesis_${randomUUID().slice(0, 8)}`

    this.emit({
      type: 'subagent_register',
      sessionId: this.sessionId,
      subAgentId: synthesisId,
      subAgentName: 'Synthesis',
      subAgentTask: 'Combining results from all subtasks',
      subAgentStatus: 'running'
    })

    const synthesisCallbacks: AgentLoopCallbacks = {
      onToken: (token) => { this.callbacks.onToken?.(token) },
      onTextChunk: (text) => { this.callbacks.onTextChunk?.(text) },
      onComplete: (_text) => { },
      onError: (error) => {
        console.error(`[SubAgentManager] synthesis error: ${error.message}`)
        this.emit({
          type: 'subagent_update',
          sessionId: this.sessionId,
          subAgentId: synthesisId,
          subAgentStatus: 'error'
        })
      },
      shouldStop: () => this.stopped
    }

    const loop = new AgentLoop(
      `${this.sessionId}_synthesis`,
      this.llmProvider,
      tools,
      synthesisConfig,
      synthesisCallbacks
    )

    this.activeLoops.set(synthesisId, loop)

    try {
      const synthesisPrompt = `Original user request: ${originalInput}\n\nResults from subtasks:\n\n${resultsText}\n\nCombine these results into a single, coherent final answer.`
      const finalText = await loop.run(synthesisPrompt)

      this.emit({
        type: 'subagent_complete',
        sessionId: this.sessionId,
        subAgentId: synthesisId,
        subAgentName: 'Synthesis',
        subAgentStatus: 'success',
        subAgentResult: finalText
      })

      return finalText
    } catch (err) {
      this.emit({
        type: 'subagent_update',
        sessionId: this.sessionId,
        subAgentId: synthesisId,
        subAgentStatus: 'error'
      })
      return results.map(r => `## ${r.stepName}\n${r.result}`).join('\n\n')
    } finally {
      this.activeLoops.delete(synthesisId)
    }
  }

  private async runSingleAgent(userInput: string, history?: Message[]): Promise<string> {
    const tools = this.toolFactory()
    this.currentLoop = new AgentLoop(
      this.sessionId,
      this.llmProvider,
      tools,
      this.baseConfig,
      this.callbacks
    )
    if (history && history.length > 0) {
      this.currentLoop.loadHistory(history)
    }
    try {
      return await this.currentLoop.run(userInput)
    } finally {
      this.currentLoop = null
    }
  }

  private emit(event: AgentEvent): void {
    this.callbacks.onEvent?.(event)
  }

  stop(): void {
    this.stopped = true
    for (const loop of this.activeLoops.values()) {
      loop.stop()
    }
    this.currentLoop?.stop()
  }
}
