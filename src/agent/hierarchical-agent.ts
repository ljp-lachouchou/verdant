import type { AgentConfig, AgentEvent, Message } from '@shared/types'
import type { AgentLoopCallbacks, LLMProvider, PromptSegment } from './types'
import { AgentLoop } from './loop'
import type { Tool } from '@tools/types'
import { randomUUID } from 'crypto'

const DIRECTOR_SYSTEM_PROMPT = `You are the Director Agent — the orchestrator of a multi-agent system.

Your responsibilities:
1. Decompose the user's request into high-level steps (AT LEAST 3 steps, ideally 4-6)
2. For each step, write a clear, detailed instruction for the Executor Agent
3. Track progress — you receive results from each step before proceeding
4. After all steps complete, provide a final summary to the user

CRITICAL RULES:
- You MUST decompose into AT LEAST 3 steps. NEVER return a single step.
- You do NOT execute tasks yourself — you only plan and track
- Each step must be self-contained with clear deliverables
- Each step instruction must be detailed enough for an executor to act without asking questions
- The final deliverable must be EXACTLY what the user asked for — no extra files.
- All intermediate work (outlines, drafts, scripts) must be done in /tmp/ and cleaned up automatically.
- Only the final deliverable should remain in the user's specified directory.

TASK-SPECIFIC PLANNING:
For PPT/presentation tasks, use this proven pattern:
  Step 1: Create content outline (write to /tmp/outline.json — titles and key points for each page)
  Step 2: Generate all page contents in parallel (spawn N workers, each writes content for assigned pages to /tmp/pages_X.json)
  Step 3: Assemble final PPT from /tmp/ page files (run python-pptx script, output to user's directory)
  Step 4: Verify the output file (check page count, file size, content)

For document/report tasks:
  Step 1: Research and outline
  Step 2: Write sections in parallel (spawn workers per section)
  Step 3: Assemble into final document
  Step 4: Verify

For code tasks:
  Step 1: Analyze requirements and design
  Step 2: Implement (spawn workers per module if large)
  Step 3: Test and verify

Output your plan as JSON ONLY (no markdown fences, no commentary):
{
  "steps": [
    { "id": "step_1", "name": "Short name", "instruction": "Detailed instruction for the executor", "can_parallelize": false }
  ]
}`

const EXECUTOR_SYSTEM_PROMPT = `You are the Executor Agent — you receive a single step from the Director and decide how to complete it.

Your responsibilities:
1. Analyze the step instruction
2. Decide: can you complete this alone, or should you spawn worker agents?
3. If spawning workers: decompose into worker tasks, each with a clear prompt
4. If doing it yourself: use tools directly to complete the task

When deciding to spawn workers, output JSON:
{
  "workers": [
    { "id": "worker_1", "name": "Short name", "prompt": "Detailed instructions for this worker" }
  ]
}

When doing it yourself, just proceed with tool calls and provide your result.

Rules:
- Workers run in parallel — only spawn workers if the work is truly parallelizable
- Each worker must be self-contained — it cannot communicate with other workers
- After workers complete, synthesize their outputs into a single result
- Keep worker count reasonable (max 10)
- CRITICAL: All intermediate files MUST be written to /tmp/. Never write intermediate files to the user's Downloads directory or working directory.
- Only the FINAL deliverable goes to the user's specified location (e.g. ~/Downloads/).
- Do NOT create individual slide files, separate text files for each story, or other byproducts. Work in /tmp/ and produce only the final output file.`

const WORKER_SYSTEM_PROMPT = `You are a Worker Agent — you execute a specific sub-task within a larger plan.
Focus exclusively on your assigned task. Use available tools to complete it.
Provide a clear, complete result at the end.
IMPORTANT: Write any intermediate files to /tmp/ only. Do not write to ~/Downloads/ or the working directory.`

