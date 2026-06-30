import type { LLMProvider, PromptSegment } from '../../agent/types'
import type { AgentConfig, AgentEvent } from '@shared/types'
import type { StateProjector } from '../projector/projector'
import type { ContextFormatter, UserInputImage } from '../projector/formatter'
import type { GoalManager } from '../goal/manager'
import type { ExecutorManager } from '../executor/manager'
import type { ExecutionRecord, ExecutionToolCall } from '../projector/context'
import type { ObservationBuilder } from '../observation/builder'
import type { Observation } from '../observation/types'
import { formatObservation } from '../observation/types'

function summarizePrompt(prompt: PromptSegment[]): string {
  return prompt.map(seg => {
    const content = typeof seg.content === 'string'
      ? seg.content
      : `[multi-modal: ${(seg.content as unknown[]).length} parts]`
    const preview = content.length > 200 ? content.substring(0, 200) + '...' : content
    const tools = seg.toolCalls?.length
      ? ` [tool_calls: ${seg.toolCalls.map(tc => tc.name).join(', ')}]`
      : ''
    return `[${seg.role}]${tools} ${preview}`
  }).join('\n')
}

function summarizeObservation(obs: Observation): string {
  const changes = obs.resourceChanges.length > 0
    ? obs.resourceChanges.map(c => `  [${c.resource}] ${c.change.substring(0, 150)}`).join('\n')
    : '  (no changes detected)'
  const worldState = obs.worldState.length > 0
    ? obs.worldState.map(s => `  ${s.resourceName}: ${s.artifacts.map(a => a.name).join(', ')}`).join('\n')
    : '  (empty)'
  return `[Observation] tool=${obs.toolName}\n  summary: ${obs.summary.substring(0, 200)}\n  changes:\n${changes}\n  worldState:\n${worldState}`
}

export interface RuntimeLoopCallbacks {
  onToken?: (token: string) => void
  onTextChunk?: (text: string) => void
  onToolCall?: (name: string, args: Record<string, unknown>) => void
  onToolResult?: (name: string, output: string, isError: boolean) => void
  onComplete?: (text: string) => void
  onError?: (error: Error) => void
  onGoalCreated?: (goalId: string, title: string) => void
  onGoalFinished?: (goalId: string, status: string) => void
  onRoundStart?: (round: number) => void
  onRoundEnd?: (round: number) => void
  onTurnText?: (text: string, reasoningContent?: string) => void
  onEvent?: (event: AgentEvent) => void
  shouldStop?: () => boolean
  shouldStopAfterTurn?: () => boolean
}

export interface RuntimeLoopConfig {
  maxIterations: number
  systemPrompt: string
  developerPrompt?: string
  agentConfig: AgentConfig
}

export class RuntimeLoop {
  private projector: StateProjector
  private formatter: ContextFormatter
  private executor: ExecutorManager
  private llmProvider: LLMProvider
  private goalManager: GoalManager
  private config: RuntimeLoopConfig
  private callbacks: RuntimeLoopCallbacks
  private observationBuilder?: ObservationBuilder
  private running = false
  private steeringQueue: string[] = []

  constructor(
    projector: StateProjector,
    formatter: ContextFormatter,
    executor: ExecutorManager,
    llmProvider: LLMProvider,
    goalManager: GoalManager,
    config: RuntimeLoopConfig,
    callbacks: RuntimeLoopCallbacks = {},
    observationBuilder?: ObservationBuilder
  ) {
    this.projector = projector
    this.formatter = formatter
    this.executor = executor
    this.llmProvider = llmProvider
    this.goalManager = goalManager
    this.config = config
    this.callbacks = callbacks
    this.observationBuilder = observationBuilder
  }

  isRunning(): boolean {
    return this.running
  }

  steer(message: string): void {
    this.steeringQueue.push(message)
  }

