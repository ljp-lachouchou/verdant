import type { DatabaseManager } from './database'
import type { Session } from '@shared/types'
import { randomUUID } from 'crypto'

export class SessionRepository {
  constructor(private db: DatabaseManager) {}

  create(name?: string, parentId?: string): Session {
    const id = randomUUID()
    const now = Date.now()
    const sessionName = name || `Session ${new Date().toLocaleString()}`

    this.db.prepare(`
      INSERT INTO sessions (id, name, created_at, updated_at, parent_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, sessionName, now, now, parentId || null)

    return {
      id,
      name: sessionName,
      createdAt: now,
      updatedAt: now,
      parentId: parentId || undefined
    }
  }

  getById(id: string): Session | null {
    const row = this.db.prepare(`
      SELECT * FROM sessions WHERE id = ?
    `).get(id) as SessionRow | undefined

    return row ? this.mapRow(row) : null
  }

  list(limit = 100): Session[] {
    const rows = this.db.prepare(`
      SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ?
    `).all(limit) as SessionRow[]

    return rows.map(row => this.mapRow(row))
  }

  update(id: string, name: string): void {
    this.db.prepare(`
      UPDATE sessions SET name = ?, updated_at = ? WHERE id = ?
    `).run(name, Date.now(), id)
  }

  touch(id: string): void {
    this.db.prepare(`
      UPDATE sessions SET updated_at = ? WHERE id = ?
    `).run(Date.now(), id)
  }

  delete(id: string): void {
    this.db.prepare(`DELETE FROM sessions WHERE id = ?`).run(id)
  }

  private mapRow(row: SessionRow): Session {
    return {
      id: row.id,
      name: row.name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      parentId: row.parent_id || undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined
    }
  }
}

interface SessionRow {
  id: string
  name: string
  created_at: number
  updated_at: number
  parent_id: string | null
  metadata: string | null
}
