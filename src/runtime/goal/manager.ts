import { randomUUID } from 'crypto'
import type { Goal, GoalStatus, GoalUpdate } from './types'

export class GoalManager {
  private current: Goal | null = null
  private history: Goal[] = []

  create(title: string, description: string, parentId?: string): Goal {
    const now = Date.now()
    const goal: Goal = {
      id: randomUUID(),
      title,
      description,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      parentId,
      children: []
    }

    if (parentId && this.current) {
      this.current.children = [...(this.current.children || []), goal.id]
    }

    this.current = goal
    return goal
  }

  getCurrent(): Goal | null {
    return this.current
  }

  update(updates: GoalUpdate): Goal | null {
    if (!this.current) return null
    this.current = {
      ...this.current,
      ...updates,
      updatedAt: Date.now()
    }
    return this.current
  }

  finish(): Goal | null {
    if (!this.current) return null
    const now = Date.now()
    this.current = {
      ...this.current,
      status: 'completed',
      updatedAt: now,
      completedAt: now
    }
    this.history.push(this.current)
    const finished = this.current
    this.current = null
    return finished
  }

  abort(): Goal | null {
    if (!this.current) return null
    const now = Date.now()
    this.current = {
      ...this.current,
      status: 'aborted',
      updatedAt: now
    }
    this.history.push(this.current)
    const aborted = this.current
    this.current = null
    return aborted
  }

  getHistory(): Goal[] {
    return [...this.history]
  }

  getAllGoals(): Goal[] {
    return [...this.history, ...(this.current ? [this.current] : [])]
  }

  setStatus(status: GoalStatus): Goal | null {
    if (!this.current) return null
    this.current = {
      ...this.current,
      status,
      updatedAt: Date.now()
    }
    if (status === 'completed' || status === 'aborted') {
      this.current.completedAt = status === 'completed' ? Date.now() : undefined
      this.history.push(this.current)
      this.current = null
    }
    return this.current
  }
}