  async run(userInput: string, images?: UserInputImage[]): Promise<string> {
    this.running = true

    const goal = this.goalManager.create(
      userInput.substring(0, 80),
      userInput
    )
    this.callbacks.onGoalCreated?.(goal.id, goal.title)

    let iterations = 0

    try {
      while (iterations < this.config.maxIterations) {
        if (this.callbacks.shouldStop?.()) {
          break
        }

        if (this.steeringQueue.length > 0) {
          const steerMsg = this.steeringQueue.shift()!
          this.goalManager.update({
            description: `${this.goalManager.getCurrent()?.description}\n\n[Steering]: ${steerMsg}`
          })
        }

        this.callbacks.onRoundStart?.(iterations)

        const ctx = await this.projector.project()
        const preSnapshots = ctx.snapshots
        const prompt = this.formatter.format(ctx, userInput, images)

        console.log(`\n${'═'.repeat(80)}`)
        console.log(`[Trace] Round ${iterations} — LLM INPUT`)
        console.log(`${'─'.repeat(80)}`)
        console.log(`[Trace] Goal: ${ctx.goal?.title || '(none)'}`)
        console.log(`[Trace] Observations in ctx: ${ctx.observations.length}`)
        console.log(`[Trace] Snapshots: ${ctx.snapshots.map(s => s.resourceName).join(', ') || '(none)'}`)
        console.log(`[Trace] Execution history: ${ctx.executionHistory.length} records`)
        console.log(`${'─'.repeat(40)} Prompt segments (${prompt.length}) ${'─'.repeat(40)}`)
        console.log(summarizePrompt(prompt))
        console.log(`${'═'.repeat(80)}\n`)

        const response = await this.llmProvider.streamQuery(
          prompt,
          this.config.agentConfig,
          (token) => this.callbacks.onToken?.(token)
        )

        console.log(`\n${'▼'.repeat(80)}`)
        console.log(`[Trace] Round ${iterations} — LLM OUTPUT`)
        console.log(`${'─'.repeat(80)}`)
        console.log(`[Trace] Text: ${(response.text || '(empty)').substring(0, 300)}`)
        console.log(`[Trace] Reasoning: ${response.reasoningContent ? response.reasoningContent.substring(0, 200) + '...' : '(none)'}`)
        console.log(`[Trace] Tool calls: ${response.toolCalls?.length || 0}`)
        if (response.toolCalls) {
          for (const tc of response.toolCalls) {
            console.log(`[Trace]   → ${tc.name}(${JSON.stringify(tc.args).substring(0, 150)})`)
          }
        }
        console.log(`[Trace] Done: ${response.done}`)
        console.log(`${'▼'.repeat(80)}\n`)

        if (response.toolCalls && response.toolCalls.length > 0) {
          const toolCallRecords = response.toolCalls.map(tc => ({
            id: tc.id,
            name: tc.name,
            args: tc.args
          }))

          for (const tc of toolCallRecords) {
            this.callbacks.onToolCall?.(tc.name, tc.args)
          }

          const results = await this.executor.executeBatch(toolCallRecords)
          const turnStartTime = Date.now()

          const executedToolCalls: ExecutionToolCall[] = []
          for (const tc of toolCallRecords) {
            const result = results.get(tc.id)
            if (!result) continue

            this.callbacks.onToolResult?.(tc.name, result.output, result.isError)

            let observation
            if (this.observationBuilder) {
              observation = await this.observationBuilder.build(
                tc.id,
                tc.name,
                tc.args,
                result.output,
                result.isError,
                preSnapshots
              )

              console.log(`\n${'◆'.repeat(80)}`)
              console.log(`[Trace] Round ${iterations} — WORLD CHANGE (tool: ${tc.name})`)
              console.log(`${'─'.repeat(80)}`)
              console.log(`[Trace] Tool args: ${JSON.stringify(tc.args).substring(0, 200)}`)
              console.log(`[Trace] Raw output (${result.output.length} chars): ${result.output.substring(0, 300)}`)
              console.log(`${'─'.repeat(40)} Observation ${'─'.repeat(40)}`)
              console.log(summarizeObservation(observation))
              console.log(`${'─'.repeat(40)} Formatted for LLM ${'─'.repeat(40)}`)
              console.log(formatObservation(observation).substring(0, 500))
              console.log(`${'◆'.repeat(80)}\n`)
            }

            executedToolCalls.push({
              id: tc.id,
              name: tc.name,
              args: tc.args,
              result: result.output,
              isError: result.isError,
              duration: result.duration,
              observation
            })
          }

          const record: Omit<ExecutionRecord, 'round'> = {
            assistantText: response.text || '',
            reasoningContent: response.reasoningContent,
            toolCalls: executedToolCalls,
            startTime: turnStartTime,
            endTime: Date.now()
          }
          this.projector.recordExecution(record)

          const normalizedResults = await this.projector.runNormalizers()
          if (normalizedResults.length > 0) {
            console.log(`\n${'★'.repeat(80)}`)
            console.log(`[Trace] Round ${iterations} — NORMALIZED DATA`)
            console.log(`${'─'.repeat(80)}`)
            for (const nr of normalizedResults) {
              console.log(`[Trace] ${nr.normalizerName}: ${nr.summary.substring(0, 200)}`)
            }
            console.log(`${'★'.repeat(80)}\n`)
          }

          if (response.text) {
            this.callbacks.onTurnText?.(response.text, response.reasoningContent)
          }

          if (this.callbacks.shouldStopAfterTurn?.()) {
            this.callbacks.onRoundEnd?.(iterations)
            this.goalManager.finish()
            this.callbacks.onGoalFinished?.(goal.id, 'completed')
            this.running = false
            return response.text
          }
        } else {
          console.log(`\n${'✦'.repeat(80)}`)
          console.log(`[Trace] GOAL COMPLETE — No more tool calls`)
          console.log(`[Trace] Final text: ${(response.text || '').substring(0, 500)}`)
          console.log(`[Trace] Total rounds: ${iterations + 1}`)
          console.log(`[Trace] Total observations: ${this.projector.getRecentObservations(999).length}`)
          console.log(`[Trace] Total execution records: ${this.projector.getExecutionHistory().size()}`)
          console.log(`${'✦'.repeat(80)}\n`)

          this.callbacks.onComplete?.(response.text)
          this.callbacks.onRoundEnd?.(iterations)
          this.goalManager.finish()
          this.callbacks.onGoalFinished?.(goal.id, 'completed')
          this.running = false
          return response.text
        }

        this.projector.nextRound()
        this.callbacks.onRoundEnd?.(iterations)
        iterations++
      }

      const timeoutMsg = `Runtime loop reached maximum iterations (${this.config.maxIterations})`
      this.callbacks.onError?.(new Error(timeoutMsg))
      this.goalManager.abort()
      this.callbacks.onGoalFinished?.(goal.id, 'aborted')
      this.running = false
      return timeoutMsg
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      this.callbacks.onError?.(error)
      this.goalManager.abort()
      this.callbacks.onGoalFinished?.(goal.id, 'aborted')
      this.running = false
      throw error
    }
  }

  stop(): void {
    this.running = false
  }
}