export interface DirectorStep {
  id: string
  name: string
  instruction: string
  can_parallelize: boolean
  status: 'pending' | 'running' | 'success' | 'error'
  result?: string
  workers?: WorkerInfo[]
}

export interface WorkerInfo {
  id: string
  name: string
  prompt: string
  status: 'pending' | 'running' | 'success' | 'error'
  result?: string
}

export interface HierarchicalAgentConfig {
  sessionId: string
  llmProvider: LLMProvider
  baseConfig: AgentConfig
  callbacks: AgentLoopCallbacks
  toolFactory: () => Map<string, Tool>
  enabled: boolean
}

export class HierarchicalAgentManager {
  private sessionId: string
  private llmProvider: LLMProvider
  private baseConfig: AgentConfig
  private callbacks: AgentLoopCallbacks
  private toolFactory: () => Map<string, Tool>
  private enabled: boolean
  private stopped = false
  private activeLoops: Map<string, AgentLoop> = new Map()

  constructor(config: HierarchicalAgentConfig) {
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

    // Phase 1: Director creates high-level plan
    const steps = await this.createPlan(userInput, conversationContext)
    console.log(`[Hierarchy] Director created ${steps.length} steps`)

    // Multi-agent mode always has at least 3 steps (fallbackPlan guarantees this)
    this.emit({
      type: 'plan_created',
      sessionId: this.sessionId,
      message: `Director plan: ${steps.length} steps`,
      planSteps: steps.map(s => ({
        id: s.id,
        name: s.name,
        description: s.instruction,
        dependencies: []
      }))
    })

    // Phase 2: Execute each step via Executor Agent
    const runId = randomUUID().slice(0, 8)
    for (const step of steps) {
      if (this.stopped) break

      step.status = 'running'
      const executorId = `executor_${runId}_${step.id}`
      this.emit({
        type: 'subagent_register',
        sessionId: this.sessionId,
        subAgentId: executorId,
        subAgentName: `Executor: ${step.name}`,
        subAgentTask: step.instruction.substring(0, 80),
        subAgentStatus: 'running'
      })

      try {
        const result = await this.runExecutor(step, steps)
        step.result = result
        step.status = 'success'

        this.emit({
          type: 'subagent_complete',
          sessionId: this.sessionId,
          subAgentId: executorId,
          subAgentName: `Executor: ${step.name}`,
          subAgentStatus: 'success',
          subAgentResult: result.substring(0, 200)
        })

        console.log(`[Hierarchy] Step ${step.id} completed: ${result.substring(0, 100)}...`)
      } catch (err) {
        step.status = 'error'
        step.result = err instanceof Error ? err.message : String(err)

        this.emit({
          type: 'subagent_update',
          sessionId: this.sessionId,
          subAgentId: executorId,
          subAgentStatus: 'error'
        })

        console.error(`[Hierarchy] Step ${step.id} failed: ${step.result}`)
      }
    }

    // Phase 3: Director synthesizes final answer
    const finalText = await this.synthesize(userInput, steps)

    this.emit({
      type: 'complete',
      sessionId: this.sessionId,
      text: finalText
    })

    this.callbacks.onComplete?.(finalText)
    return finalText
  }

  private async createPlan(userInput: string, context?: string): Promise<DirectorStep[]> {
    const prompt: PromptSegment[] = [
      { role: 'system', content: DIRECTOR_SYSTEM_PROMPT },
      { role: 'user', content: this.buildPlanningPrompt(userInput, context) }
    ]

    try {
      const response = await this.llmProvider.query(prompt, this.baseConfig)
      console.log(`[Hierarchy] Director response: ${response.text.substring(0, 300)}...`)
      return this.parsePlan(response.text, userInput)
    } catch (err) {
      console.error(`[Hierarchy] Director planning failed: ${err}, using fallback`)
      return this.fallbackPlan(userInput)
    }
  }

  private buildPlanningPrompt(userInput: string, context?: string): string {
    let prompt = `Create a high-level execution plan for this task:\n\n${userInput}`
    if (context) {
      prompt += `\n\n--- Context ---\n${context}`
    }
    return prompt
  }

