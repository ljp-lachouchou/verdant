import type { AgentConfig, Message } from '@shared/types'
import type { LLMProvider, AgentLoopCallbacks } from './types'
import { ChatPromptManager } from './prompt-manager'
import type { Tool } from '@tools/types'

export class AgentLoop {
  private promptManager: ChatPromptManager
  private llmProvider: LLMProvider
  private tools: Map<string, Tool>
  private config: AgentConfig
  private callbacks: AgentLoopCallbacks
  private running = false
  private steeringQueue: Message[] = []
  private followUpQueue: Message[] = []

  constructor(
    sessionId: string,
    llmProvider: LLMProvider,
    tools: Map<string, Tool>,
    config: AgentConfig,
    callbacks: AgentLoopCallbacks = {}
  ) {
    this.llmProvider = llmProvider
    this.tools = tools
    this.config = config
    this.callbacks = callbacks
    this.promptManager = new ChatPromptManager(
      sessionId,
      config.systemPrompt,
      `Platform: ${process.platform}`
    )
  }

  getPromptManager(): ChatPromptManager {
    return this.promptManager
  }

  loadHistory(messages: Message[]): void {
    this.promptManager.loadMessages(messages)
  }

  isRunning(): boolean {
    return this.running
  }

  steer(message: Message): void {
    this.steeringQueue.push(message)
  }

  addFollowUp(message: Message): void {
    this.followUpQueue.push(message)
  }

  async run(userInput: string): Promise<string> {
    this.running = true

    const userMsg = this.promptManager.addUserMessage(userInput)
    this.persistMessage(userMsg)

    let iterations = 0

    try {
      while (iterations < this.config.maxIterations) {
        // Pi #6: shouldStop — hard stop (e.g. user pressed stop)
        if (this.callbacks.shouldStop?.()) {
          console.log(`[Loop] stopped by shouldStop at iteration ${iterations}`)
          break
        }

        // Pi #3: Steering — inject at turn boundary (before next LLM call)
        if (this.steeringQueue.length > 0) {
          for (const steerMsg of this.steeringQueue) {
            const injected = this.promptManager.addSteeringMessage(steerMsg.content)
            this.persistMessage(injected)
          }
          this.steeringQueue = []
        }

        // Pre-emptive compaction check
        if (this.promptManager.getContextTokenCount() > this.config.compactionThreshold) {
          await this.performCompaction()
        }

        // Pi #1: Two-phase pipeline — convertToLlm filters non-LLM messages
        const prompt = this.promptManager.convertToLlm()
        console.log(`[Loop] iteration ${iterations}, tokens=${this.promptManager.getContextTokenCount()}, prompt segments=${prompt.length}`)

        const response = await this.llmProvider.streamQuery(
          prompt,
          this.config,
          (token) => this.callbacks.onToken?.(token)
        )

        if (response.toolCalls && response.toolCalls.length > 0) {
          console.log(`[Loop] tool_calls: ${response.toolCalls.map(tc => tc.name).join(', ')}`)
          if (response.text) {
            this.callbacks.onTextChunk?.(response.text)
          }

          const toolCallRecords = response.toolCalls.map(tc => ({
            id: tc.id,
            toolName: tc.name,
            args: tc.args,
            status: 'pending' as const,
            timestamp: Date.now()
          }))

          const assistantMsg = this.promptManager.addAssistantMessage(
            response.text,
            toolCallRecords,
            response.reasoningContent
          )
          this.persistMessage(assistantMsg)

          // Pi #5: Parallel tool execution with sequential override
          await this.executeToolCalls(response.toolCalls)

          // Pi #6: shouldStopAfterTurn — graceful stop after tool calls complete
          if (this.callbacks.shouldStopAfterTurn?.()) {
            console.log(`[Loop] stopped by shouldStopAfterTurn at iteration ${iterations}`)
            this.running = false
            return response.text
          }
        } else {
          // Final response — no tool calls
          const finalMsg = this.promptManager.addAssistantMessage(
            response.text, undefined, response.reasoningContent
          )
          this.persistMessage(finalMsg)
          this.callbacks.onComplete?.(response.text)

          // Pi #6: shouldStopAfterTurn
          if (this.callbacks.shouldStopAfterTurn?.()) {
            this.running = false
            return response.text
          }

          // Pi #3: Follow-up queue — only checked when agent stops
          if (this.followUpQueue.length > 0) {
            for (const msg of this.followUpQueue) {
              this.steeringQueue.push(msg)
            }
            this.followUpQueue = []
            iterations++
            continue
          }

          // Check for steering messages from external source
          const steeringMsgs = this.callbacks.getSteeringMessages?.()
          if (steeringMsgs && steeringMsgs.length > 0) {
            for (const msg of steeringMsgs) {
              this.steeringQueue.push(msg)
            }
            iterations++
            continue
          }

          this.running = false
          return response.text
        }

        iterations++
      }

      const timeoutMsg = `Agent loop reached maximum iterations (${this.config.maxIterations})`
      this.callbacks.onError?.(new Error(timeoutMsg))
      this.running = false
      return timeoutMsg
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      this.callbacks.onError?.(error)
      this.running = false
      throw error
    }
  }

