import type { Resource, Snapshot, SnapshotContext, SnapshotArtifact, Capability } from '../types'
import type { Goal } from '../../goal/types'

export interface MemoryEntry {
  key: string
  value: string
  timestamp: number
  type: 'fact' | 'constraint' | 'decision' | 'note'
}

export class MemoryResource implements Resource {
  private entries: Map<string, MemoryEntry> = new Map()
  private goalHistory: Goal[] = []
  private constraints: string[] = []

  id(): string {
    return 'memory'
  }

  name(): string {
    return 'Memory'
  }

  capabilities(): Capability[] {
    return ['memory']
  }

  store(key: string, value: string, type: MemoryEntry['type'] = 'note'): void {
    this.entries.set(key, {
      key,
      value,
      timestamp: Date.now(),
      type
    })
  }

  recall(key: string): string | undefined {
    return this.entries.get(key)?.value
  }

  search(query: string): MemoryEntry[] {
    const lower = query.toLowerCase()
    return Array.from(this.entries.values())
      .filter(e =>
        e.key.toLowerCase().includes(lower) ||
        e.value.toLowerCase().includes(lower)
      )
      .sort((a, b) => b.timestamp - a.timestamp)
  }

  addConstraint(constraint: string): void {
    this.constraints.push(constraint)
  }

  getConstraints(): string[] {
    return [...this.constraints]
  }

  recordGoalHistory(goal: Goal): void {
    this.goalHistory.push(goal)
  }

  delete(key: string): void {
    this.entries.delete(key)
  }

  clear(): void {
    this.entries.clear()
    this.goalHistory = []
    this.constraints = []
  }

  async snapshot(_ctx?: SnapshotContext): Promise<Snapshot> {
    const artifacts: SnapshotArtifact[] = []

    const facts = Array.from(this.entries.values())
      .filter(e => e.type === 'fact')
      .sort((a, b) => b.timestamp - a.timestamp)
    if (facts.length > 0) {
      artifacts.push({
        type: 'json',
        name: 'facts',
        content: JSON.stringify(facts, null, 2)
      })
    }

    const decisions = Array.from(this.entries.values())
      .filter(e => e.type === 'decision')
      .sort((a, b) => b.timestamp - a.timestamp)
    if (decisions.length > 0) {
      artifacts.push({
        type: 'json',
        name: 'decisions',
        content: JSON.stringify(decisions, null, 2)
      })
    }

    const notes = Array.from(this.entries.values())
      .filter(e => e.type === 'note')
      .sort((a, b) => b.timestamp - a.timestamp)
    if (notes.length > 0) {
      artifacts.push({
        type: 'json',
        name: 'notes',
        content: JSON.stringify(notes, null, 2)
      })
    }

    if (this.constraints.length > 0) {
      artifacts.push({
        type: 'text',
        name: 'constraints',
        content: this.constraints.map((c, i) => `${i + 1}. ${c}`).join('\n')
      })
    }

    if (this.goalHistory.length > 0) {
      artifacts.push({
        type: 'json',
        name: 'goal_history',
        content: JSON.stringify(
          this.goalHistory.map(g => ({
            id: g.id,
            title: g.title,
            status: g.status,
            createdAt: g.createdAt,
            completedAt: g.completedAt
          })),
          null,
          2
        )
      })
    }

    return {
      resourceId: this.id(),
      resourceName: this.name(),
      capabilities: this.capabilities(),
      timestamp: Date.now(),
      metadata: {
        totalEntries: this.entries.size,
        constraints: this.constraints.length,
        goalHistory: this.goalHistory.length
      },
      artifacts
    }
  }
}
