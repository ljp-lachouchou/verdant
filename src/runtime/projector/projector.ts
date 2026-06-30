import type { ResourceRegistry } from '../resource/registry'
import type { GoalManager } from '../goal/manager'
import type { MemoryResource } from '../resource/memory'
import type { Snapshot, SnapshotContext, Capability } from '../resource/types'
import type { RuntimeContext, ExecutionRecord } from './context'
import type { Observation } from '../observation/types'
import type { NormalizedResult } from '../normalizer/types'
import type { NormalizerRegistry } from '../normalizer/registry'
import { ExecutionHistory } from './context'
import { CapabilitySelector } from './selector'

export interface ProjectorOptions {
  requiredCapabilities?: Capability[]
  snapshotCtx?: SnapshotContext
  maxExecutionHistory?: number
}

export class StateProjector {
  private registry: ResourceRegistry
  private goalManager: GoalManager
  private memoryResource: MemoryResource
  private normalizerRegistry?: NormalizerRegistry
  private selector: CapabilitySelector
  private executionHistory: ExecutionHistory
  private observations: Observation[] = []
  private round: number = 0

  constructor(
    registry: ResourceRegistry,
    goalManager: GoalManager,
    memoryResource: MemoryResource,
    normalizerRegistry?: NormalizerRegistry
  ) {
    this.registry = registry
    this.goalManager = goalManager
    this.memoryResource = memoryResource
    this.normalizerRegistry = normalizerRegistry
    this.selector = new CapabilitySelector()
    this.executionHistory = new ExecutionHistory()
  }

  async project(options?: ProjectorOptions): Promise<RuntimeContext> {
    const goal = this.goalManager.getCurrent()

    const required = options?.requiredCapabilities
      ?? this.selector.selectFromGoal(goal)

    const snapshots = await this.registry.snapshot(required, options?.snapshotCtx)

    const memoryEntries = this.memoryResource.search('')
    const facts = memoryEntries.filter(e => e.type === 'fact')
    const decisions = memoryEntries.filter(e => e.type === 'decision')
    const notes = memoryEntries.filter(e => e.type === 'note')
    const constraints = this.memoryResource.getConstraints()

    const normalizedData = this.normalizerRegistry?.getRecent(5) || []

    return {
      goal,
      memory: { facts, decisions, notes, constraints },
      snapshots,
      observations: this.getRecentObservations(10),
      normalizedData,
      executionHistory: this.executionHistory.getRecent(options?.maxExecutionHistory ?? 20),
      capabilities: required,
      timestamp: Date.now(),
      round: this.round
    }
  }

  async projectWithSnapshots(
    snapshots: Snapshot[],
    options?: Omit<ProjectorOptions, 'snapshotCtx'>
  ): Promise<RuntimeContext> {
    const goal = this.goalManager.getCurrent()
    const memoryEntries = this.memoryResource.search('')
    const facts = memoryEntries.filter(e => e.type === 'fact')
    const decisions = memoryEntries.filter(e => e.type === 'decision')
    const notes = memoryEntries.filter(e => e.type === 'note')
    const constraints = this.memoryResource.getConstraints()

    const normalizedData = this.normalizerRegistry?.getRecent(5) || []

    return {
      goal,
      memory: { facts, decisions, notes, constraints },
      snapshots,
      observations: this.getRecentObservations(10),
      normalizedData,
      executionHistory: this.executionHistory.getRecent(options?.maxExecutionHistory ?? 20),
      capabilities: options?.requiredCapabilities ?? [],
      timestamp: Date.now(),
      round: this.round
    }
  }

  recordExecution(record: Omit<ExecutionRecord, 'round'>): void {
    this.executionHistory.add({ ...record, round: this.round })

    for (const tc of record.toolCalls) {
      if (tc.observation) {
        this.observations.push(tc.observation)
      }
    }
  }

  recordObservation(observation: Observation): void {
    this.observations.push(observation)
    if (this.observations.length > 50) {
      this.observations = this.observations.slice(-50)
    }
  }

  async runNormalizers(): Promise<NormalizedResult[]> {
    if (!this.normalizerRegistry) return []

    const goal = this.goalManager.getCurrent()
    if (!goal) return []

    const worldState = await this.registry.snapshot()
    return this.normalizerRegistry.normalizeAll(goal, this.observations, worldState)
  }

  getRecentObservations(count: number = 10): Observation[] {
    return this.observations.slice(-count)
  }

  nextRound(): void {
    this.round++
  }

  getRound(): number {
    return this.round
  }

  getExecutionHistory(): ExecutionHistory {
    return this.executionHistory
  }

  getSelector(): CapabilitySelector {
    return this.selector
  }

  getRegistry(): ResourceRegistry {
    return this.registry
  }

  getNormalizerRegistry(): NormalizerRegistry | undefined {
    return this.normalizerRegistry
  }
}