  // Pi #5: Parallel tool execution with sequential override
  private async executeToolCalls(toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }>): Promise<void> {
    // Check if any tool requires sequential execution
    const hasSequential = toolCalls.some(tc => {
      const tool = this.tools.get(tc.name)
      return tool?.definition.executionMode === 'sequential'
    })

    if (hasSequential || toolCalls.length === 1) {
      // Sequential execution
      for (const tc of toolCalls) {
        await this.executeSingleTool(tc.id, tc.name, tc.args)
      }
    } else {
      // Parallel execution — pre-checks sequential, execution parallel
      const preChecks = toolCalls.map(tc => this.preCheckTool(tc.id, tc.name, tc.args))
      const blocked = preChecks.filter(p => p.blocked)

      if (blocked.length > 0) {
        for (const p of blocked) {
          const blockMsg = this.promptManager.addToolResult(p.id, p.name, p.blockOutput, true)
          this.persistMessage(blockMsg)
          this.callbacks.onToolResult?.(p.name, p.blockOutput, true)
        }
      }

      const allowed = preChecks.filter(p => !p.blocked)
      if (allowed.length > 0) {
        const results = await Promise.allSettled(
          allowed.map(p => this.executeToolCore(p.id, p.name, p.effectiveArgs))
        )

        // Process results in source order
        for (let i = 0; i < allowed.length; i++) {
          const p = allowed[i]
          const result = results[i]
          if (result.status === 'fulfilled') {
            const { output, isError } = result.value
            this.finalizeToolCall(p.id, p.name, p.args, output, isError)
          } else {
            // Pi #4: Tool throws exception — caught and reported as error
            const errorMsg = result.reason instanceof Error ? result.reason.message : String(result.reason)
            this.finalizeToolCall(p.id, p.name, p.args, `Tool execution error: ${errorMsg}`, true)
          }
        }
      }
    }
  }

  private preCheckTool(id: string, name: string, args: Record<string, unknown>): {
    id: string
    name: string
    args: Record<string, unknown>
    blocked: boolean
    blockOutput: string
    effectiveArgs: Record<string, unknown>
  } {
    const hookCtx = {
      toolName: name,
      args,
      sessionId: this.promptManager.getMessages()[0]?.sessionId || ''
    }

    const beforeResult = this.callbacks.beforeToolCall?.(hookCtx)
    if (beforeResult?.block) {
      return {
        id, name, args,
        blocked: true,
        blockOutput: beforeResult.reason || `Tool "${name}" was blocked`,
        effectiveArgs: args
      }
    }

    return {
      id, name, args,
      blocked: false,
      blockOutput: '',
      effectiveArgs: beforeResult?.modifiedArgs || args
    }
  }

  private async executeSingleTool(id: string, name: string, args: Record<string, unknown>): Promise<void> {
    const preCheck = this.preCheckTool(id, name, args)
    if (preCheck.blocked) {
      const blockMsg = this.promptManager.addToolResult(id, name, preCheck.blockOutput!, true)
      this.persistMessage(blockMsg)
      this.callbacks.onToolResult?.(name, preCheck.blockOutput!, true)
      return
    }

    try {
      const { output, isError } = await this.executeToolCore(id, name, preCheck.effectiveArgs)
      this.finalizeToolCall(id, name, args, output, isError)
    } catch (err) {
      // Pi #4: Tool throws — caught and reported
      const errorMsg = err instanceof Error ? err.message : String(err)
      this.finalizeToolCall(id, name, args, `Tool execution error: ${errorMsg}`, true)
    }
  }

  private async executeToolCore(id: string, name: string, args: Record<string, unknown>): Promise<{ output: string; isError: boolean }> {
    this.callbacks.onToolCall?.(name, args)

    const tool = this.tools.get(name)
    if (!tool) {
      // Pi #4: Tool not found is an error
      throw new Error(`Tool "${name}" not found. Available tools: ${Array.from(this.tools.keys()).join(', ')}`)
    }

    // Pi #4: Tools throw on failure, return only success content
    const result = await tool.execute(args, {
      sessionId: this.promptManager.getMessages()[0]?.sessionId || '',
      workingDirectory: process.cwd(),
      timeout: this.config.shellTimeout,
      maxOutputLength: this.config.maxOutputLength
    })

    // File tracking
    if (name === 'read' && args.path) {
      this.promptManager.trackFileAccess?.(args.path as string, false)
    } else if ((name === 'write' || name === 'edit') && args.path) {
      this.promptManager.trackFileAccess?.(args.path as string, true)
    }

    return { output: result.output, isError: result.isError }
  }

  private finalizeToolCall(id: string, name: string, args: Record<string, unknown>, output: string, isError: boolean): void {
    output = this.sanitizeOutput(this.truncateOutput(output))

    // afterToolCall hook
    const hookCtx = {
      toolName: name,
      args,
      sessionId: this.promptManager.getMessages()[0]?.sessionId || ''
    }
    const afterResult = this.callbacks.afterToolCall?.(hookCtx, output, isError)
    if (afterResult?.modifiedOutput) output = afterResult.modifiedOutput
    if (afterResult?.isError !== undefined) isError = afterResult.isError

    const toolResultMsg = this.promptManager.addToolResult(id, name, output, isError)
    this.persistMessage(toolResultMsg)
    this.callbacks.onToolResult?.(name, output, isError)
  }

  stop(): void {
    this.running = false
  }

  private persistMessage(message: Message): void {
    if (this.callbacks.onMessagePersist) {
      this.callbacks.onMessagePersist(message)
    }
  }

  private async performCompaction(): Promise<void> {
    const result = this.promptManager.compact(
      await this.generateInLoopCompactionSummary()
    )
    this.callbacks.onCompaction?.(result)
  }

  private async generateInLoopCompactionSummary(): Promise<string> {
    const messages = this.promptManager.getActiveMessages()
    const oldMessages = messages.slice(0, Math.max(0, messages.length - 20))

    if (oldMessages.length === 0) return '<compacted_history>No previous context to summarize.</compacted_history>'

    const summaryContent = oldMessages
      .map(m => {
        let line = `[${m.role}/${m.messageType}]: ${m.content.substring(0, 500)}`
        if (m.toolCalls?.length) {
          line += `\n  Tools: ${m.toolCalls.map(tc => `${tc.toolName}(${JSON.stringify(tc.args).substring(0, 100)})`).join(', ')}`
          if (m.toolCalls[0]?.output) line += `\n  Output: ${m.toolCalls[0].output.substring(0, 300)}`
        }
        return line
      })
      .join('\n\n')

    try {
      const response = await this.llmProvider.query(
        [
          {
            role: 'system',
            content: 'You are a conversation summarizer. Create a structured summary preserving: user intent, key decisions, files modified, tool outputs, errors, and current state. Wrap in <compacted_history> tags.'
          },
          { role: 'user', content: `Summarize this conversation:\n\n${summaryContent}` }
        ],
        this.config
      )
      return response.text
    } catch {
      return `<compacted_history>[Fallback summary]\n${oldMessages.map(m => `[${m.role}]: ${m.content.substring(0, 150)}`).join('\n')}\n</compacted_history>`
    }
  }

  private truncateOutput(output: string): string {
    if (output.length > this.config.maxOutputLength) {
      return output.substring(0, this.config.maxOutputLength) + '\n... [output truncated]'
    }
    return output
  }

  private sanitizeOutput(output: string): string {
    const homeDir = process.env['HOME'] || process.env['USERPROFILE'] || ''
    if (homeDir && homeDir.length > 1) {
      return output.split(homeDir).join('~')
    }
    return output
  }
}