  private parsePlan(text: string, originalInput: string): DirectorStep[] {
    let jsonStr = text.trim()

    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (fenceMatch) {
      jsonStr = fenceMatch[1].trim()
    } else {
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (jsonMatch) jsonStr = jsonMatch[0]
    }

    try {
      const parsed = JSON.parse(jsonStr)
      if (!parsed.steps || !Array.isArray(parsed.steps)) return []

      const steps: DirectorStep[] = parsed.steps.map((s: Record<string, unknown>, i: number) => ({
        id: (s.id as string) || `step_${i + 1}`,
        name: (s.name as string) || `Step ${i + 1}`,
        instruction: (s.instruction as string) || (s.description as string) || originalInput,
        can_parallelize: !!s.can_parallelize,
        status: 'pending' as const
      }))

      // Force minimum 3 steps in multi-agent mode
      if (steps.length < 3) {
        console.warn(`[Hierarchy] Director returned only ${steps.length} steps, expanding`)
        return this.fallbackPlan(originalInput)
      }

      return steps
    } catch {
      console.warn('[Hierarchy] Plan parse failed, using fallback')
      return this.fallbackPlan(originalInput)
    }
  }

  private fallbackPlan(input: string): DirectorStep[] {
    return [
      {
        id: 'step_1',
        name: 'Research & Plan',
        instruction: `Analyze the task and create a detailed plan. Task: ${input}. Identify what information is needed, what tools to use, and outline the approach.`,
        can_parallelize: false,
        status: 'pending'
      },
      {
        id: 'step_2',
        name: 'Execute Core Task',
        instruction: `Execute the main task: ${input}. Use tools (bash, file read/write) to complete the work. This step may spawn parallel workers for sub-tasks.`,
        can_parallelize: false,
        status: 'pending'
      },
      {
        id: 'step_3',
        name: 'Verify & Deliver',
        instruction: `Verify the output is correct and complete. Check files exist, content is valid, and deliver the final result to the user.`,
        can_parallelize: false,
        status: 'pending'
      }
    ]
  }

  private async runExecutor(step: DirectorStep, allSteps: DirectorStep[]): Promise<string> {
    // Build context from previous steps
    const prevResults = allSteps
      .filter(s => s.status === 'success' && s.result)
      .map(s => `### ${s.name}\n${s.result}`)
      .join('\n\n')

    const executorPrompt = prevResults
      ? `Previous step results:\n${prevResults}\n\nYour step:\n${step.instruction}`
      : step.instruction

    // Ask executor: do it alone or spawn workers?
    const workerPlan = await this.decideWorkers(executorPrompt)

    if (workerPlan && workerPlan.length > 1) {
      console.log(`[Hierarchy] Executor spawning ${workerPlan.length} workers for ${step.name}`)
      return this.runWorkers(step, workerPlan)
    }

    // Execute directly
    console.log(`[Hierarchy] Executor doing ${step.name} directly`)
    return this.runAgent(
      `executor_${step.id}`,
      EXECUTOR_SYSTEM_PROMPT,
      executorPrompt,
      Math.min(this.baseConfig.maxIterations, 30)
    )
  }

