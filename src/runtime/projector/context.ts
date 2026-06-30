import type { Goal } from '../goal/types'
import type { Snapshot, Capability } from '../resource/types'
import type { MemoryEntry } from '../resource/memory'
import type { Observation } from '../observation/types'
import type { NormalizedResult } from '../normalizer/types'

export interface ExecutionToolCall {
  id: string
  name: string
  args: Record<string, unknown>
  result: string
  isError: boolean
  duration: number
  observation?: Observation
}

export interface ExecutionRecord {
  round: number
  assistantText: string
  reasoningContent?: string
  toolCalls: ExecutionToolCall[]
  startTime: number
  endTime: number
}

export interface RuntimeContext {
  goal: Goal | null
  memory: {
    facts: MemoryEntry[]
    decisions: MemoryEntry[]
    notes: MemoryEntry[]
    constraints: string[]
  }
  snapshots: Snapshot[]
  observations: Observation[]
  normalizedData: NormalizedResult[]
  executionHistory: ExecutionRecord[]
  capabilities: Capability[]
  timestamp: number
  round: number
}

export class ExecutionHistory {
  private records: ExecutionRecord[] = []
  private maxRecords: number

  constructor(maxRecords: number = 50) {
    this.maxRecords = maxRecords
  }

  add(record: ExecutionRecord): void {
    this.records.push(record)
    if (this.records.length > this.maxRecords) {
      this.records = this.records.slice(-this.maxRecords)
    }
  }

  getRecent(count: number = 10): ExecutionRecord[] {
    return this.records.slice(-count)
  }

  getAll(): ExecutionRecord[] {
    return [...this.records]
  }

  getByRound(round: number): ExecutionRecord[] {
    return this.records.filter(r => r.round === round)
  }

  clear(): void {
    this.records = []
  }

  size(): number {
    return this.records.length
  }
}
