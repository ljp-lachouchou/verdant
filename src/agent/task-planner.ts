import type { AgentConfig, LLMResponse, PlanStep, TaskPlan } from '@shared/types'
import type { LLMProvider, PromptSegment } from './types'

const PLANNING_SYSTEM_PROMPT = `You are a task planner for a coding agent system. Your job is to decompose complex user requests into a DAG (directed acyclic graph) of subtasks.

Rules:
1. Each subtask should be a self-contained unit of work that a single coding agent can complete independently.
2. Identify dependencies: if subtask B needs the output of subtask A, then B depends on A (list A's id in B's dependencies array).
3. Subtasks with no dependencies can run in parallel.
4. For simple tasks that don't need decomposition, return a single subtask with no dependencies.
5. Each subtask's "prompt" field must contain detailed, self-contained instructions for the sub-agent.
6. Keep subtask count between 1 and 8.
7. Set requiresSynthesis to true if the subtask results need to be combined into a single coherent answer.
8. Step IDs must be unique strings like "step_1", "step_2", etc.

Output ONLY a JSON object — no markdown fences, no commentary:
{
  "steps": [
    {
      "id": "step_1",
      "name": "Short descriptive name",
      "description": "One-line summary of what this step does",
      "dependencies": [],
      "prompt": "Detailed instructions for the sub-agent"
    }
  ],
  "requiresSynthesis": false
}`

export class TaskPlanner {
  private llmProvider: LLMProvider
  private config: AgentConfig

  constructor(llmProvider: LLMProvider, config: AgentConfig) {
    this.llmProvider = llmProvider
    this.config = config
  }

  async plan(userInput: string, conversationContext?: string): Promise<TaskPlan> {
    const promptSegments: PromptSegment[] = [
      { role: 'system', content: PLANNING_SYSTEM_PROMPT },
      { role: 'user', content: this.buildPlanningPrompt(userInput, conversationContext) }
    ]

    let response: LLMResponse
    try {
      response = await this.llmProvider.query(promptSegments, this.config)
      console.log(`[TaskPlanner] LLM response: ${response.text.substring(0, 200)}...`)
    } catch (err) {
      console.error(`[TaskPlanner] LLM query failed: ${err instanceof Error ? err.message : String(err)}`)
      return this.singleStepPlan(userInput)
    }

    const plan = this.parsePlan(response, userInput)
    console.log(`[TaskPlanner] parsed: ${plan.steps.length} steps, requiresSynthesis=${plan.requiresSynthesis}`)
    return plan
  }

  private buildPlanningPrompt(userInput: string, conversationContext?: string): string {
    let prompt = `Decompose this task into subtasks:\n\n${userInput}`
    if (conversationContext) {
      prompt += `\n\n--- Conversation context ---\n${conversationContext}`
    }
    return prompt
  }

  private parsePlan(response: LLMResponse, originalInput: string): TaskPlan {
    const text = response.text.trim()

    let jsonStr = text

    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (fenceMatch) {
      jsonStr = fenceMatch[1].trim()
    } else {
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        jsonStr = jsonMatch[0]
      }
    }

    try {
      const parsed = JSON.parse(jsonStr)
      if (!parsed.steps || !Array.isArray(parsed.steps) || parsed.steps.length === 0) {
        return this.singleStepPlan(originalInput)
      }

      const steps: PlanStep[] = parsed.steps.map((s: Record<string, unknown>, i: number) => ({
        id: (s.id as string) || `step_${i + 1}`,
        name: (s.name as string) || `Step ${i + 1}`,
        description: (s.description as string) || '',
        dependencies: Array.isArray(s.dependencies) ? (s.dependencies as string[]) : [],
        prompt: (s.prompt as string) || (s.description as string) || originalInput
      }))

      const stepIds = new Set(steps.map(s => s.id))
      for (const step of steps) {
        step.dependencies = step.dependencies.filter(dep => stepIds.has(dep))
      }

      return {
        steps,
        requiresSynthesis: parsed.requiresSynthesis === true || steps.length > 1
      }
    } catch {
      return this.singleStepPlan(originalInput)
    }
  }

  private singleStepPlan(input: string): TaskPlan {
    return {
      steps: [{
        id: 'step_1',
        name: 'Execute task',
        description: input,
        dependencies: [],
        prompt: input
      }],
      requiresSynthesis: false
    }
  }
}
