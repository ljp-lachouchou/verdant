export type GoalStatus = 'pending' | 'active' | 'completed' | 'aborted'

export interface Goal {
  id: string
  title: string
  description: string
  status: GoalStatus
  createdAt: number
  updatedAt: number
  completedAt?: number
  context?: Record<string, unknown>
  parentId?: string
  children?: string[]
  metadata?: Record<string, unknown>
}

export interface GoalUpdate {
  title?: string
  description?: string
  status?: GoalStatus
  context?: Record<string, unknown>
  metadata?: Record<string, unknown>
}
