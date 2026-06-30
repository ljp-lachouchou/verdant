import type { ToolRegistry, ToolResult, ToolContext } from '../../tools/types'

export interface ExecutorResult {
  toolName: string
  args: Record<string, unknown>
  output: string
  isError: boolean
  metadata?: Record<string, unknown>
  duration: number
}

export interface ExecutorHooks {
  beforeExecute?: (toolName: string, args: Record<string, unknown>) => {
    block?: boolean
    reason?: string
    modifiedArgs?: Record<string, unknown>
  } | void
  afterExecute?: (toolName: string, args: Record<string, unknown>, result: ExecutorResult) => {
    modifiedOutput?: string
    isError?: boolean
  } | void
}

export class ExecutorManager {
  private tools: ToolRegistry
  private hooks: ExecutorHooks
  private baseContext: Partial<ToolContext>

  constructor(
    tools: ToolRegistry,
    hooks: ExecutorHooks = {},
    baseContext: Partial<ToolContext> = {}
  ) {
    this.tools = tools
    this.hooks = hooks
    this.baseContext = baseContext
  }

  setTools(tools: ToolRegistry): void {
    this.tools = tools
  }

  setHooks(hooks: ExecutorHooks): void {
    this.hooks = hooks
  }

  async execute(
    toolName: string,
    args: Record<string, unknown>,
    contextOverrides?: Partial<ToolContext>
  ): Promise<ExecutorResult> {
    const startTime = Date.now()

    const beforeResult = this.hooks.beforeExecute?.(toolName, args)
    if (beforeResult?.block) {
      return {
        toolName,
        args,
        output: beforeResult.reason || `Tool "${toolName}" was blocked`,
        isError: true,
        duration: Date.now() - startTime
      }
    }

    const effectiveArgs = beforeResult?.modifiedArgs || args
    const tool = this.tools.get(toolName)

    if (!tool) {
      return {
        toolName,
        args: effectiveArgs,
        output: `Tool "${toolName}" not found. Available: ${Array.from(this.tools.keys()).join(', ')}`,
        isError: true,
        duration: Date.now() - startTime
      }
    }

    const context: ToolContext = {
      sessionId: this.baseContext.sessionId || '',
      workingDirectory: this.baseContext.workingDirectory || process.cwd(),
      timeout: this.baseContext.timeout || 60000,
      maxOutputLength: this.baseContext.maxOutputLength || 100000,
      ...contextOverrides
    }

    let result: ToolResult
    try {
      result = await tool.execute(effectiveArgs, context)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      return {
        toolName,
        args: effectiveArgs,
        output: `Execution error: ${errorMsg}`,
        isError: true,
        duration: Date.now() - startTime
      }
    }

    let executorResult: ExecutorResult = {
      toolName,
      args: effectiveArgs,
      output: result.output,
      isError: result.isError,
      metadata: result.metadata,
      duration: Date.now() - startTime
    }

    const afterResult = this.hooks.afterExecute?.(toolName, effectiveArgs, executorResult)
    if (afterResult?.modifiedOutput) {
      executorResult = { ...executorResult, output: afterResult.modifiedOutput }
    }
    if (afterResult?.isError !== undefined) {
      executorResult = { ...executorResult, isError: afterResult.isError }
    }

    return executorResult
  }

  async executeBatch(
    calls: Array<{ id: string; name: string; args: Record<string, unknown> }>,
    mode: 'parallel' | 'sequential' = 'parallel'
  ): Promise<Map<string, ExecutorResult>> {
    const results = new Map<string, ExecutorResult>()

    if (mode === 'sequential' || calls.length === 1) {
      for (const call of calls) {
        const result = await this.execute(call.name, call.args)
        results.set(call.id, result)
      }
    } else {
      const hasSequential = calls.some(c => {
        const tool = this.tools.get(c.name)
        return tool?.definition.executionMode === 'sequential'
      })

      if (hasSequential) {
        for (const call of calls) {
          const result = await this.execute(call.name, call.args)
          results.set(call.id, result)
        }
      } else {
        const settled = await Promise.allSettled(
          calls.map(c => this.execute(c.name, c.args))
        )
        for (let i = 0; i < calls.length; i++) {
          const s = settled[i]
          if (s.status === 'fulfilled') {
            results.set(calls[i].id, s.value)
          } else {
            results.set(calls[i].id, {
              toolName: calls[i].name,
              args: calls[i].args,
              output: `Execution error: ${s.reason instanceof Error ? s.reason.message : String(s.reason)}`,
              isError: true,
              duration: 0
            })
          }
        }
      }
    }

    return results
  }

  getToolDefinitions() {
    return Array.from(this.tools.values()).map(t => t.definition)
  }
}
