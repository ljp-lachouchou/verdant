import { randomUUID } from 'crypto'
import type { DatabaseManager } from './database'
import type { Message, MessageRole, MessageType } from '@shared/types'

function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 3.5)
}

export class MessageRepository {
  constructor(private db: DatabaseManager) {}

  add(message: Omit<Message, 'id' | 'timestamp' | 'tokenCount'> & {
    id?: string
    timestamp?: number
    tokenCount?: number
  }): Message {
    const id = message.id || randomUUID()
    const timestamp = message.timestamp || Date.now()
    const messageType = message.messageType || 'text'
    const tokenCount = message.tokenCount ?? estimateTokens(message.content)
    const toolCallsJson = message.toolCalls ? JSON.stringify(message.toolCalls) : null
    const metadataJson = message.metadata ? JSON.stringify(message.metadata) : null

    this.db.prepare(`
      INSERT INTO messages (id, session_id, role, message_type, content, timestamp, tool_calls, is_summary, is_compacted, parent_message_id, token_count, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      message.sessionId,
      message.role,
      messageType,
      message.content,
      timestamp,
      toolCallsJson,
      message.isSummary ? 1 : 0,
      message.isCompacted ? 1 : 0,
      message.parentMessageId || null,
      tokenCount,
      metadataJson
    )

    return {
      id,
      sessionId: message.sessionId,
      role: message.role as MessageRole,
      messageType: messageType as MessageType,
      content: message.content,
      timestamp,
      toolCalls: message.toolCalls,
      isSummary: message.isSummary,
      isCompacted: message.isCompacted,
      parentMessageId: message.parentMessageId,
      tokenCount,
      metadata: message.metadata
    }
  }

  getBySession(sessionId: string, includeCompacted = false): Message[] {
    const sql = includeCompacted
      ? `SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC`
      : `SELECT * FROM messages WHERE session_id = ? AND is_compacted = 0 ORDER BY timestamp ASC`

    const rows = this.db.prepare(sql).all(sessionId) as MessageRow[]
    return rows.map(row => this.mapRow(row))
  }

  getActiveMessages(sessionId: string): Message[] {
    return this.getBySession(sessionId, false)
  }

  getRecent(sessionId: string, count: number): Message[] {
    const rows = this.db.prepare(`
      SELECT * FROM (
        SELECT * FROM messages WHERE session_id = ? AND is_compacted = 0
        ORDER BY timestamp DESC LIMIT ?
      ) ORDER BY timestamp ASC
    `).all(sessionId, count) as MessageRow[]
    return rows.map(row => this.mapRow(row))
  }

  getMessagesBefore(sessionId: string, beforeTimestamp: number): Message[] {
    const rows = this.db.prepare(`
      SELECT * FROM messages
      WHERE session_id = ? AND is_compacted = 0 AND timestamp < ?
      ORDER BY timestamp ASC
    `).all(sessionId, beforeTimestamp) as MessageRow[]
    return rows.map(row => this.mapRow(row))
  }

  getTokenCount(sessionId: string): number {
    const result = this.db.prepare(`
      SELECT COALESCE(SUM(token_count), 0) as total
      FROM messages WHERE session_id = ? AND is_compacted = 0
    `).get(sessionId) as { total: number }
    return result.total
  }

  count(sessionId: string): number {
    const result = this.db.prepare(`
      SELECT COUNT(*) as count FROM messages WHERE session_id = ? AND is_compacted = 0
    `).get(sessionId) as { count: number }
    return result.count
  }

  markCompacted(sessionId: string, beforeTimestamp: number): number {
    const result = this.db.prepare(`
      UPDATE messages SET is_compacted = 1
      WHERE session_id = ? AND timestamp < ? AND is_compacted = 0
    `).run(sessionId, beforeTimestamp)
    return result.changes
  }

  deleteOlderThan(sessionId: string, keepCount: number): number {
    const result = this.db.prepare(`
      DELETE FROM messages
      WHERE session_id = ?
      AND id NOT IN (
        SELECT id FROM messages WHERE session_id = ?
        ORDER BY timestamp DESC LIMIT ?
      )
    `).run(sessionId, sessionId, keepCount)
    return result.changes
  }

  deleteBySession(sessionId: string): void {
    this.db.prepare(`DELETE FROM messages WHERE session_id = ?`).run(sessionId)
  }

  getById(id: string): Message | null {
    const row = this.db.prepare(`SELECT * FROM messages WHERE id = ?`).get(id) as MessageRow | undefined
    return row ? this.mapRow(row) : null
  }

  exists(id: string): boolean {
    const row = this.db.prepare(`SELECT 1 FROM messages WHERE id = ?`).get(id)
    return !!row
  }

  private mapRow(row: MessageRow): Message {
    const metadata = row.metadata ? JSON.parse(row.metadata) : undefined
    const reasoningContent = metadata?.reasoningContent as string | undefined

    return {
      id: row.id,
      sessionId: row.session_id,
      role: row.role as MessageRole,
      messageType: (row.message_type || 'text') as MessageType,
      content: row.content,
      timestamp: row.timestamp,
      toolCalls: row.tool_calls ? JSON.parse(row.tool_calls) : undefined,
      isSummary: row.is_summary === 1,
      isCompacted: row.is_compacted === 1,
      parentMessageId: row.parent_message_id || undefined,
      tokenCount: row.token_count || 0,
      reasoningContent,
      metadata
    }
  }
}

interface MessageRow {
  id: string
  session_id: string
  role: string
  message_type: string | null
  content: string
  timestamp: number
  tool_calls: string | null
  is_summary: number
  is_compacted: number
  parent_message_id: string | null
  token_count: number
  metadata: string | null
}