  private async decideWorkers(executorPrompt: string): Promise<WorkerInfo[] | null> {
    const prompt: PromptSegment[] = [
      {
        role: 'system',
        content: `You are a task decomposition specialist. Your job is to determine if a task should be split into parallel worker tasks.

Rules:
- If the task involves creating MULTIPLE similar items (e.g. "write 10 stories", "generate 5 pages", "create content for each slide"), you MUST split into workers — one per item or group of items.
- If the task is a single atomic action (e.g. "install a package", "run a script", "verify a file", "assemble a PPT from existing data"), respond with SELF.
- When splitting, each worker gets a focused, self-contained prompt with clear output instructions.
- Workers CANNOT communicate with each other — each must be independent.
- For large numbers (e.g. 710 pages), group them: 10 workers each handling ~71 pages. Each worker writes its output to /tmp/pages_<n>.json.
- For content generation tasks, workers should write their output to /tmp/ files, not to the final destination.

Output format:
- To split: {"workers": [{"id": "worker_1", "name": "Pages 1-71", "prompt": "Write content for pages 1-71. For each page, create a title and 2-3 bullet points. Write output to /tmp/pages_1.json as [{page: 1, title: '...', points: [...]}]"}, ...]}
- To do alone: {"action": "self"}

Output JSON ONLY.`
      },
      {
        role: 'user',
        content: `Task:\n${executorPrompt}\n\nShould this be split into parallel workers? If the task involves generating content for multiple pages/stories/sections, you MUST split. If it's assembly or verification, use SELF.`
      }
    ]

    try {
      const response = await this.llmProvider.query(prompt, this.baseConfig)
      const text = response.text.trim()
      console.log(`[Hierarchy] decideWorkers response: ${text.substring(0, 200)}...`)

      let jsonStr = text
      const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
      if (fenceMatch) {
        jsonStr = fenceMatch[1].trim()
      } else {
        const jsonMatch = text.match(/\{[\s\S]*\}/)
        if (jsonMatch) jsonStr = jsonMatch[0]
      }

      const parsed = JSON.parse(jsonStr)

      if (parsed.action === 'self') {
        console.log('[Hierarchy] LLM chose SELF')
        return null
      }

      if (!parsed.workers || !Array.isArray(parsed.workers) || parsed.workers.length === 0) {
        console.log('[Hierarchy] No workers in response, doing SELF')
        return null
      }

      const workers: WorkerInfo[] = parsed.workers.map((w: Record<string, unknown>, i: number) => ({
        id: (w.id as string) || `worker_${i + 1}`,
        name: (w.name as string) || `Worker ${i + 1}`,
        prompt: (w.prompt as string) || (w.task as string) || '',
        status: 'pending' as const
      }))

      console.log(`[Hierarchy] Parsed ${workers.length} workers: ${workers.map(w => w.name).join(', ')}`)
      return workers
    } catch (err) {
      console.error(`[Hierarchy] decideWorkers parse failed: ${err}`)
      return null
    }
  }

  private async runWorkers(step: DirectorStep, workers: WorkerInfo[]): Promise<string> {
    step.workers = workers

    // Register all workers in UI
    for (const w of workers) {
      this.emit({
        type: 'subagent_register',
        sessionId: this.sessionId,
        subAgentId: `worker_${step.id}_${w.id}`,
        subAgentName: w.name,
        subAgentTask: w.prompt.substring(0, 80),
        subAgentStatus: 'running'
      })
    }

    // Run workers in parallel (max concurrency 5)
    const concurrencyLimit = 5
    const results: string[] = new Array(workers.length)

    const runBatch = async (startIndex: number) => {
      const batch = workers.slice(startIndex, startIndex + concurrencyLimit)
      const promises = batch.map(async (worker, batchIdx) => {
        const workerIdx = startIndex + batchIdx
        worker.status = 'running'

        try {
          const result = await this.runAgent(
            `worker_${step.id}_${worker.id}`,
            WORKER_SYSTEM_PROMPT,
            worker.prompt,
            Math.min(this.baseConfig.maxIterations, 20),
            true  // isWorker — don't stream tokens to UI
          )
          worker.result = result
          worker.status = 'success'

          this.emit({
            type: 'subagent_complete',
            sessionId: this.sessionId,
            subAgentId: `worker_${step.id}_${worker.id}`,
            subAgentName: worker.name,
            subAgentStatus: 'success',
            subAgentResult: result.substring(0, 200)
          })

          results[workerIdx] = result
        } catch (err) {
          worker.status = 'error'
          worker.result = err instanceof Error ? err.message : String(err)
          results[workerIdx] = `Error: ${worker.result}`

          this.emit({
            type: 'subagent_update',
            sessionId: this.sessionId,
            subAgentId: `worker_${step.id}_${worker.id}`,
            subAgentStatus: 'error'
          })
        }
      })
      await Promise.all(promises)
    }

    for (let i = 0; i < workers.length; i += concurrencyLimit) {
      if (this.stopped) break
      await runBatch(i)
    }

    // Synthesize worker results
    const synthesisPrompt = `You are the Executor Agent. Your workers completed these tasks:\n\n${workers.map((w, i) => `### ${w.name}\n${results[i] || 'No result'}`).join('\n\n---\n\n')}\n\nSynthesize these into a single coherent result.`
    return this.runAgent(
      `executor_synth_${step.id}`,
      EXECUTOR_SYSTEM_PROMPT,
      synthesisPrompt,
      10
    )
  }

