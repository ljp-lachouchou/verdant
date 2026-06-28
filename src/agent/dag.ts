import type { PlanStep, TaskPlan } from '@shared/types'

export interface SubTaskResult {
  stepId: string
  stepName: string
  result: string
  success: boolean
  error?: string
}

export class TaskDAG {
  private nodes: Map<string, PlanStep> = new Map()
  private completed: Map<string, SubTaskResult> = new Map()
  private running: Set<string> = new Set()
  private dependents: Map<string, string[]> = new Map()

  constructor(plan: TaskPlan) {
    for (const step of plan.steps) {
      this.nodes.set(step.id, step)
      this.dependents.set(step.id, [])
    }
    for (const step of plan.steps) {
      for (const dep of step.dependencies) {
        if (this.dependents.has(dep)) {
          this.dependents.get(dep)!.push(step.id)
        }
      }
    }
  }

  getReadyTasks(): PlanStep[] {
    const ready: PlanStep[] = []
    for (const [id, step] of this.nodes) {
      if (this.completed.has(id) || this.running.has(id)) continue
      const allDepsComplete = step.dependencies.every(dep => this.completed.has(dep))
      if (allDepsComplete) {
        ready.push(step)
      }
    }
    return ready
  }

  markRunning(stepId: string): void {
    this.running.add(stepId)
  }

  markCompleted(result: SubTaskResult): void {
    this.running.delete(result.stepId)
    this.completed.set(result.stepId, result)
  }

  getDependencyResults(stepId: string): SubTaskResult[] {
    const step = this.nodes.get(stepId)
    if (!step) return []
    return step.dependencies
      .map(dep => this.completed.get(dep))
      .filter((r): r is SubTaskResult => r !== undefined)
  }

  isComplete(): boolean {
    return this.completed.size === this.nodes.size
  }

  getResults(): SubTaskResult[] {
    return Array.from(this.completed.values())
  }

  getStep(stepId: string): PlanStep | undefined {
    return this.nodes.get(stepId)
  }

  getAllSteps(): PlanStep[] {
    return Array.from(this.nodes.values())
  }

  hasCycle(): boolean {
    const inDegree = new Map<string, number>()
    for (const [id, step] of this.nodes) {
      inDegree.set(id, step.dependencies.filter(d => this.nodes.has(d)).length)
    }
    const queue: string[] = []
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id)
    }
    let count = 0
    while (queue.length > 0) {
      const id = queue.shift()!
      count++
      for (const dependent of this.dependents.get(id) || []) {
        inDegree.set(dependent, inDegree.get(dependent)! - 1)
        if (inDegree.get(dependent) === 0) queue.push(dependent)
      }
    }
    return count !== this.nodes.size
  }

  get nodeCount(): number {
    return this.nodes.size
  }
}