  private async runAgent(
    agentId: string,
    systemPrompt: string,
    userPrompt: string,
    maxIterations: number,
    isWorker: boolean = false
  ): Promise<string> {
    const config: AgentConfig = {
      ...this.baseConfig,
      systemPrompt,
      maxIterations,
      maxOutputLength: this.baseConfig.maxOutputLength
    }

    const tools = this.toolFactory()
    const agentCallbacks: AgentLoopCallbacks = {
      // Workers don't stream tokens to UI — their output is collected and synthesized
      onToken: isWorker ? undefined : (token) => { this.callbacks.onToken?.(token) },
      onTextChunk: isWorker ? undefined : (text) => { this.callbacks.onTextChunk?.(text) },
      onToolCall: (name, args) => { this.callbacks.onToolCall?.(name, args) },
      onToolResult: (name, output, isError) => { this.callbacks.onToolResult?.(name, output, isError) },
      onComplete: (_text) => { },
      onError: (error) => { console.error(`[Hierarchy] Agent ${agentId} error: ${error.message}`) },
      onMessagePersist: (msg) => {
        this.callbacks.onMessagePersist?.({
          ...msg,
          metadata: { ...msg.metadata, agentId }
        })
      },
      shouldStop: () => this.stopped
    }

    const loop = new AgentLoop(
      `${this.sessionId}_${agentId}`,
      this.llmProvider,
      tools,
      config,
      agentCallbacks
    )

    this.activeLoops.set(agentId, loop)

    try {
      return await loop.run(userPrompt)
    } finally {
      this.activeLoops.delete(agentId)
    }
  }

  private async synthesize(originalInput: string, steps: DirectorStep[]): Promise<string> {
    const completed = steps.filter(s => s.status === 'success' && s.result)
    if (completed.length === 0) {
      return 'Task failed — no steps completed successfully.'
    }

    if (completed.length === 1) {
      return completed[0].result!
    }

    const resultsText = steps.map(s =>
      `### ${s.name} [${s.status}]\n${s.result || 'No result'}`
    ).join('\n\n---\n\n')

    const synthPrompt = `Original user request: ${originalInput}\n\nResults from all steps:\n\n${resultsText}\n\nProvide a final summary to the user. Include what was accomplished and any important details.`
    return this.runAgent('director_synthesis', DIRECTOR_SYSTEM_PROMPT, synthPrompt, 10)
  }

  private async runSingleAgent(userInput: string, history?: Message[]): Promise<string> {
    const tools = this.toolFactory()
    const loop = new AgentLoop(
      this.sessionId,
      this.llmProvider,
      tools,
      this.baseConfig,
      this.callbacks
    )
    if (history && history.length > 0) {
      loop.loadHistory(history)
    }
    return loop.run(userInput)
  }

  private emit(event: AgentEvent): void {
    this.callbacks.onEvent?.(event)
  }

  stop(): void {
    this.stopped = true
    for (const loop of this.activeLoops.values()) {
      loop.stop()
    }
  }
}
